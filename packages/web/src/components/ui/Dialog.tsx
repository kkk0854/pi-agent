/** Dialog：Radix 封装，亮暗主题无漏（S-02/S-03：对话框也走令牌） */
import type { ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from '../../lib/cn';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export interface DialogContentProps {
  title: string;
  description?: string;
  children?: ReactNode;
  className?: string;
}

export function DialogContent({ title, description, children, className }: DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/40" />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 w-[min(480px,92vw)] -translate-x-1/2 -translate-y-1/2',
          'rounded-card bg-elevated p-5 shadow-[var(--pa-shadow-md)] border border-line',
          className,
        )}
      >
        <DialogPrimitive.Title className="text-base font-semibold text-text">{title}</DialogPrimitive.Title>
        {description ? (
          <DialogPrimitive.Description className="mt-1 text-sm text-secondary">
            {description}
          </DialogPrimitive.Description>
        ) : null}
        <div className="mt-4">{children}</div>
        <DialogPrimitive.Close
          className="absolute right-3 top-3 rounded p-1 text-muted hover:bg-accent-soft hover:text-text"
          aria-label="关闭"
        >
          ✕
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
