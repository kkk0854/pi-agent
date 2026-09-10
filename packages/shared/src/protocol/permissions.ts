/**
 * 权限与审批协议类型（架构 §4，A-01..A-14）。
 * 四档：① yolo ② notify-on-risky ③ ask（全局默认）④ read-only。
 * 策略判定在前端（PermissionPolicyEngine，T03），本文件只定义契约与默认清单。
 */

/** 四档权限档位 */
export type PermissionTier = 'yolo' | 'notify-on-risky' | 'ask' | 'read-only';

export interface PermissionTierInfo {
  tier: PermissionTier;
  label: string;
  description: string;
  /** 是否可以设为全局默认（yolo 不得作为全局默认，A-01） */
  allowedAsGlobalDefault: boolean;
  /** 切换生效路径：立即（前端策略）还是需重连进程（影响 spawn 参数） */
  effect: 'immediate' | 'reconnect';
}

export const PERMISSION_TIERS: readonly PermissionTierInfo[] = [
  {
    tier: 'yolo',
    label: '完全访问',
    description: '不询问，全部放行。开启需二次确认；会话结束回到项目默认档。',
    allowedAsGlobalDefault: false,
    effect: 'reconnect',
  },
  {
    tier: 'notify-on-risky',
    label: '重要修改时通知',
    description: '常规编辑与命令自动放行；命中危险清单才弹审批。',
    allowedAsGlobalDefault: true,
    effect: 'immediate',
  },
  {
    tier: 'ask',
    label: '逐次询问',
    description: '写文件 / 执行命令均弹审批条：单次放行 / 本会话放行 / 拒绝。',
    allowedAsGlobalDefault: true,
    effect: 'immediate',
  },
  {
    tier: 'read-only',
    label: '只读档',
    description: '禁止一切写与执行（--tools read,grep,find,ls + 扩展二次拦截）。',
    allowedAsGlobalDefault: true,
    effect: 'reconnect',
  },
];

/** 全局默认恒为 ③ 逐次询问（Q14 已采信） */
export const GLOBAL_DEFAULT_TIER: PermissionTier = 'ask';

/** 只读档的工具白名单（--tools 参数，A-04 / W-05） */
export const READ_ONLY_TOOLS: readonly string[] = ['read', 'grep', 'find', 'ls'];

/** 档位 → spawn --tools 参数（null 表示不限制） */
export const TIER_TO_SPAWN_TOOLS: Record<PermissionTier, readonly string[] | null> = {
  yolo: null,
  'notify-on-risky': null,
  ask: null,
  'read-only': READ_ONLY_TOOLS,
};

/* ---------- 扩展 UI 请求 / 应答 ---------- */

/** 需要应答的扩展 UI 方法 */
export type InteractiveUiMethod = 'select' | 'confirm' | 'input' | 'editor';
/** 即发即忘的扩展 UI 方法 */
export type FireAndForgetUiMethod =
  | 'notify'
  | 'setStatus'
  | 'setWidget'
  | 'setTitle'
  | 'set_editor_text';

export type UiNotifyLevel = 'info' | 'warning' | 'error';
export type UiWidgetPlacement = 'aboveEditor' | 'belowEditor';

/** 扩展 UI 请求（由 extension_ui_request 帧归一化而来，文本已剥离 ANSI） */
export interface ExtensionUIRequest {
  id: string;
  method: InteractiveUiMethod;
  title?: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
  /** 自动兜底超时（ms），缺失时用运行时 uiRequestTimeoutMs */
  timeout?: number;
}

/**
 * 扩展 UI 应答（extension_ui_response）：
 * - select/input/editor → { value }
 * - confirm → { confirmed }
 * - 取消 → { cancelled: true }
 */
export type ExtensionUIResponse =
  | { value: string; cancelled?: false }
  | { confirmed: boolean; cancelled?: false }
  | { cancelled: true };

/* ---------- 审批 ---------- */

/** 风险三级输出（架构 §4.3） */
export type RiskLevel = 'block' | 'risky' | 'normal';

/** 前端策略引擎的输入（ui.request + 上下文） */
export interface ApprovalRequest {
  sessionId: string;
  /** extension_ui_request.id */
  requestId: string;
  toolName: string;
  /** 已脱敏的参数摘要 */
  argsSummary: string;
  risk: RiskLevel;
  title: string;
  detail: string;
}

/** 审批决策：scope='once'|'session' 为放行，'deny' 为拒绝 */
export interface ApprovalDecision {
  allow: boolean;
  scope: 'once' | 'session' | 'deny';
}

/** 危险操作清单条目（A-13 可配置；pattern 为正则来源字符串） */
export interface DangerousPattern {
  id: string;
  category: string;
  pattern: string;
  description: string;
}

/** 默认危险操作模式库（PRD §7.9.1，与内置扩展 risk.ts 镜像） */
export const DEFAULT_DANGEROUS_PATTERNS: readonly DangerousPattern[] = [
  { id: 'delete-recursive', category: '删除 / 破坏性', pattern: 'rm\\s+[^\\n]*(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r|--recursive|--force)', description: '递归/强制删除' },
  { id: 'delete-plain-rm', category: '删除 / 破坏性', pattern: 'rm\\s+-[a-zA-Z]*r', description: '递归删除' },
  { id: 'git-clean', category: '删除 / 破坏性', pattern: 'git\\s+clean\\s+-[a-zA-Z]*[fd]', description: 'git clean 清理未跟踪文件' },
  { id: 'del-win', category: '删除 / 破坏性', pattern: 'del\\s+/[sqs]', description: 'Windows 递归删除' },
  { id: 'remove-item', category: '删除 / 破坏性', pattern: 'Remove-Item\\s+[^\\n]*-Recurse', description: 'PowerShell 递归删除' },
  { id: 'git-push-force', category: 'Git 破坏性', pattern: 'git\\s+push\\s+[^\\n]*(-f|--force)', description: '强制推送改写远端历史' },
  { id: 'git-reset-hard', category: 'Git 破坏性', pattern: 'git\\s+reset\\s+--hard', description: '丢弃本地改动' },
  { id: 'git-checkout-dot', category: 'Git 破坏性', pattern: 'git\\s+checkout\\s+\\.', description: '丢弃全部工作区改动' },
  { id: 'git-branch-d', category: 'Git 破坏性', pattern: 'git\\s+branch\\s+-[dD]', description: '删除分支' },
  { id: 'privilege-sudo', category: '权限提升', pattern: '\\bsudo\\b', description: '提权执行' },
  { id: 'privilege-runas', category: '权限提升', pattern: '\\brunas\\b', description: 'Windows 提权执行' },
  { id: 'privilege-chmod', category: '权限提升', pattern: 'chmod\\s+777', description: '开放全部权限' },
  { id: 'sys-write-windows', category: '系统 / 项目外写入', pattern: 'C:\\\\Windows', description: '写入系统目录' },
  { id: 'sys-write-etc', category: '系统 / 项目外写入', pattern: '(^|\\s)/etc/', description: '写入 /etc' },
  { id: 'net-curl-sh', category: '网络副作用', pattern: 'curl\\s+[^|\\n]*\\|\\s*(sh|bash|zsh)', description: '下载并直接执行脚本' },
  { id: 'net-wget-bash', category: '网络副作用', pattern: 'wget\\s+[^|\\n]*-O-\\s*\\|\\s*(sh|bash|zsh)', description: '下载并直接执行脚本' },
  { id: 'net-npm-global', category: '网络副作用', pattern: 'npm\\s+(i|install|add)\\s+(-g|--global)', description: '全局安装 npm 包' },
  { id: 'net-pip-system', category: '网络副作用', pattern: 'pip\\s+install(?!\\s+--user)', description: '安装 Python 包到系统环境' },
  { id: 'secret-env', category: '凭据与密钥', pattern: '\\.env\\b', description: '读取/改写环境变量文件' },
  { id: 'secret-ssh-key', category: '凭据与密钥', pattern: 'id_rsa|id_ed25519|\\.ssh/', description: '访问 SSH 私钥' },
  { id: 'process-kill9', category: '进程与服务', pattern: 'kill\\s+-9', description: '强制终止进程' },
  { id: 'db-drop', category: '数据库', pattern: '\\b(DROP|TRUNCATE)\\s+(TABLE|DATABASE|SCHEMA)\\b', description: '删除数据库对象' },
];
