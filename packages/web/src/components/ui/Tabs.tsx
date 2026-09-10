/** Tabs：Radix 封装（右栏 变更/任务/分支树） */
import type { ReactNode } from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '../../lib/cn';

export const Tabs = TabsPrimitive.Root;

export interface TabsListProps {
  items: { value: string; label: string }[];
  className?: string;
}

export function TabsList({ items, className }: TabsListProps) {
  return (
    <TabsPrimitive.List className={cn('flex gap-1 border-b border-line px-2 pt-1', className)}>
      {items.map((item) => (
        <TabsPrimitive.Trigger
          key={item.value}
          value={item.value}
          className={cn(
            'rounded-t-[6px] px-3 py-1.5 text-sm text-muted transition-colors',
            'hover:text-secondary',
            'data-[state=active]:border-b-2 data-[state=active]:border-accent data-[state=active]:text-text data-[state=active]:font-medium',
          )}
        >
          {item.label}
        </TabsPrimitive.Trigger>
      ))}
    </TabsPrimitive.List>
  );
}

export interface TabsPanelProps {
  value: string;
  children: ReactNode;
  className?: string;
}

export function TabsPanel({ value, children, className }: TabsPanelProps) {
  return (
    <TabsPrimitive.Content value={value} className={cn('min-h-0 flex-1 overflow-auto p-3', className)}>
      {children}
    </TabsPrimitive.Content>
  );
}
