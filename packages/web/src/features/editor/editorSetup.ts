/**
 * CodeMirror 6 编辑器装配（W-07 内置编辑器）：语言检测 + 亮暗主题。
 * 语言按文件扩展名选择；主题用 css 变量尽量贴合 app 调色板。
 */
import type { Extension } from '@codemirror/state';
import type { LanguageSupport } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { python } from '@codemirror/lang-python';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { EditorView } from '@codemirror/view';

/** 按路径扩展名选择语言支持（未知类型返回 null → 纯文本） */
export function languageForPath(path: string): LanguageSupport | null {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return javascript({ jsx: ext === 'jsx' });
    case 'ts':
    case 'tsx':
      return javascript({ jsx: ext === 'tsx', typescript: true });
    case 'json':
      return json();
    case 'py':
      return python();
    case 'html':
    case 'htm':
      return html();
    case 'css':
      return css();
    default:
      return null;
  }
}

/** 轻量亮暗主题（配合 basicSetup 使用） */
export function editorTheme(dark: boolean): Extension {
  return EditorView.theme(
    {
      '&': {
        backgroundColor: dark ? '#1b1b1f' : '#ffffff',
        color: dark ? '#e6e6e6' : '#1f2328',
        fontSize: '13px',
        height: '100%',
      },
      '.cm-scroller': {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        lineHeight: '1.6',
      },
      '.cm-gutters': {
        backgroundColor: dark ? '#171719' : '#f6f8fa',
        color: dark ? '#6b6b75' : '#9aa0a6',
        border: 'none',
      },
      '.cm-activeLine': { backgroundColor: dark ? '#26262c' : '#f0f4ff' },
      '.cm-activeLineGutter': { backgroundColor: 'transparent' },
      '.cm-content': { caretColor: dark ? '#e6e6e6' : '#1f2328' },
      '&.cm-focused .cm-cursor': { borderLeftColor: dark ? '#e6e6e6' : '#1f2328' },
    },
    { dark },
  );
}
