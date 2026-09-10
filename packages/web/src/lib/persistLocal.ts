/**
 * 本地持久化兜底（架构 §2.5 persistLocal）：
 * T01 的布局/主题等 UI 偏好直接落 localStorage（带 pi-agent. 前缀）。
 * 工作区数据（项目/会话/设置）属 host，T02 起 persistLocal 仅作 host 不可达时的只读兜底。
 */
export function loadLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`pi-agent.${key}`);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function saveLocal(key: string, value: unknown): void {
  try {
    localStorage.setItem(`pi-agent.${key}`, JSON.stringify(value));
  } catch {
    // 隐私模式 / 配额满时静默失败（偏好丢失可接受）
  }
}
