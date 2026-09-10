/**
 * PermissionEngine（T03 核心，A-01..A-14）：
 * 策略判定在前端 —— 扩展无条件发 confirm（title=MARKER 的 extension_ui_request），
 * 本引擎按四档档位 + 危险清单决策：自动放行 / 弹审批条 / 自动拒绝。
 * 档位②③换档立即生效（纯前端判定）；①④影响 spawn 参数需重连（UI 明示）。
 */
import {
  DEFAULT_DANGEROUS_PATTERNS,
  redact,
  type DangerousPattern,
  type ExtensionUIRequest,
  type PermissionTier,
  type RiskLevel,
} from '@pi-agent/shared';

/** 内置审批扩展的 confirm 识别标记（extensions/pi-agent-permissions/index.ts） */
export const PERMISSION_MARKER = 'pi-agent-permissions';

/** 只读工具：任何档位都无需审批（档位④由 spawn --tools 白名单硬约束） */
export const READ_ONLY_TOOLS: readonly string[] = ['read', 'grep', 'find', 'ls'];

/** 扩展 confirm 载荷（message 字段的 JSON） */
export interface ToolCallPayload {
  toolName: string;
  toolCallId: string;
  input: Record<string, unknown>;
  /** 扩展侧已做轻量脱敏的摘要（审计直接可用） */
  summary?: string;
}

/** 解析权限审批请求；非本扩展的 confirm 返回 null（走通用 ExtensionUIRenderer） */
export function parsePermissionRequest(req: ExtensionUIRequest): ToolCallPayload | null {
  if (req.method !== 'confirm' || req.title !== PERMISSION_MARKER) return null;
  try {
    const raw = JSON.parse(req.message ?? '') as Partial<ToolCallPayload>;
    if (typeof raw.toolName !== 'string' || raw.toolName.length === 0) return null;
    return {
      toolName: raw.toolName,
      toolCallId: typeof raw.toolCallId === 'string' ? raw.toolCallId : '',
      input: (raw.input ?? {}) as Record<string, unknown>,
      summary: typeof raw.summary === 'string' ? raw.summary : undefined,
    };
  } catch {
    return null;
  }
}

/** 参数摘要（展示/审计用；扩展 summary 缺失时本地生成并过 redact） */
export function summarizeToolCall(toolName: string, input: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(input)) {
    let value: string;
    if (typeof v === 'string') {
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
  return redact(`${toolName} ${parts.join(' ')}`.trim());
}

/** 从工具输入提取匹配文本：bash/powershell 用命令本身，write/edit 用目标路径 */
function matchTextOf(input: Record<string, unknown>): string {
  const cmd = input['command'];
  if (typeof cmd === 'string') return cmd;
  const candidates = ['path', 'file_path', 'filePath', 'target', 'url'];
  for (const key of candidates) {
    const v = input[key];
    if (typeof v === 'string') return v;
  }
  try {
    return JSON.stringify(input) ?? '';
  } catch {
    return '';
  }
}

export interface RiskAssessment {
  risk: RiskLevel;
  /** 命中的危险规则（risk='risky' 时非空） */
  matched: DangerousPattern | null;
}

export type ApprovalAction = 'auto-allow' | 'prompt' | 'auto-deny';

export interface ApprovalVerdict {
  action: ApprovalAction;
  risk: RiskLevel;
  matched: DangerousPattern | null;
  /** auto-deny 的原因（审批条/审计展示） */
  denyReason?: string;
}

/**
 * 四档策略引擎。
 * ① yolo → 全放行；② notify-on-risky → 命中危险清单才弹；③ ask → 写/执行全弹；
 * ④ read-only → 写/执行全拒（+ spawn 层白名单双保险）；只读工具一律放行。
 */
export class PermissionEngine {
  private patterns: DangerousPattern[] = [...DEFAULT_DANGEROUS_PATTERNS];
  /** 会话放行记忆（A-03「本会话放行」）：sid → 已放行的工具名集合 */
  private readonly sessionAllows = new Map<string, Set<string>>();

  /** 危险清单可被 host 下发的合并清单覆盖（A-13 数据文件 + 自定义 + 项目覆盖） */
  setPatterns(patterns: DangerousPattern[]): void {
    this.patterns = [...patterns];
  }

  getPatterns(): DangerousPattern[] {
    return [...this.patterns];
  }

  /** 「本会话放行」记忆 */
  allowSessionForTool(sessionId: string, toolName: string): void {
    const set = this.sessionAllows.get(sessionId) ?? new Set<string>();
    set.add(toolName);
    this.sessionAllows.set(sessionId, set);
  }

  isSessionAllowed(sessionId: string, toolName: string): boolean {
    return this.sessionAllows.get(sessionId)?.has(toolName) ?? false;
  }

  clearSession(sessionId: string): void {
    this.sessionAllows.delete(sessionId);
  }

  assess(toolName: string, input: Record<string, unknown>): RiskAssessment {
    if (READ_ONLY_TOOLS.includes(toolName)) return { risk: 'normal', matched: null };
    const text = matchTextOf(input);
    for (const p of this.patterns) {
      try {
        if (new RegExp(p.pattern).test(text)) return { risk: 'risky', matched: p };
      } catch {
        // 非法正则跳过（host CRUD 已校验，防御性兜底）
      }
    }
    return { risk: 'normal', matched: null };
  }

  evaluate(sessionId: string, tier: PermissionTier, payload: ToolCallPayload): ApprovalVerdict {
    const { risk, matched } = this.assess(payload.toolName, payload.input);

    // 会话级放行记忆优先（用户已表达意愿）
    if (this.isSessionAllowed(sessionId, payload.toolName) && risk !== 'risky') {
      return { action: 'auto-allow', risk, matched };
    }
    // 只读工具：任何档位放行
    if (READ_ONLY_TOOLS.includes(payload.toolName)) {
      return { action: 'auto-allow', risk, matched };
    }
    switch (tier) {
      case 'yolo':
        return { action: 'auto-allow', risk, matched };
      case 'read-only':
        return {
          action: 'auto-deny',
          risk,
          matched,
          denyReason: '当前为只读档，已自动拒绝（对应进程以 --tools read,grep,find,ls 启动）',
        };
      case 'notify-on-risky':
        return risk === 'risky'
          ? { action: 'prompt', risk, matched }
          : { action: 'auto-allow', risk, matched };
      case 'ask':
      default:
        return { action: 'prompt', risk, matched };
    }
  }
}

/** 模块级单例（前端策略引擎全局唯一：放行记忆/清单跨组件共享） */
export const permissionEngine = new PermissionEngine();
