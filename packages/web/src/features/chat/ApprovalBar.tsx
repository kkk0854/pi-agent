/**
 * ApprovalBar（A-02/A-03/A-14）：审批条内嵌时间线 + 超时倒计时 + 三按钮。
 * - 单次放行（once）/ 本会话放行（session，记忆到 PermissionEngine）/ 拒绝（deny）
 * - 显示：工具名 / 已脱敏参数摘要 / 风险级别与命中的危险规则 / 剩余秒数
 */
import { useEffect, useState } from 'react';
import { IconShieldQuestion, IconClock } from '@tabler/icons-react';
import { t } from '../../i18n';
import { Button } from '../../components/ui/Button';
import { resolveItem } from '../../lib/approvalFlow';
import type { PendingItem } from '../../store/approvalStore';

const RISK_LABEL: Record<string, { text: string; cls: string }> = {
  normal: { text: '常规', cls: 'border-line text-secondary' },
  risky: { text: '危险', cls: 'border-danger/60 text-danger' },
  block: { text: '禁止', cls: 'border-danger/60 text-danger' },
};

/** 剩余秒数（每秒刷新） */
function useCountdown(timeoutAt: number): number {
  const [left, setLeft] = useState(() => Math.max(0, Math.ceil((timeoutAt - Date.now()) / 1000)));
  useEffect(() => {
    const timer = setInterval(() => {
      setLeft(Math.max(0, Math.ceil((timeoutAt - Date.now()) / 1000)));
    }, 1000);
    return () => clearInterval(timer);
  }, [timeoutAt]);
  return left;
}

export function ApprovalBar({ item }: { item: PendingItem }) {
  const left = useCountdown(item.timeoutAt);
  const risk = RISK_LABEL[item.risk ?? 'normal']!;

  const decide = (allow: boolean, scope: 'once' | 'session' | 'deny'): void => {
    resolveItem(item.req.id, { allow, scope });
  };

  return (
    <div className="mx-4 mt-2 rounded-card border border-warning/50 bg-warning/5 px-3 py-2" data-testid="approval-bar">
      <div className="flex items-center gap-2">
        <IconShieldQuestion size={16} className="shrink-0 text-warning" />
        <span className="text-xs font-medium text-text">{t('approval.title')}</span>
        <span className={`rounded-full border px-1.5 text-[11px] ${risk.cls}`}>{risk.text}</span>
        {item.matchedDescription ? (
          <span className="truncate text-[11px] text-danger">{item.matchedDescription}</span>
        ) : null}
        <span className="ml-auto flex items-center gap-1 text-[11px] text-secondary" title="超时默认拒绝（A-14）">
          <IconClock size={12} />
          {left}s
        </span>
      </div>
      <div className="mt-1 flex items-start gap-2 text-xs">
        <span className="shrink-0 font-mono text-secondary">{item.toolName}</span>
        <code className="min-w-0 flex-1 break-all rounded bg-bg-tertiary px-1.5 py-0.5 text-[11px] text-secondary">
          {item.argsSummary || item.req.message}
        </code>
      </div>
      <div className="mt-2 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => decide(false, 'deny')}>
          {t('approval.deny')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => decide(true, 'session')}>
          本会话放行
        </Button>
        <Button size="sm" variant="primary" onClick={() => decide(true, 'once')}>
          {t('approval.allow')}
        </Button>
      </div>
    </div>
  );
}

