/**
 * 快捷键体系（S-06 骨架）：T01 先立数据结构与展示格式化；
 * 绑定监听与配置面板在 T03 接入。
 */
import type { MessageKey } from '../i18n';
import { t } from '../i18n';

export interface KeyBinding {
  id: string;
  /** 规范化键位：mod=Cmd/Ctrl；shift/alt 小写；字母小写。例 'mod+k' */
  keys: string;
  labelKey: MessageKey;
  /** 是否当前已生效（T01 仅发送与停止占位） */
  enabled: boolean;
}

export const DEFAULT_KEYBINDINGS: readonly KeyBinding[] = [
  { id: 'send', keys: 'enter', labelKey: 'keybinding.send', enabled: false },
  { id: 'abort', keys: 'mod+.', labelKey: 'keybinding.abort', enabled: false },
  { id: 'command-palette', keys: 'mod+k', labelKey: 'keybinding.commandPalette', enabled: false },
  { id: 'new-session', keys: 'mod+n', labelKey: 'keybinding.newSession', enabled: false },
];

/** 'mod+k' → 'Ctrl+K'（Windows）/'⌘K'（macOS） */
export function formatKeys(keys: string): string {
  const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);
  return keys
    .split('+')
    .map((part) => {
      switch (part) {
        case 'mod':
          return isMac ? '⌘' : 'Ctrl';
        case 'shift':
          return isMac ? '⇧' : 'Shift';
        case 'alt':
          return isMac ? '⌥' : 'Alt';
        case 'enter':
          return 'Enter';
        case 'esc':
          return 'Esc';
        default:
          return part.toUpperCase();
      }
    })
    .join(isMac ? '' : '+');
}

/** 键盘事件 → 规范化键位串（供匹配） */
export function keyComboOf(event: KeyboardEvent | { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): string {
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push('mod');
  if (event.altKey) parts.push('alt');
  if (event.shiftKey) parts.push('shift');
  parts.push(event.key.toLowerCase());
  return parts.join('+');
}

/** 展示用：全部绑定（快捷键面板 T03 消费） */
export function listBindings(): { keys: string; label: string; enabled: boolean }[] {
  return DEFAULT_KEYBINDINGS.map((b) => ({ keys: formatKeys(b.keys), label: t(b.labelKey), enabled: b.enabled }));
}
