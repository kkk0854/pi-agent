/** DropdownMenu：Radix 封装（主题切换、后续权限档位选择等） */
import type { ReactNode } from 'react';
import * as MenuPrimitive from '@radix-ui/react-dropdown-menu';
import { cn } from '../../lib/cn';

export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuTrigger = MenuPrimitive.Trigger;

export interface DropdownMenuItemProps {
  children: ReactNode;
  onSelect?: () => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
}

export function DropdownMenuItem({ children, onSelect, active, disabled, className }: DropdownMenuItemProps) {
  return (
    <MenuPrimitive.Item
      onSelect={onSelect}
      disabled={disabled}
      className={cn(
        'flex cursor-default items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-sm outline-none',
        'text-text data-[highlighted]:bg-accent-soft',
        active && 'font-medium text-accent',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      {children}
    </MenuPrimitive.Item>
  );
}

export interface DropdownMenuContentProps {
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
  className?: string;
}

export function DropdownMenuContent({ children, align = 'end', className }: DropdownMenuContentProps) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        align={align}
        sideOffset={6}
        className={cn(
          'z-50 min-w-36 rounded-card border border-line bg-elevated p-1 shadow-[var(--pa-shadow-md)]',
          className,
        )}
      >
        {children}
      </MenuPrimitive.Content>
    </MenuPrimitive.Portal>
  );
}
