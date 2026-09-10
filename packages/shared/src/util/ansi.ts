/**
 * ANSI 转义码处理（C5 / A-12）：剥离或转 token。
 * statusText 等扩展 UI 字段可能含真彩色转义序列（实测 \u001b[38;2;...m）。
 */

/** CSI / OSC / 单字符转义（覆盖 SGR 颜色、光标控制、OSC 标题等） */
const ANSI_PATTERN =
  // eslint-disable-next-line no-control-regex -- 控制字符正是本模块要剥离的对象
  /\u001B\[[0-9;?]*[A-Za-z]|\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)?|\u001B[=>c78M]/g;

/** 是否含 ANSI 转义序列 */
export function hasAnsi(s: string): boolean {
  ANSI_PATTERN.lastIndex = 0;
  return ANSI_PATTERN.test(s);
}

/** 剥离全部 ANSI 转义序列 */
export function stripAnsi(s: string): string {
  return s.replace(ANSI_PATTERN, '');
}

/** ANSI token：文本片段 + 生效时的 SGR 序列（如 '38;2;138;190;183'） */
export interface AnsiToken {
  text: string;
  /** SGR 参数串（原始保留，UI 侧自行决定渲染方式）；无颜色时为 undefined */
  sgr?: string;
}

/**
 * 转换为 token 序列（保留颜色信息，供状态栏渲染彩色文本）。
 * 当前实现跟踪最近一次 SGR 背景/前景参数中的「前景」段。
 */
export function ansiToTokens(s: string): AnsiToken[] {
  const tokens: AnsiToken[] = [];
  let currentSgr: string | undefined = undefined;
  let index = 0;
  ANSI_PATTERN.lastIndex = 0;

  const matches = [...s.matchAll(ANSI_PATTERN)];
  for (const match of matches) {
    const start = match.index ?? 0;
    if (start > index) {
      tokens.push({ text: s.slice(index, start), sgr: currentSgr });
    }
    const seq = match[0];
    // SGR（结尾字母 m）：解析前景色参数
    if (seq.startsWith('\u001B[') && seq.endsWith('m')) {
      const params = seq.slice(2, -1);
      if (params === '' || params === '0') {
        currentSgr = undefined;
      } else if (/(^|;)(3[0-7]|9[0-7]|38)/.test(params)) {
        currentSgr = params;
      }
    }
    index = start + seq.length;
  }
  if (index < s.length) {
    tokens.push({ text: s.slice(index), sgr: currentSgr });
  }
  return tokens.filter((t) => t.text.length > 0 || tokens.length === 0);
}
