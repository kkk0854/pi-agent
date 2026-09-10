/**
 * 严格 JSONL 分帧器（架构 §8.8 / C7 / R-02）。
 * 禁用 Node readline（会在 U+2028/U+2029 处误切）；仅按 '\n' 切分并 trim 行尾 '\r'。
 * Web / Node 通用：流式喂入 chunk，返回完整行，保留部分行缓冲。
 */
export interface JsonlSplitter {
  /** 喂入一段文本，返回其中已完整（以 \n 结尾）的行 */
  push(chunk: string): string[];
  /** 流结束：冲出缓冲区中的最后一行（若非空） */
  end(): string[];
}

export function createJsonlSplitter(): JsonlSplitter {
  let buffer = '';
  return {
    push(chunk: string): string[] {
      buffer += chunk;
      const lines: string[] = [];
      let idx = buffer.indexOf('\n');
      while (idx !== -1) {
        const line = buffer.slice(0, idx).replace(/\r$/, '');
        buffer = buffer.slice(idx + 1);
        if (line.length > 0) lines.push(line);
        idx = buffer.indexOf('\n');
      }
      return lines;
    },
    end(): string[] {
      const rest = buffer.replace(/\r$/, '');
      buffer = '';
      return rest.length > 0 ? [rest] : [];
    },
  };
}

/**
 * 序列化对象为单行 JSONL（不含 \r；JSON 字符串内的 \n 会被转义，不会误切）。
 * stdin 写入时额外追加 '\n' 由调用方处理（本函数返回含尾随 \n 的完整行）。
 */
export function encodeJsonl(obj: unknown): string {
  return `${JSON.stringify(obj)}\n`;
}
