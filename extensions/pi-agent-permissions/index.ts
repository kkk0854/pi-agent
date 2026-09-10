/**
 * pi-agent 内置审批扩展（架构 §5，T03 核心）。
 *
 * 设计原则（务必遵守）：**策略判定放前端，本扩展无条件发 confirm**。
 * - 工具执行前（tool_call，可拦截）弹出确认：title 固定为 MARKER_TITLE（前端识别标记），
 *   message 为 JSON 载荷 { toolName, toolCallId, input }（前端解析后跑档位策略引擎）
 * - 前端四档决策：
 *   ① yolo     → 前端自动应答 confirmed=true（不弹条）
 *   ② notify   → 命中危险清单才弹条，否则自动放行
 *   ③ ask      → 全部弹条（单次放行 / 本会话放行 / 拒绝）
 *   ④ read-only→ 前端自动应答 confirmed=false（+ spawn 层 --tools 白名单双保险）
 * - 档位②③换档立即生效（纯前端判定）；①④影响 spawn 参数 → 重连后生效
 * - 扩展侧兜底：confirm false/undefined/异常 一律 block（宁可误拦不可漏放）
 *
 * 交互通道：RPC 模式下 ctx.ui.confirm 以 extension_ui_request 帧发出，
 * 宿主（pi-agent web）以 extension_ui_response 应答 —— 走既有 pendingRequest 通道。
 *
 * 类型说明：为保证扩展自包含（pi 加载扩展时独立解析），此处用结构化最小类型
 * 而非 import pi 的 types.d.ts（类型在运行时被擦除，仅作文档约束）。
 */

/** confirm 请求的识别标记（web 端 PermissionEngine 依据 title 判定） */
export const MARKER_TITLE = 'pi-agent-permissions';

/** 只读工具：无需审批（档位④由 spawn 层 --tools 白名单直接禁用其余工具） */
const READ_ONLY_TOOLS = new Set(['read', 'grep', 'find', 'ls']);

/** tool_call 事件（pi ExtensionAPI 的结构化子集） */
interface ToolCallEvent {
  type: 'tool_call';
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
}

/** ctx.ui（pi ExtensionUIContext 的结构化子集） */
interface UiContext {
  confirm(title: string, message: string, opts?: { timeout?: number }): Promise<boolean | undefined>;
  notify(message: string, type?: 'info' | 'warning' | 'error'): void;
}

/** ctx（pi ExtensionContext 的结构化子集） */
interface ExtContext {
  ui: UiContext;
  hasUI: boolean;
  mode: string;
}

/** pi ExtensionAPI 的结构化子集 */
interface PiApi {
  on(
    event: 'tool_call',
    handler: (event: ToolCallEvent, ctx: ExtContext) => Promise<{ block?: boolean; reason?: string; terminate?: boolean } | void> | { block?: boolean; reason?: string; terminate?: boolean } | void,
  ): void;
  registerCommand(
    name: string,
    options: {
      description?: string;
      handler: (args: string, ctx: ExtContext) => Promise<void> | void;
    },
  ): void;
}

/** 审批超时（ms）：与 web 端 uiRequestTimeoutMs（默认 30s）对齐，略长以让前端先超时兜底 */
const APPROVAL_TIMEOUT_MS = 32_000;

/** 工具参数的轻量脱敏：折叠超长与疑似密钥字段（A-10 审计同样受益于该摘要） */
function summarizeInput(input: Record<string, unknown>): string {
  const SENSITIVE_KEYS = /^(api[_-]?key|token|secret|password|authorization)$/i;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(input)) {
    let value: string;
    if (SENSITIVE_KEYS.test(k)) {
      value = '«已隐藏»';
    } else if (typeof v === 'string') {
      value = v.length > 120 ? `${v.slice(0, 117)}…` : v;
    } else {
      try {
        value = JSON.stringify(v) ?? String(v);
      } catch {
        value = String(v);
      }
      if (value.length > 120) value = `${value.slice(0, 117)}…`;
    }
    parts.push(`${k}=${value}`);
  }
  return parts.join(' ');
}

export default function piAgentPermissions(pi: PiApi): void {
  pi.on('tool_call', async (event, ctx) => {
    // 只读工具直接放行（策略引擎亦会 auto-allow，这里省一次往返）
    if (READ_ONLY_TOOLS.has(event.toolName)) return {};

    // 无 UI 通道（print/json 模式）：保守放行 —— spawn 层 --tools 白名单仍是硬约束，
    // 且该模式下不存在人工审批的语义
    if (!ctx.hasUI) return {};

    const payload = JSON.stringify({
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      input: event.input,
      summary: summarizeInput(event.input),
    });

    let answer: boolean | undefined;
    try {
      answer = await ctx.ui.confirm(MARKER_TITLE, payload, { timeout: APPROVAL_TIMEOUT_MS });
    } catch {
      return { block: true, reason: '审批通道异常，已拦截本次工具调用' };
    }

    if (answer === true) return {};
    return {
      block: true,
      // undefined = 超时/取消；false = 前端明确拒绝（档位④自动拒绝或用户拒绝）
      reason: answer === false ? '用户（或只读策略）拒绝了本次工具调用' : '审批超时，默认拒绝（A-14）',
    };
  });

  // /permissions：向用户说明策略判定位置（档位与危险清单管理在 pi-agent 前端 / 设置页）
  pi.registerCommand('permissions', {
    description: '查看 pi-agent 权限审批说明',
    handler: (_args, ctx) => {
      ctx.ui.notify(
        '审批策略由 pi-agent 前端判定：四档权限（完全访问/重要修改时通知/逐次询问/只读档），危险清单与审计日志见设置页。',
        'info',
      );
    },
  });
}
