/**
 * ChatTimeline：消息时间线。
 * user 消息靠右气泡；assistant 消息按块序渲染（思考折叠、正文 Markdown、工具卡片）。
 * 自动滚动到底部（新内容到达时）。
 * 每条 assistant 消息提供「分叉」入口（F-01）：打开 ForkDialog 选分叉点派生新会话。
 */
import { useEffect, useRef, useState } from 'react';
import { IconBrain, IconChevronDown, IconGitFork } from '@tabler/icons-react';
import { cn } from '../../lib/cn';
import { t } from '../../i18n';
import { Markdown } from './Markdown';
import { ToolCard } from './ToolCard';
import type { ChatBlock, ChatMessage } from '../../store/chatStore';
import { useAppStore } from '../../store';
import { ForkDialog } from '../branch/ForkDialog';

function ThinkingBlock({ block }: { block: Extract<ChatBlock, { kind: 'thinking' }> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-1 rounded-card border border-dashed border-line bg-panel/60 px-3 py-1.5 text-xs text-muted">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <IconBrain size={13} />
        <span>{block.done ? '思考过程' : '思考中…'}</span>
        <IconChevronDown
          size={13}
          className={cn('ml-auto transition-transform', open ? 'rotate-180' : '')}
        />
      </button>
      {open ? (
        <div className="mt-1 whitespace-pre-wrap border-t border-line pt-1.5 leading-relaxed">
          {block.text}
          {!block.done ? <span className="animate-pulse">▍</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function MessageItem({ message, onFork }: { message: ChatMessage; onFork?: () => void }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-card rounded-br-sm bg-accent px-3.5 py-2 text-sm text-white">
          {message.blocks
            .filter((b) => b.kind === 'text')
            .map((b) => b.text)
            .join('\n')}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start">
      <div className="mb-1 flex w-full items-center">
        <span className="text-[11px] text-muted">assistant</span>
        {onFork ? (
          <button
            type="button"
            onClick={onFork}
            title={t('chat.forkHere')}
            className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-accent-soft hover:text-text"
          >
            <IconGitFork size={12} />
            {t('chat.fork')}
          </button>
        ) : null}
      </div>
      {message.blocks.map((block, i) => {
        if (block.kind === 'thinking') return <ThinkingBlock key={i} block={block} />;
        if (block.kind === 'toolCall') return <ToolCard key={i} block={block} />;
        return (
          <div key={i} className="w-full">
            <Markdown text={block.text} />
            {!block.done ? <span className="animate-pulse text-accent">▍</span> : null}
          </div>
        );
      })}
    </div>
  );
}

export function ChatTimeline({ messages }: { messages: ChatMessage[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevLen = useRef(0);
  const sessionId = useAppStore((s) => s.currentSessionId);
  const sessionTitle = useAppStore((s) => s.sessions.find((x) => x.id === s.currentSessionId)?.title);
  const [forkOpen, setForkOpen] = useState(false);

  useEffect(() => {
    // 新消息或内容更新时滚到底（用户上翻时不打扰的完整实现在 T03）
    const len = messages.length;
    const last = messages[len - 1];
    const grew = len !== prevLen.current;
    prevLen.current = len;
    if (grew || (last && !last.done)) {
      bottomRef.current?.scrollIntoView({ behavior: grew ? 'smooth' : 'auto', block: 'end' });
    }
  });

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-4">
      {messages.map((m) => (
        <MessageItem key={m.id} message={m} onFork={m.role === 'assistant' ? () => setForkOpen(true) : undefined} />
      ))}
      <div ref={bottomRef} />
      {sessionId ? (
        <ForkDialog
          sessionId={sessionId}
          sessionTitle={sessionTitle}
          open={forkOpen}
          onOpenChange={setForkOpen}
        />
      ) : null}
    </div>
  );
}
