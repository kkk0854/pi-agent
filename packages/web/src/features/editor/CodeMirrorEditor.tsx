/**
 * CodeMirror 6 内置编辑器（W-07）：亮暗主题 + 语言检测 + 受控/非受控混合。
 * - 创建一次；路径/主题/只读状态变更走 Compartment 重配置（不重建，保光标）。
 * - value 外部变更时同步（避免无限回环：仅当与当前内容不同才 dispatch）。
 */
import { useEffect, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { Compartment, EditorState } from '@codemirror/state';
import { cn } from '../../lib/cn';
import { editorTheme, languageForPath } from './editorSetup';

export interface CodeMirrorEditorProps {
  value: string;
  /** 用于语言检测 */
  path?: string;
  readOnly?: boolean;
  dark?: boolean;
  onChange?: (value: string) => void;
  className?: string;
  minHeight?: number;
}

export function CodeMirrorEditor({
  value,
  path,
  readOnly = false,
  dark = false,
  onChange,
  className,
  minHeight = 240,
}: CodeMirrorEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const langCompartment = useRef(new Compartment());
  const themeCompartment = useRef(new Compartment());
  const editableCompartment = useRef(new Compartment());
  const readOnlyCompartment = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // 仅创建一次
  useEffect(() => {
    if (!hostRef.current) return;
    const listener = EditorView.updateListener.of((u) => {
      if (u.docChanged) onChangeRef.current?.(u.state.doc.toString());
    });
    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        langCompartment.current.of(languageForPath(path ?? '') ?? []),
        themeCompartment.current.of(editorTheme(dark)),
        editableCompartment.current.of(EditorView.editable.of(!readOnly)),
        readOnlyCompartment.current.of(EditorState.readOnly.of(readOnly)),
        EditorView.lineWrapping,
        listener,
      ],
    });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 语言随路径变化
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: langCompartment.current.reconfigure(languageForPath(path ?? '') ?? []),
    });
  }, [path]);

  // 主题随亮暗变化
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: themeCompartment.current.reconfigure(editorTheme(dark)),
    });
  }, [dark]);

  // 只读状态变化
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: [
        editableCompartment.current.reconfigure(EditorView.editable.of(!readOnly)),
        readOnlyCompartment.current.reconfigure(EditorState.readOnly.of(readOnly)),
      ],
    });
  }, [readOnly]);

  // 外部 value 同步（仅在内容不一致时更新，避免光标跳动与回环）
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (value !== current) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  return (
    <div
      ref={hostRef}
      className={cn('overflow-auto rounded-card border border-line bg-bg', className)}
      style={{ minHeight }}
    />
  );
}
