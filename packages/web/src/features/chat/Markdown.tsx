/**
 * 轻量 Markdown 渲染（无外部依赖，流式安全）：
 * 支持 围栏代码块 / 标题 / 无序有序列表 / 行内代码 / 粗体 / 链接 / 段落。
 * 按块解析为 ReactNode；流式渲染时未闭合的围栏按普通段落降级（不崩不闪）。
 */
import { Fragment, type ReactNode } from 'react';

/* ---------- 行内解析 ---------- */

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // 行内代码 `code`
  const codeRe = /`([^`]+)`/g;
  // 粗体 **b**
  const boldRe = /\*\*([^*]+)\*\*/g;
  // 链接 [t](u)
  const linkRe = /\[([^\]]+)\]\(([^)\s]+)\)/g;

  type Token = { start: number; end: number; node: ReactNode };
  const tokens: Token[] = [];

  for (const m of text.matchAll(codeRe)) {
    tokens.push({
      start: m.index ?? 0,
      end: (m.index ?? 0) + m[0].length,
      node: (
        <code key={`${keyPrefix}-c${m.index}`} className="rounded bg-accent-soft px-1 py-0.5 font-mono text-[0.9em]">
          {m[1]}
        </code>
      ),
    });
  }
  for (const m of text.matchAll(boldRe)) {
    tokens.push({
      start: m.index ?? 0,
      end: (m.index ?? 0) + m[0].length,
      node: <strong key={`${keyPrefix}-b${m.index}`}>{m[1]}</strong>,
    });
  }
  for (const m of text.matchAll(linkRe)) {
    tokens.push({
      start: m.index ?? 0,
      end: (m.index ?? 0) + m[0].length,
      node: (
        <a
          key={`${keyPrefix}-l${m.index}`}
          href={m[2]}
          target="_blank"
          rel="noreferrer noopener"
          className="text-accent underline underline-offset-2"
        >
          {m[1]}
        </a>
      ),
    });
  }
  tokens.sort((a, b) => a.start - b.start);

  let pos = 0;
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i]!;
    // 跳过重叠 token
    if (tk.start < pos) continue;
    if (tk.start > pos) nodes.push(<Fragment key={`${keyPrefix}-t${i}`}>{text.slice(pos, tk.start)}</Fragment>);
    nodes.push(tk.node);
    pos = tk.end;
  }
  if (pos < text.length) nodes.push(<Fragment key={`${keyPrefix}-tail`}>{text.slice(pos)}</Fragment>);
  return nodes;
}

/* ---------- 块级解析 ---------- */

export function Markdown({ text, className }: { text: string; className?: string }) {
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // 围栏代码块
    if (line.trimStart().startsWith('```')) {
      const lang = line.trim().slice(3).trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trimStart().startsWith('```')) {
        buf.push(lines[i]!);
        i++;
      }
      i++; // 跳过收尾 ```（缺失时 i === lines.length，降级为已收集内容）
      blocks.push(
        <pre
          key={`code-${key++}`}
          className="my-2 overflow-x-auto rounded-card border border-line bg-panel p-3 font-mono text-xs leading-relaxed"
        >
          {lang ? <div className="mb-1 text-muted">{lang}</div> : null}
          <code>{buf.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    // 标题
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      const size = ['text-lg', 'text-base', 'text-sm', 'text-sm'][level - 1] ?? 'text-sm';
      blocks.push(
        <div key={`h-${key++}`} className={`mt-2 mb-1 font-semibold text-text ${size}`}>
          {renderInline(heading[2]!, `h${key}`)}
        </div>,
      );
      i++;
      continue;
    }

    // 列表
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    const ordered = /^(\d+)\.\s+(.*)$/.exec(line);
    if (bullet || ordered) {
      const isOrdered = Boolean(ordered);
      const items: string[] = [];
      while (i < lines.length) {
        const m = isOrdered ? /^(\d+)\.\s+(.*)$/.exec(lines[i]!) : /^[-*]\s+(.*)$/.exec(lines[i]!);
        if (!m) break;
        items.push((m[2] ?? m[1])!);
        i++;
      }
      const content = items.map((item, idx) => (
        <li key={`li-${idx}`} className="ml-4 list-outside list-disc">
          {renderInline(item, `li${idx}`)}
        </li>
      ));
      blocks.push(
        isOrdered ? (
          <ol key={`ol-${key++}`} className="my-1 list-decimal space-y-0.5 pl-2">
            {content}
          </ol>
        ) : (
          <ul key={`ul-${key++}`} className="my-1 space-y-0.5 pl-2">
            {content}
          </ul>
        ),
      );
      continue;
    }

    // 空行分段
    if (line.trim().length === 0) {
      i++;
      continue;
    }

    // 普通段落（连续非空行合并）
    const para: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i]!.trim().length > 0 &&
      !lines[i]!.trimStart().startsWith('```') &&
      !/^(#{1,4})\s/.test(lines[i]!) &&
      !/^[-*]\s/.test(lines[i]!) &&
      !/^\d+\.\s/.test(lines[i]!)
    ) {
      para.push(lines[i]!);
      i++;
    }
    blocks.push(
      <p key={`p-${key++}`} className="my-1 leading-relaxed">
        {renderInline(para.join('\n'), `p${key}`)}
      </p>,
    );
  }

  return <div className={`text-sm text-text ${className ?? ''}`}>{blocks}</div>;
}
