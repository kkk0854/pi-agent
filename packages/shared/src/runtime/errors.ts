/**
 * 运行时错误分类（架构 §8.5）：四类必须互不混淆：
 * cli_not_found / auth_failed / network / agent_crash。
 */
export type RuntimeErrorCode =
  | 'cli_not_found'
  | 'auth_failed'
  | 'network'
  | 'agent_crash'
  | 'connect_timeout'
  | 'timeout'
  | 'protocol_unknown'
  | 'unknown';

export interface RuntimeError {
  code: RuntimeErrorCode;
  message: string;
  recoverable: boolean;
}

/** 面向用户的中文文案（互不混淆） */
const USER_MESSAGES: Record<RuntimeErrorCode, string> = {
  cli_not_found: '未找到 pi 命令行工具。请先安装：npm i -g @earendil-works/pi-coding-agent，或在设置中手动指定路径。',
  auth_failed: 'pi 鉴权失败。请运行 pi /login 登录，或检查 API Key 配置。',
  network: '网络错误：无法连接模型服务。请检查网络或 Provider 配置。',
  agent_crash: 'pi 进程异常退出。可点击「重新连接」恢复会话。',
  connect_timeout: '连接 pi 超时（未在预期时间内收到状态回执）。可尝试重新连接。',
  timeout: '命令响应超时。pi 可能仍在处理，请稍后重试。',
  protocol_unknown: '收到无法识别的协议帧（已保留原始内容，不影响继续使用）。',
  unknown: '发生未知错误。',
};

export function toUserMessage(code: RuntimeErrorCode): string {
  return USER_MESSAGES[code];
}

/** 是否可恢复（决定 UI 是否提供「重新连接」） */
export function isRecoverable(code: RuntimeErrorCode): boolean {
  return code !== 'auth_failed';
}

/**
 * 崩溃分类：依据退出码与 stderr 摘要归类四类错误。
 * 供 host 侧 pi/process.ts 与前端 crash 分类共用（T02 消费）。
 */
export function classifyCrash(exitCode: number | null, stderr: string): RuntimeError {
  const text = stderr.slice(0, 4000);
  if (/ENOENT|command not found|不是内部或外部命令|'pi' is not recognized/i.test(text)) {
    return { code: 'cli_not_found', message: toUserMessage('cli_not_found'), recoverable: false };
  }
  if (/401|403|unauthorized|invalid[_ ]?api[_ ]?key|authentication/i.test(text)) {
    return { code: 'auth_failed', message: toUserMessage('auth_failed'), recoverable: false };
  }
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|network/i.test(text)) {
    return { code: 'network', message: toUserMessage('network'), recoverable: true };
  }
  return {
    code: 'agent_crash',
    message: `${toUserMessage('agent_crash')}（exit=${exitCode ?? 'null'}）`,
    recoverable: true,
  };
}
