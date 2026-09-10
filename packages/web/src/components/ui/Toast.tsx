/** Toast：Radix 封装 + useToast()（档位切换提示、生效路径提示等，绝不 window.alert） */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import * as ToastPrimitive from '@radix-ui/react-toast';
import { cn } from '../../lib/cn';

export interface ToastItem {
  id: number;
  title: string;
  description?: string;
  level?: 'info' | 'success' | 'warning' | 'error';
}

type ShowToast = (title: string, opts?: { description?: string; level?: ToastItem['level']; duration?: number }) => void;

const ToastContext = createContext<ShowToast>(() => undefined);

export function useToast(): ShowToast {
  return useContext(ToastContext);
}

const LEVEL_BAR: Record<NonNullable<ToastItem['level']>, string> = {
  info: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  error: 'bg-danger',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const showToast = useCallback<ShowToast>((title, opts) => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { id, title, description: opts?.description, level: opts?.level ?? 'info' }]);
    const duration = opts?.duration ?? 3500;
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, duration + 200);
  }, []);

  const value = useMemo(() => showToast, [showToast]);

  return (
    <ToastContext.Provider value={value}>
      <ToastPrimitive.Provider swipeDirection="right">
        {children}
        {toasts.map((toast) => (
          <ToastPrimitive.Root
            key={toast.id}
            duration={3500}
            className={cn(
              'flex items-stretch overflow-hidden rounded-card border border-line bg-elevated shadow-[var(--pa-shadow-md)]',
            )}
          >
            <div className={cn('w-1 shrink-0', LEVEL_BAR[toast.level ?? 'info'])} />
            <div className="px-3 py-2.5">
              <ToastPrimitive.Title className="text-sm font-medium text-text">{toast.title}</ToastPrimitive.Title>
              {toast.description ? (
                <ToastPrimitive.Description className="mt-0.5 text-xs text-secondary">
                  {toast.description}
                </ToastPrimitive.Description>
              ) : null}
            </div>
          </ToastPrimitive.Root>
        ))}
        <ToastPrimitive.Viewport className="fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2 outline-none" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}
