/**
 * Composer：输入区（S-05）。
 * - Enter 发送 / Shift+Enter 换行
 * - '@' 触发文件引用面板（host fs.searchFiles 数据源，离线降级为无列表）
 * - '/' 触发斜杠命令面板（X-01 雏形：get_commands + 内置项）
 * - 图片附件（选择 + 拖拽，dataURL 走 prompt.images）
 * - 运行中显示停止；结束后可重新生成
 */
import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { IconPaperclip, IconSquare, IconRefresh, IconCornerDownLeft } from '@tabler/icons-react';
import { t } from '../../i18n';
import { cn } from '../../lib/cn';
import { getRuntime, getWorkspace } from '../../runtime/runtimeRef';
import type { ImageAttachment, SlashCommand } from '@pi-agent/shared';

export interface ComposerProps {
  disabled: boolean;
  running: boolean;
  /** 当前会话 id（斜杠面板拉取 get_commands 用） */
  sessionId: string | null;
  /** 当前项目路径（@ 引用搜索根目录） */
  projectPath: string | null;
  onSend(text: string, images: ImageAttachment[]): void;
  onStop(): void;
  onRegenerate(): void;
  /** 斜杠命令执行（X-01 雏形：映射到内置动作或透传 prompt） */
  onSlashCommand(name: string): void;
}

interface ImageItem extends ImageAttachment {
  id: string;
  name: string;
}

const BUILTIN_SLASH: SlashCommand[] = [
  { name: 'compact', description: '压缩上下文', kind: 'builtin' },
  { name: 'clear', description: '清空当前会话消息（仅界面）', kind: 'builtin' },
];

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('读取失败'));
    reader.readAsDataURL(file);
  });
}

export function Composer({ disabled, running, sessionId, projectPath, onSend, onStop, onRegenerate, onSlashCommand }: ComposerProps) {
  const [text, setText] = useState('');
  const [images, setImages] = useState<ImageItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [fileList, setFileList] = useState<string[]>([]);
  const [slashList, setSlashList] = useState<SlashCommand[]>([]);
  const [menuIndex, setMenuIndex] = useState(0);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const showFileMenu = text.endsWith('@') || /@\S*$/.test(text);
  const showSlashMenu = text === '/' || (text.startsWith('/') && !text.includes(' '));
  const query = showFileMenu ? (text.split('@').pop() ?? '') : '';

  /* @ 引用：防抖拉取文件列表 */
  useEffect(() => {
    if (!showFileMenu) {
      setFileList([]);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      const workspace = getWorkspace();
      if (!workspace?.online || !projectPath) {
        setFileList([]);
        return;
      }
      workspace
        .searchFiles(projectPath, query, 20)
        .then((files: string[]) => (ctrl.signal.aborted ? undefined : setFileList(files)))
        .catch(() => setFileList([]));
    }, 150);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [showFileMenu, query, projectPath, text]);

  /* / 斜杠：get_commands（X-01 雏形） */
  useEffect(() => {
    if (!showSlashMenu) {
      setSlashList([]);
      return;
    }
    const runtime = getRuntime();
    if (!runtime || !sessionId) {
      setSlashList(BUILTIN_SLASH);
      return;
    }
    runtime
      .getCommands(sessionId)
      .then((cmds) => setSlashList([...BUILTIN_SLASH, ...cmds.filter((c) => !BUILTIN_SLASH.some((b) => b.name === c.name))]))
      .catch(() => setSlashList(BUILTIN_SLASH));
  }, [showSlashMenu, text, sessionId]);

  const pickFile = (): void => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = async () => {
      for (const file of input.files ?? []) {
        const dataUrl = await fileToDataUrl(file);
        setImages((prev) => [...prev, { id: `${file.name}-${Date.now()}`, name: file.name, mime: file.type || 'image/png', dataUrl }]);
      }
    };
    input.click();
  };

  /**
   * 拖拽分流（T-10）：
   * - 图片文件 → 附件缩略图（走 prompt.images）
   * - 其他文件 → 以 @路径 文本引用插入输入框
   */
  const onDrop = async (e: DragEvent<HTMLDivElement>): Promise<void> => {
    e.preventDefault();
    setDragOver(false);
    const files = [...e.dataTransfer.files];
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));
    const otherFiles = files.filter((f) => !f.type.startsWith('image/'));

    for (const file of imageFiles) {
      const dataUrl = await fileToDataUrl(file);
      setImages((prev) => [...prev, { id: `${file.name}-${Date.now()}`, name: file.name, mime: file.type || 'image/png', dataUrl }]);
    }
    if (otherFiles.length > 0) {
      // 浏览器不暴露绝对路径（安全限制）：插入文件名占位 + 提示用户补全路径
      const refs = otherFiles.map((f) => `@${f.name} `).join('');
      setText((prev) => (prev.endsWith(' ') || prev.length === 0 ? prev + refs : `${prev} ${refs}`));
    }
  };

  const replaceCurrentToken = (replacement: string): void => {
    if (showFileMenu) {
      const idx = text.lastIndexOf('@');
      setText(`${text.slice(0, idx)}@${replacement} `);
    } else if (showSlashMenu) {
      setText('');
      onSlashCommand(replacement);
    }
    setFileList([]);
    setSlashList([]);
    areaRef.current?.focus();
  };

  const send = (): void => {
    const trimmed = text.trim();
    if (trimmed.length === 0 && images.length === 0) return;
    onSend(trimmed, images.map(({ mime, dataUrl, path }) => ({ mime, dataUrl, path })));
    setText('');
    setImages([]);
    setFileList([]);
    setSlashList([]);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    const menuOpen = showFileMenu && fileList.length > 0;
    const slashOpen = showSlashMenu && slashList.length > 0;
    if ((menuOpen || slashOpen) && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const len = menuOpen ? fileList.length : slashList.length;
      setMenuIndex((i) => (e.key === 'ArrowDown' ? (i + 1) % len : (i - 1 + len) % len));
      return;
    }
    if ((menuOpen || slashOpen) && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      replaceCurrentToken(menuOpen ? (fileList[menuIndex] ?? '') : (slashList[menuIndex]?.name ?? ''));
      setMenuIndex(0);
      return;
    }
    if (e.key === 'Escape' && (menuOpen || slashOpen)) {
      e.preventDefault();
      setFileList([]);
      setSlashList([]);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  const canSend = !disabled && !running && (text.trim().length > 0 || images.length > 0);

  return (
    <div
      className={cn(
        'mx-auto w-full max-w-3xl px-4 pb-4',
        dragOver && 'opacity-80',
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => void onDrop(e)}
    >
      {/* @ 文件引用面板 */}
      {showFileMenu && fileList.length > 0 ? (
        <div className="mb-1 max-h-56 overflow-auto rounded-card border border-line bg-elevated shadow-[var(--pa-shadow-md)]">
          {fileList.map((f, i) => (
            <button
              key={f}
              type="button"
              className={cn(
                'block w-full truncate px-3 py-1.5 text-left text-xs text-secondary hover:bg-accent-soft',
                i === menuIndex && 'bg-accent-soft',
              )}
              onClick={() => replaceCurrentToken(f)}
              title={f}
            >
              @{f}
            </button>
          ))}
        </div>
      ) : null}

      {/* / 斜杠命令面板（X-01 雏形） */}
      {showSlashMenu && slashList.length > 0 ? (
        <div className="mb-1 max-h-56 overflow-auto rounded-card border border-line bg-elevated shadow-[var(--pa-shadow-md)]">
          {slashList.map((c, i) => (
            <button
              key={c.name}
              type="button"
              className={cn(
                'block w-full px-3 py-1.5 text-left text-xs hover:bg-accent-soft',
                i === menuIndex && 'bg-accent-soft',
              )}
              onClick={() => replaceCurrentToken(c.name)}
            >
              <span className="font-medium text-text">/{c.name}</span>
              {c.description ? <span className="ml-2 text-muted">{c.description}</span> : null}
            </button>
          ))}
        </div>
      ) : null}

      {/* 图片附件预览 */}
      {images.length > 0 ? (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {images.map((img) => (
            <div key={img.id} className="group relative">
              <img src={img.dataUrl} alt={img.name} className="h-14 w-14 rounded-card border border-line object-cover" />
              <button
                type="button"
                onClick={() => setImages((prev) => prev.filter((x) => x.id !== img.id))}
                className="absolute -right-1.5 -top-1.5 hidden h-5 w-5 items-center justify-center rounded-full border border-line bg-elevated text-xs text-secondary group-hover:flex"
                aria-label="移除图片"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div
        className={cn(
          'flex items-end gap-2 rounded-card border border-line bg-panel px-3 py-2',
          dragOver && 'border-accent',
        )}
      >
        <button
          type="button"
          onClick={pickFile}
          disabled={disabled}
          className="shrink-0 rounded p-1 text-muted hover:bg-accent-soft hover:text-text disabled:opacity-50"
          aria-label="添加图片附件"
        >
          <IconPaperclip size={16} />
        </button>

        <textarea
          ref={areaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          disabled={disabled}
          placeholder={t('composer.placeholder')}
          className="max-h-40 min-h-6 flex-1 resize-none bg-transparent text-sm text-text outline-none placeholder:text-muted"
        />

        {running ? (
          <button
            type="button"
            onClick={onStop}
            className="flex h-8 shrink-0 items-center gap-1 rounded-[6px] bg-danger px-3 text-xs font-medium text-white hover:opacity-90"
            aria-label={t('composer.stop')}
          >
            <IconSquare size={12} />
            {t('composer.stop')}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={onRegenerate}
              disabled={disabled}
              className="shrink-0 rounded p-1 text-muted hover:bg-accent-soft hover:text-text disabled:opacity-40"
              aria-label={t('composer.regenerate')}
              title={t('composer.regenerate')}
            >
              <IconRefresh size={16} />
            </button>
            <button
              type="button"
              onClick={send}
              disabled={!canSend}
              className={cn(
                'flex h-8 shrink-0 items-center gap-1 rounded-[6px] px-3 text-xs font-medium transition-colors',
                canSend ? 'bg-accent text-white hover:bg-accent-hover' : 'bg-accent-soft text-muted',
              )}
              aria-label={t('composer.send')}
            >
              {t('composer.send')}
              <IconCornerDownLeft size={12} />
            </button>
          </>
        )}
      </div>
      <div className="mt-1 px-1 text-[11px] text-muted">{t('composer.hint')}</div>
    </div>
  );
}
