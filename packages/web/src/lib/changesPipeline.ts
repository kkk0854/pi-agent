/**
 * 变更面板真实链路（T04b，W-06..W-08 从可演示变可用）：
 * - write/edit 类工具事件 → ChangeFile 映射（纯函数，可单测）
 * - original 快照：审批流（approvalFlow）在写工具 confirm 到达时（写盘前）读当前文件缓存
 * - modified：tool.end（非错误）后读目标文件
 * host 不解析 pi 协议（架构 §1.5 不变），快照与读取全部走 web 侧 REST。
 */
import type { ChangeInput } from '../features/changes/changesReducer';

/** 视为「写文件」的工具名（小写比较） */
export const WRITE_TOOLS: readonly string[] = [
  'write',
  'edit',
  'multi_edit',
  'write_file',
  'edit_file',
  'apply_patch',
  'str_replace',
];

export function isWriteTool(toolName: string): boolean {
  return WRITE_TOOLS.includes(toolName.trim().toLowerCase());
}

/** 从写工具参数里提取目标文件路径（常见键名逐个探测；返回 null 表示无法确定） */
export function pathOfWriteInput(input: unknown): string | null {
  if (input === null || typeof input !== 'object') return null;
  const obj = input as Record<string, unknown>;
  const candidates = ['path', 'file_path', 'filePath', 'target', 'file'];
  for (const key of candidates) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim().length > 0) return v;
  }
  // 部分工具把参数包在 args/input 里再套一层
  for (const nestedKey of ['args', 'input', 'params']) {
    const nested = obj[nestedKey];
    if (nested !== null && typeof nested === 'object') {
      const found = pathOfWriteInput(nested);
      if (found) return found;
    }
  }
  return null;
}

/**
 * 由工具事件构建 ChangeInput。
 * @param modified 当前文件内容（tool.end 后读取；null = 读取失败，跳过）
 * @param original 审批时快照（写盘前）；null = 未捕获（界面诚实标注）
 */
export function buildChangeInput(params: {
  toolName: string;
  path: string;
  original: string | null;
  modified: string | null;
}): ChangeInput | null {
  if (params.modified === null) return null;
  return {
    path: params.path,
    original: params.original,
    modified: params.modified,
  };
}

/** toolCallId → 目标路径 的在途写工具登记（App 事件接线用） */
const pendingWrites = new Map<string, string>();

/** tool.start：写工具则登记 toolCallId → path，返回 path（非写工具返回 null） */
export function trackWriteToolStart(toolCallId: string, toolName: string, args: unknown): string | null {
  if (!isWriteTool(toolName)) return null;
  const p = pathOfWriteInput(args);
  if (p) pendingWrites.set(toolCallId, p);
  return p;
}

/** tool.end：取回在途路径并清除登记；非写工具/未登记返回 null */
export function takeWriteToolEnd(toolCallId: string): string | null {
  const p = pendingWrites.get(toolCallId) ?? null;
  pendingWrites.delete(toolCallId);
  return p;
}

/** 测试/重置：清空在途登记 */
export function resetWriteTracking(): void {
  pendingWrites.clear();
}
