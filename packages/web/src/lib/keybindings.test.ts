import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_KEYBINDINGS, formatKeys, keyComboOf, listBindings } from './keybindings';

/** jsdom 默认 navigator.platform 为空串（按非 mac 处理）；用完恢复 */
function setPlatform(platform: string): void {
  Object.defineProperty(window.navigator, 'platform', {
    value: platform,
    configurable: true,
  });
}

afterEach(() => {
  setPlatform('');
});

describe('formatKeys', () => {
  it('非 mac：mod 显示为 Ctrl，部分以 + 连接', () => {
    setPlatform('Win32');
    expect(formatKeys('mod+k')).toBe('Ctrl+K');
    expect(formatKeys('mod+shift+p')).toBe('Ctrl+Shift+P');
    expect(formatKeys('mod+.')).toBe('Ctrl+.');
  });

  it('非 mac：alt/shift/enter/esc 的展示名', () => {
    setPlatform('Win32');
    expect(formatKeys('alt+enter')).toBe('Alt+Enter');
    expect(formatKeys('shift+esc')).toBe('Shift+Esc');
  });

  it('mac：mod 显示为 ⌘，部分无分隔符连接', () => {
    setPlatform('MacIntel');
    expect(formatKeys('mod+k')).toBe('⌘K');
    expect(formatKeys('mod+shift+p')).toBe('⌘⇧P');
  });

  it('未知片段按大写原样展示', () => {
    setPlatform('Win32');
    expect(formatKeys('mod+n')).toBe('Ctrl+N');
    expect(formatKeys('enter')).toBe('Enter');
  });
});

describe('keyComboOf', () => {
  const ev = (overrides: Partial<KeyboardEvent> = {}): KeyboardEvent =>
    ({
      key: '',
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      ...overrides,
    }) as KeyboardEvent;

  it('纯字母小写化', () => {
    expect(keyComboOf(ev({ key: 'A' }))).toBe('a');
  });

  it('ctrl 与 meta 都归一为 mod', () => {
    expect(keyComboOf(ev({ key: 'k', ctrlKey: true }))).toBe('mod+k');
    expect(keyComboOf(ev({ key: 'k', metaKey: true }))).toBe('mod+k');
  });

  it('修饰键顺序固定为 mod > alt > shift', () => {
    expect(keyComboOf(ev({ key: 'p', ctrlKey: true, altKey: true, shiftKey: true }))).toBe(
      'mod+alt+shift+p',
    );
  });

  it('普通字符与数字', () => {
    expect(keyComboOf(ev({ key: '.', ctrlKey: true }))).toBe('mod+.');
    expect(keyComboOf(ev({ key: '5' }))).toBe('5');
  });

  it('与 DEFAULT_KEYBINDINGS 的键位串可互相匹配', () => {
    setPlatform('Win32');
    for (const b of DEFAULT_KEYBINDINGS) {
      const normalized = b.keys
        .split('+')
        .map((p) => ({ mod: 'mod', enter: 'enter' })[p] ?? p)
        .join('+');
      expect(normalized).toBe(b.keys);
    }
  });
});

describe('listBindings / DEFAULT_KEYBINDINGS', () => {
  it('绑定 id 唯一且键位串唯一', () => {
    const ids = DEFAULT_KEYBINDINGS.map((b) => b.id);
    const keys = DEFAULT_KEYBINDINGS.map((b) => b.keys);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('listBindings 输出展示格式与标签', () => {
    setPlatform('Win32');
    const list = listBindings();
    expect(list).toHaveLength(DEFAULT_KEYBINDINGS.length);
    expect(list[2].keys).toBe('Ctrl+K');
    for (const item of list) {
      expect(typeof item.label).toBe('string');
      expect(item.label.length).toBeGreaterThan(0);
      expect(typeof item.enabled).toBe('boolean');
    }
  });
});
