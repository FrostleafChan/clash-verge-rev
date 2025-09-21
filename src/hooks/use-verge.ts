import { useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr";

import { useSystemState } from "@/hooks/use-system-state";
import { getVergeConfig, patchVergeConfig } from "@/services/cmds";
import { showNotice } from "@/services/noticeService";

export const useVerge = () => {
  const { t } = useTranslation();
  const { isAdminMode, isServiceMode } = useSystemState();

  const { data: verge, mutate: mutateVerge } = useSWR(
    "getVergeConfig",
    async () => {
      const config = await getVergeConfig();
      return config;
    },
  );

  const patchVerge = async (value: Partial<IVergeConfig>) => {
    await patchVergeConfig(value);
    mutateVerge();
  };

  const isTunAvailable = isServiceMode || isAdminMode;
  const { enable_tun_mode } = verge ?? {};

  // 防止重复自动关闭操作的引用
  const autoCloseInProgressRef = useRef(false);
  const autoCloseTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 安全的自动关闭TUN模式函数
  const safeAutoCloseTun = useCallback(async () => {
    if (autoCloseInProgressRef.current) {
      console.log("[useVerge] 自动关闭TUN操作已在进行中，跳过");
      return;
    }

    autoCloseInProgressRef.current = true;
    console.log("[useVerge] 开始安全自动关闭TUN模式");

    try {
      // 使用更短的超时时间防止卡死
      const timeoutPromise = new Promise<never>((_, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error("TUN auto-close timeout"));
        }, 3000); // 3秒超时

        // 保存timeout ID以便清理
        autoCloseTimeoutRef.current = timeoutId;
      });

      // 竞赛模式：要么成功要么超时
      await Promise.race([
        patchVergeConfig({ enable_tun_mode: false }),
        timeoutPromise
      ]);

      // 延迟更新UI状态，避免立即冲突
      setTimeout(() => {
        mutateVerge();
        showNotice(
          "info",
          t("TUN Mode automatically disabled due to service unavailable")
        );
      }, 100);

    } catch (err) {
      console.error("[useVerge] 自动关闭TUN模式失败:", err);
      // 不显示错误通知，避免在弱网环境下频繁弹出错误
      console.log("[useVerge] 将在下次检测时重试自动关闭");
    } finally {
      // 清理超时timer
      if (autoCloseTimeoutRef.current) {
        clearTimeout(autoCloseTimeoutRef.current);
        autoCloseTimeoutRef.current = null;
      }

      // 延迟重置锁，给后续操作留出时间
      setTimeout(() => {
        autoCloseInProgressRef.current = false;
      }, 1000);
    }
  }, [mutateVerge, t]);

  // 防抖的自动关闭TUN检测
  useEffect(() => {
    // 清理之前的定时器
    if (autoCloseTimeoutRef.current) {
      clearTimeout(autoCloseTimeoutRef.current);
      autoCloseTimeoutRef.current = null;
    }

    // 只在TUN开启且服务不可用时才处理
    if (enable_tun_mode && !isTunAvailable) {
      console.log("[useVerge] 检测到服务不可用，将在500ms后自动关闭TUN模式");

      // 使用防抖，避免频繁操作
      autoCloseTimeoutRef.current = setTimeout(() => {
        safeAutoCloseTun();
      }, 500);
    }

    // 清理函数
    return () => {
      if (autoCloseTimeoutRef.current) {
        clearTimeout(autoCloseTimeoutRef.current);
        autoCloseTimeoutRef.current = null;
      }
    };
  }, [isTunAvailable, enable_tun_mode, safeAutoCloseTun]);

  return {
    verge,
    mutateVerge,
    patchVerge,
  };
};
