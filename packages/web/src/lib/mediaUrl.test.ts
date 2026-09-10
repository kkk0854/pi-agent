/** mediaUrl 工具单测（D-03/D-04/D-07） */
import { describe, it, expect } from 'vitest';
import { classifyMedia, isPreviewable, buildMediaUrl } from './mediaUrl';

describe('classifyMedia', () => {
  it('按扩展名归类', () => {
    expect(classifyMedia('a.png')).toBe('image');
    expect(classifyMedia('b.JPG')).toBe('image');
    expect(classifyMedia('c.MP4')).toBe('video');
    expect(classifyMedia('d.mp3')).toBe('audio');
    expect(classifyMedia('e.pdf')).toBe('pdf');
    expect(classifyMedia('f.docx')).toBe('office');
    expect(classifyMedia('g.txt')).toBe('other');
  });

  it('带查询串/片段仍可识别', () => {
    expect(classifyMedia('http://x/y.svg?z=1')).toBe('image');
    expect(classifyMedia('/abs/path/file.PNG#frag')).toBe('image');
  });
});

describe('isPreviewable', () => {
  it('仅 image/video/audio/pdf 可内嵌预览', () => {
    expect(isPreviewable('image')).toBe(true);
    expect(isPreviewable('video')).toBe(true);
    expect(isPreviewable('audio')).toBe(true);
    expect(isPreviewable('pdf')).toBe(true);
    expect(isPreviewable('office')).toBe(false);
    expect(isPreviewable('other')).toBe(false);
  });
});

describe('buildMediaUrl', () => {
  it('无 host 时返回 null（离线降级）', () => {
    // 单测环境未注入 HostClient
    expect(buildMediaUrl('/abs/x.png')).toBeNull();
  });
});
