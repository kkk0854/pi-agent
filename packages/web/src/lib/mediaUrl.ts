/**
 * 媒体 URL 与类型判别（D-03/D-04/D-07）：
 * - buildMediaUrl：浏览器不能直接 file:// 打开本地媒体，需经 host 回环 URL（http://127.0.0.1:*）。
 * - classifyMedia：路径 → 媒体类型，驱动对应查看器（图片/视频/音频/PDF/Office）。
 */
import { getHostClient } from '../runtime/runtimeRef';

export type MediaKind = 'image' | 'video' | 'audio' | 'pdf' | 'office' | 'other';

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico']);
const VIDEO_EXT = new Set(['mp4', 'webm', 'ogv', 'mov', 'mkv', 'm4v']);
const AUDIO_EXT = new Set(['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac']);
const PDF_EXT = new Set(['pdf']);
const OFFICE_EXT = new Set(['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp']);

/** 路径 → 媒体类型（D-05/D-06 Office 归类为 office，仅做占位） */
export function classifyMedia(pathOrUrl: string): MediaKind {
  const ext = pathOrUrl.split(/[?#]/)[0]!.split('.').pop()?.toLowerCase() ?? '';
  if (IMAGE_EXT.has(ext)) return 'image';
  if (VIDEO_EXT.has(ext)) return 'video';
  if (AUDIO_EXT.has(ext)) return 'audio';
  if (PDF_EXT.has(ext)) return 'pdf';
  if (OFFICE_EXT.has(ext)) return 'office';
  return 'other';
}

/** 是否可在内嵌查看器中预览（D-03/D-04/D-07；Office 与未知类型不可预览） */
export function isPreviewable(kind: MediaKind): boolean {
  return kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'pdf';
}

/**
 * 本地绝对路径 → 回环媒体 URL（host 仅放行 http://127.0.0.1:*，见 ARCHITECTURE §8.10）。
 * 离线（无 host）时返回 null，调用方降级为「暂不支持」或 dataUrl。
 */
export function buildMediaUrl(absPath: string): string | null {
  const client = getHostClient();
  if (!client) return null;
  return client.mediaUrl(absPath);
}
