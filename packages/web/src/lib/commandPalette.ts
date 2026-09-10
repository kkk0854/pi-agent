/**
 * 命令面板核心（P-06/P-07/P-08 · M-09/M-10 · A-07）：
 * 纯函数层（过滤/排序/分组），UI 组件 CommandPalette.tsx 仅负责渲染与键盘导航。
 * 通过单测覆盖过滤逻辑，保证中文/多词查询可用。
 */

export interface CommandItem {
  id: string;
  /** 主标题（出现在列表），必填、可本地化 */
  title: string;
  /** 次要说明 */
  hint?: string;
  /** 分组（如「会话」「视图」「主题」），用于分区渲染 */
  group: string;
  /** 触发动作 */
  run(): void;
  /** 额外可检索关键词（命令名英文/别名） */
  keywords?: string;
}

/**
 * 按查询过滤命令：多词以空格拆分，全部子串命中才算（AND 语义，支持中英文混搜）。
 * 空查询返回原列表（保持原顺序）。
 */
export function filterCommands(items: CommandItem[], query: string): CommandItem[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return items;
  return items.filter((item) => {
    const haystack = `${item.title} ${item.hint ?? ''} ${item.group} ${item.keywords ?? ''}`.toLowerCase();
    return tokens.every((token) => haystack.includes(token));
  });
}

/** 把命令列表按 group 分组（保持组内原顺序），供 UI 分区渲染 */
export function groupCommands(items: CommandItem[]): { group: string; items: CommandItem[] }[] {
  const order: string[] = [];
  const map = new Map<string, CommandItem[]>();
  for (const item of items) {
    if (!map.has(item.group)) {
      map.set(item.group, []);
      order.push(item.group);
    }
    map.get(item.group)!.push(item);
  }
  return order.map((group) => ({ group, items: map.get(group)! }));
}
