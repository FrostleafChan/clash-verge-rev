import { cloneElement, isValidElement, ReactNode, useRef } from "react";

import noop from "@/utils/noop";

interface Props<Value> {
  value?: Value;
  valueProps?: string;
  onChangeProps?: string;
  waitTime?: number;
  onChange?: (value: Value) => void;
  onFormat?: (...args: any[]) => Value;
  onGuard?: (value: Value, oldValue: Value) => Promise<void>;
  onCatch?: (error: Error) => void;
  children: ReactNode;
}

export function GuardState<T>(props: Props<T>) {
  const {
    value,
    children,
    valueProps = "value",
    onChangeProps = "onChange",
    waitTime = 0, // debounce wait time default 0
    onGuard = noop,
    onCatch = noop,
    onChange = noop,
    onFormat = (v: T) => v,
  } = props;

  const lockRef = useRef(false);
  const saveRef = useRef(value);
  const lastRef = useRef(0);
  const timeRef = useRef<any>(undefined);

  if (!isValidElement(children)) {
    return children as any;
  }

  const childProps = { ...(children.props as Record<string, any>) };

  childProps[valueProps] = value;
  childProps[onChangeProps] = async (...args: any[]) => {
    // 多次操作无效
    if (lockRef.current) return;
    lockRef.current = true;

    try {
      const newValue = (onFormat as any)(...args);
      // 先在ui上响应操作
      onChange(newValue);

      const now = Date.now();

      // save the old value
      if (waitTime <= 0 || now - lastRef.current >= waitTime) {
        saveRef.current = value;
      }

      lastRef.current = now;

      if (waitTime <= 0) {
        // 添加超时保护，防止长时间阻塞
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("Operation timeout")), 5000);
        });

        try {
          await Promise.race([
            onGuard(newValue, value!),
            timeoutPromise
          ]);
        } catch (err: any) {
          // 确保在错误情况下正确释放锁
          onChange(saveRef.current!);
          onCatch(err);
          throw err; // 重新抛出错误以便外层catch处理
        }
      } else {
        // debounce guard
        clearTimeout(timeRef.current);

        timeRef.current = setTimeout(async () => {
          try {
            const timeoutPromise = new Promise<never>((_, reject) => {
              setTimeout(() => reject(new Error("Operation timeout")), 5000);
            });

            await Promise.race([
              onGuard(newValue, saveRef.current!),
              timeoutPromise
            ]);
          } catch (err: any) {
            // 状态回退
            onChange(saveRef.current!);
            onCatch(err);
          } finally {
            // 确保延迟操作也能正确释放锁
            lockRef.current = false;
          }
        }, waitTime);

        // 对于延迟操作，不在这里释放锁
        return;
      }
    } catch (err: any) {
      // 状态回退
      onChange(saveRef.current!);
      onCatch(err);
    } finally {
      // 确保锁总是被释放
      lockRef.current = false;
    }
  };
  return cloneElement(children, childProps);
}
