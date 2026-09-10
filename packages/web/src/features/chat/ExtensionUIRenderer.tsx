/**
 * ExtensionUIRenderer（A-11）：select/input/editor/confirm 的应用内渲染。
 * 严禁 window.alert/confirm/prompt —— 全部走行内卡片 + 应用组件。
 */
import { useState } from 'react';
import { IconPuzzle } from '@tabler/icons-react';
import { t } from '../../i18n';
import { Button } from '../../components/ui/Button';
import { respondExtensionUiValue } from '../../lib/approvalFlow';
import { ApprovalBar } from './ApprovalBar';
import type { PendingItem } from '../../store/approvalStore';

export function ExtensionUIRenderer({ item }: { item: PendingItem }) {
  const { req } = item;
  const [value, setValue] = useState(req.prefill ?? '');
  const [choice, setChoice] = useState<number | null>(null);

  const title = req.title || t('approval.title');

  const submit = (): void => {
    if (req.method === 'confirm') {
      respondExtensionUiValue(req.id, { confirmed: true });
    } else if (req.method === 'select') {
      const opt = req.options?.[choice ?? 0];
      if (typeof opt === 'string') respondExtensionUiValue(req.id, { value: opt });
    } else {
      respondExtensionUiValue(req.id, { value });
    }
  };

  return (
    <div className="mx-4 mt-2 rounded-card border border-accent/40 bg-accent/5 px-3 py-2" data-testid="extension-ui">
      <div className="flex items-center gap-2 text-xs font-medium text-text">
        <IconPuzzle size={14} className="shrink-0 text-accent" />
        <span className="truncate">{title}</span>
        <span className="rounded-full border border-line px-1.5 text-[10px] text-secondary">{req.method}</span>
      </div>
      {req.message ? <div className="mt-1 whitespace-pre-wrap break-all text-xs text-secondary">{req.message}</div> : null}

      {req.method === 'select' && req.options ? (
        <div className="mt-2 flex flex-col gap-1">
          {req.options.map((opt, i) => (
            <button
              key={`${opt}-${i}`}
              type="button"
              onClick={() => setChoice(i)}
              className={`rounded-md border px-2 py-1 text-left text-xs transition-colors ${
                choice === i ? 'border-accent bg-accent/10 text-text' : 'border-line text-secondary hover:bg-bg-tertiary'
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      ) : null}

      {req.method === 'input' ? (
        <input
          type="text"
          value={value}
          placeholder={req.placeholder}
          onChange={(e) => setValue(e.target.value)}
          className="mt-2 w-full rounded-md border border-line bg-bg-primary px-2 py-1 text-xs text-text outline-none focus:border-accent"
        />
      ) : null}

      {req.method === 'editor' ? (
        <textarea
          value={value}
          rows={5}
          onChange={(e) => setValue(e.target.value)}
          className="mt-2 w-full resize-y rounded-md border border-line bg-bg-primary px-2 py-1 text-xs text-text outline-none focus:border-accent"
        />
      ) : null}

      <div className="mt-2 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => respondExtensionUiValue(req.id, { cancelled: true })}>
          取消
        </Button>
        <Button size="sm" variant="primary" onClick={submit} disabled={req.method === 'select' && choice === null}>
          确定
        </Button>
      </div>
    </div>
  );
}

/** 当前会话的审批/扩展 UI 挂起区（ChatView 引用；A-09 切会话回来仍可见） */
export function ApprovalPanel({ items }: { items: PendingItem[] }) {
  if (items.length === 0) return null;
  return (
    <>
      {items.map((item) =>
        item.kind === 'approval' ? <ApprovalBar key={item.req.id} item={item} /> : <ExtensionUIRenderer key={item.req.id} item={item} />,
      )}
    </>
  );
}
