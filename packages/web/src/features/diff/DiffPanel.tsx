/**
 * DiffPanel：基于 @codemirror/merge 的双向差异视图（W-06..W-08）。
 * - 左（a）= 原始内容，只读；右（b）= 修改后内容。语言按路径检测。
 * - 提供 接受 / 拒绝 / 还原 操作，回调上抛给 ChangesPanel 更新 store。
 * 注意：MergeView 创建一次，path/original/modified 变化才重建（保光标、避免抖动）。
 */
import { useEffect, useRef } from 'react';
import { MergeView } from '@codemirror/merge';
import { EditorView } from '@codemirror/view';
import { cn } from '../../lib/cn';
import { Button } from '../../components/ui/Button';
import { t } from '../../i18n';
import { languageForPath } from '../editor/editorSetup';
import type { ChangeFile, ChangeStatus } from '../changes/changesReducer';

export interface DiffPanelProps {
  change: ChangeFile;
  onAccept(id: string): void;
  onReject(id: string): void;
  onRestore(id: string): void;
}

const STATUS_CLASS: Record<ChangeStatus, string> = {
  pending: 'bg-warning/15 text-warning',
  accepted: 'bg-success/15 text-success',
  rejected: 'bg-danger/15 text-danger',
};

const STATUS_LABEL = {
  pending: 'changes.status.pending',
  accepted: 'changes.status.accepted',
  rejected: 'changes.status.rejected',
} as const;

export function DiffPanel({ change, onAccept, onReject, onRestore }: DiffPanelProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<MergeView | null>(null);

  useEffect(() => {
    if (!parentRef.current) return;
    const lang = languageForPath(change.path);
    const langExt = lang ?? [];
    const view = new MergeView({
      parent: parentRef.current,
      a: {
        doc: change.original ?? '',
        extensions: [langExt, EditorView.lineWrapping, EditorView.editable.of(false)],
      },
      b: {
        doc: change.modified,
        extensions: [langExt, EditorView.lineWrapping],
      },
      collapseUnchanged: { margin: 3, minSize: 4 },
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [change.path, change.original, change.modified]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="truncate font-mono text-xs text-text">{change.path}</span>
        <span className={cn('ml-auto rounded px-1.5 py-0.5 text-[11px]', STATUS_CLASS[change.status])}>
          {t(STATUS_LABEL[change.status])}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-bg">
        <div ref={parentRef} className="text-[13px]" />
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-line px-3 py-2">
        <Button size="sm" variant="ghost" onClick={() => onRestore(change.id)}>
          {t('changes.restore')}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => onReject(change.id)}>
          {t('changes.reject')}
        </Button>
        <Button size="sm" variant="primary" onClick={() => onAccept(change.id)}>
          {t('changes.accept')}
        </Button>
      </div>
    </div>
  );
}
