/**
 * 三栏壳（S-01）：左栏（项目/会话）· 中栏（聊天）· 右栏（可折叠）。
 * 比例可拖拽并记忆（宽度持久化在 uiStore → localStorage）。
 */
import { useCallback, useEffect, useRef } from 'react';
import { useAppStore } from '../../store';
import { TitleBar } from './TitleBar';
import { Sidebar } from './Sidebar';
import { ChatColumn } from './ChatColumn';
import { RightAside } from './RightAside';
import { KanbanView } from '../kanban/KanbanView';
import { SettingsView } from '../settings/SettingsView';

type DragSide = 'sidebar' | 'right' | null;

export function AppShell() {
  const sidebarWidth = useAppStore((s) => s.sidebarWidth);
  const rightAsideWidth = useAppStore((s) => s.rightAsideWidth);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const rightAsideCollapsed = useAppStore((s) => s.rightAsideCollapsed);
  const setSidebarWidth = useAppStore((s) => s.setSidebarWidth);
  const setRightAsideWidth = useAppStore((s) => s.setRightAsideWidth);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const toggleRightAside = useAppStore((s) => s.toggleRightAside);
  const mainView = useAppStore((s) => s.mainView);
  const dragSide = useRef<DragSide>(null);

  const onMouseMove = useCallback(
    (e: MouseEvent) => {
      if (dragSide.current === 'sidebar') {
        setSidebarWidth(e.clientX);
      } else if (dragSide.current === 'right') {
        setRightAsideWidth(window.innerWidth - e.clientX);
      }
    },
    [setSidebarWidth, setRightAsideWidth],
  );

  const onMouseUp = useCallback(() => {
    dragSide.current = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  const startDrag = (side: Exclude<DragSide, null>) => () => {
    dragSide.current = side;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        {!sidebarCollapsed ? (
          <>
            <div style={{ width: sidebarWidth }} className="min-h-0 shrink-0">
              <Sidebar />
            </div>
            <div
              role="separator"
              aria-orientation="vertical"
              onMouseDown={startDrag('sidebar')}
              onDoubleClick={toggleSidebar}
              className="w-1 shrink-0 cursor-col-resize bg-line transition-colors hover:bg-accent"
            />
          </>
        ) : null}

        {mainView === 'chat' ? <ChatColumn /> : null}
        {mainView === 'kanban' ? <KanbanView /> : null}
        {mainView === 'settings' ? <SettingsView /> : null}

        {!rightAsideCollapsed ? (
          <>
            <div
              role="separator"
              aria-orientation="vertical"
              onMouseDown={startDrag('right')}
              onDoubleClick={toggleRightAside}
              className="w-1 shrink-0 cursor-col-resize bg-line transition-colors hover:bg-accent"
            />
            <div style={{ width: rightAsideWidth }} className="min-h-0 shrink-0">
              <RightAside />
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
