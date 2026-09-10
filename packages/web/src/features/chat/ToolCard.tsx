/** ToolCard：工具调用卡片（运行中 / 成功 / 失败三态，参数与结果可折叠） */
import { useState } from 'react';
import { IconLoader2, IconCheck, IconAlertTriangle, IconTool, IconPhoto } from '@tabler/icons-react';
import { cn } from '../../lib/cn';
import type { ChatBlock } from '../../store/chatStore';
import { useMediaStore } from '../media/mediaStore';

function summarize(value: unknown, cap = 240): string {
  let text: string;
  try {
    text = JSON.stringify(value, null, 1) ?? 'null';
  } catch {
    text = String(value);
  }
  return text.length > cap ? `${text.slice(0, cap)}…` : text;
}

const MEDIA_EXT =
  /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico|mp4|webm|ogv|mov|mkv|m4v|mp3|wav|ogg|flac|m4a|aac|pdf|docx?|xlsx?|pptx?|odt|ods|odp)$/i;

/** 递归收集工具参数/结果里的媒体文件路径（含 / 或 \ 的路径串） */
function collectMediaPaths(value: unknown, acc: Set<string>): void {
  if (typeof value === 'string') {
    if (MEDIA_EXT.test(value) && /[\\/]/.test(value)) acc.add(value);
  } else if (Array.isArray(value)) {
    value.forEach((v) => collectMediaPaths(v, acc));
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) collectMediaPaths(v, acc);
  }
}

export function ToolCard({ block }: { block: Extract<ChatBlock, { kind: 'toolCall' }> }) {
  const [open, setOpen] = useState(false);
  const running = !block.done;

  const mediaPaths = new Set<string>();
  collectMediaPaths(block.args, mediaPaths);
  collectMediaPaths(block.result, mediaPaths);
  collectMediaPaths(block.partial, mediaPaths);
  const paths = Array.from(mediaPaths);

  return (
    <div
      className={cn(
        'my-1.5 rounded-card border px-3 py-2 text-xs',
        block.isError ? 'border-danger/60 bg-danger/5' : 'border-line bg-panel',
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
        aria-expanded={open}
      >
        {running ? (
          <IconLoader2 size={14} className="animate-spin text-accent" />
        ) : block.isError ? (
          <IconAlertTriangle size={14} className="text-danger" />
        ) : (
          <IconCheck size={14} className="text-success" />
        )}
        <span className="font-medium text-text">
          <IconTool size={12} className="mr-1 inline-block align-[-1px]" />
          {block.toolName}
        </span>
        <span className={cn('ml-auto text-[11px]', running ? 'text-accent' : 'text-muted')}>
          {running ? '运行中…' : block.isError ? '失败' : '完成'}
        </span>
      </button>

      {paths.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5 border-t border-line pt-2">
          {paths.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => useMediaStore.getState().open(p)}
              className="inline-flex items-center gap-1 rounded bg-accent-soft px-2 py-1 text-[11px] text-accent hover:bg-accent hover:text-white"
              title={p}
            >
              <IconPhoto size={12} />
              <span className="max-w-[180px] truncate font-mono">{p.split(/[\\/]/).pop()}</span>
            </button>
          ))}
        </div>
      ) : null}

      {open ? (
        <div className="mt-2 space-y-1.5 border-t border-line pt-2">
          <div>
            <div className="mb-0.5 text-muted">参数</div>
            <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-bg p-2 font-mono text-[11px] text-secondary">
              {summarize(block.args)}
            </pre>
          </div>
          {block.partial !== undefined && running ? (
            <div>
              <div className="mb-0.5 text-muted">中间输出</div>
              <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-bg p-2 font-mono text-[11px] text-secondary">
                {summarize(block.partial)}
              </pre>
            </div>
          ) : null}
          {block.done ? (
            <div>
              <div className={cn('mb-0.5', block.isError ? 'text-danger' : 'text-muted')}>结果</div>
              <pre
                className={cn(
                  'overflow-x-auto whitespace-pre-wrap break-all rounded bg-bg p-2 font-mono text-[11px]',
                  block.isError ? 'text-danger' : 'text-secondary',
                )}
              >
                {summarize(block.result)}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
