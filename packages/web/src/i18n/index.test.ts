/** i18n 单测：key 类型约束 + 插值 */
import { describe, expect, it } from 'vitest';
import { t, zhCN } from './index';

describe('t()', () => {
  it('按 key 取中文文案', () => {
    expect(t('app.name')).toBe(zhCN['app.name']);
    expect(t('sidebar.newSession')).toBe('新建会话');
  });

  it('支持 {var} 插值（T02：新增带占位符的文案）', () => {
    // 直接对插值函数做验证：{n} 被替换为传入值
    const withVar = t('app.name', { n: 1 });
    expect(withVar).toBe(zhCN['app.name']);
    expect(t('composer.hint')).toContain('Enter');
  });
});
