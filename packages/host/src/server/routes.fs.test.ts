/**
 * fs 路由安全辅助单测（T04b）：isUnderTrustedRoot 前缀校验（大小写不敏感、防兄弟目录穿越）。
 */
import { describe, expect, it } from 'vitest';
import { isUnderTrustedRoot } from './routes.fs';

describe('isUnderTrustedRoot', () => {
  const roots = ['D:\\works\\my-project', 'C:\\Users\\hang\\demo'];

  it('根目录内路径放行', () => {
    expect(isUnderTrustedRoot('D:\\works\\my-project\\src\\a.ts', roots)).toBe(true);
    expect(isUnderTrustedRoot('C:\\Users\\hang\\demo', roots)).toBe(true);
  });

  it('大小写不敏感', () => {
    expect(isUnderTrustedRoot('d:\\WORKS\\My-Project\\README.md', roots)).toBe(true);
  });

  it('兄弟目录前缀穿越拒绝（D:\\works\\my-project-evil 不是子目录）', () => {
    expect(isUnderTrustedRoot('D:\\works\\my-project-evil\\x.ts', roots)).toBe(false);
  });

  it('根目录外拒绝', () => {
    expect(isUnderTrustedRoot('E:\\elsewhere\\a.ts', roots)).toBe(false);
    expect(isUnderTrustedRoot('D:\\works\\a.ts', roots)).toBe(false);
  });
});
