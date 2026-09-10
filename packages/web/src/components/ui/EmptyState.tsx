/** EmptyState：克制的空状态（S-04：无项目 / 无会话 / 无消息，不空白不崩溃） */
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex h-full flex-col items-center justify-center gap-2 px-8 text-center', className)}>
      {icon ? <div className="text-muted text-3xl leading-none">{icon}</div> : null}
      <div className="text-base font-medium text-text">{title}</div>
      {description ? <div className="max-w-md text-sm text-muted">{description}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
