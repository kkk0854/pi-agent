/** 顶部栏：品牌 + 项目/权限/主题 chip + 右栏开关（PRD §9.2）；桌面壳下含自绘窗控（Z-03/Z-04） */
import {
  IconDeviceDesktop,
  IconMinus,
  IconMoon,
  IconSettings,
  IconSun,
  IconX,
  IconLayoutSidebarRightExpand,
  IconLayoutSidebarRightCollapse,
} from '@tabler/icons-react';
import { PERMISSION_TIERS } from '@pi-agent/shared';
import { t, type MessageKey } from '../../i18n';
import { useAppStore, type ThemePreference } from '../../store';
import { isTauri } from '../../host/tauriIpc';
import { desktopSystemApi } from '../../host/TauriHostBridge';
import { Button } from '../../components/ui/Button';
import { Tooltip } from '../../components/ui/Tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/DropdownMenu';
import { useToast } from '../../components/ui/Toast';

const THEME_ICON: Record<ThemePreference, typeof IconSun> = {
  light: IconSun,
  dark: IconMoon,
  system: IconDeviceDesktop,
};

const THEME_SWITCHED_KEY: Record<ThemePreference, MessageKey> = {
  light: 'theme.switched.light',
  dark: 'theme.switched.dark',
  system: 'theme.switched.system',
};

export function TitleBar() {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const rightAsideCollapsed = useAppStore((s) => s.rightAsideCollapsed);
  const toggleRightAside = useAppStore((s) => s.toggleRightAside);
  const globalTier = useAppStore((s) => s.globalTier);
  const runtimeMode = useAppStore((s) => s.runtimeMode);
  const runtimeReason = useAppStore((s) => s.runtimeReason);
  const projects = useAppStore((s) => s.projects);
  const currentProjectId = useAppStore((s) => s.currentProjectId);
  const showToast = useToast();
  // 桌面壳（Z-03/Z-04）：自绘窗控 + 拖拽区；Web 版为 null 不渲染
  const windowControls = isTauri() ? (desktopSystemApi()?.windowControls ?? null) : null;

  const ThemeIcon = THEME_ICON[theme];
  const tierLabel = PERMISSION_TIERS.find((x) => x.tier === globalTier)?.label ?? globalTier;
  const currentProject = projects.find((p) => p.id === currentProjectId) ?? null;

  const applyTheme = (next: ThemePreference): void => {
    setTheme(next);
    showToast(t(THEME_SWITCHED_KEY[next]), { level: 'info' });
  };

  return (
    <header
      data-tauri-drag-region={isTauri() || undefined}
      className="flex h-10 shrink-0 select-none items-center gap-2 border-b border-line bg-panel px-3"
    >
      <span className="text-sm font-semibold text-text">{t('app.name')}</span>
      <span className="hidden text-xs text-muted sm:inline">{t('app.subtitle')}</span>

      <div className="ml-3 flex items-center gap-1 rounded-[6px] border border-line px-2 py-0.5 text-xs text-secondary">
        <span className="text-muted">{t('titlebar.project')}</span>
        <span className="max-w-40 truncate">{currentProject?.name ?? t('titlebar.project.none')}</span>
      </div>

      {/* 运行时徽章：真实 / Mock 模式（降级理由见聊天区引导横幅） */}
      {runtimeMode === 'mock' ? (
        <Tooltip content={runtimeReason ?? t('app.mockBadge')}>
          <span className="cursor-default rounded-[6px] border border-warning/50 bg-warning/5 px-2 py-0.5 text-xs font-medium text-warning">
            {t('app.mockBadge')}
          </span>
        </Tooltip>
      ) : null}

      <div className="ml-auto flex items-center gap-1.5">
        <Tooltip content={t('titlebar.permission')}>
          <span className="cursor-default rounded-[6px] border border-line px-2 py-0.5 text-xs text-secondary">
            {t('titlebar.permission')}：{tierLabel}
          </span>
        </Tooltip>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" aria-label={t('theme.label')}>
              <ThemeIcon size={15} />
              <span className="text-xs">{t(`theme.${theme}`)}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem active={theme === 'light'} onSelect={() => applyTheme('light')}>
              {t('theme.light')}
            </DropdownMenuItem>
            <DropdownMenuItem active={theme === 'dark'} onSelect={() => applyTheme('dark')}>
              {t('theme.dark')}
            </DropdownMenuItem>
            <DropdownMenuItem active={theme === 'system'} onSelect={() => applyTheme('system')}>
              {t('theme.system')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Tooltip content={t('titlebar.toggleRight')}>
          <Button variant="ghost" size="sm" onClick={toggleRightAside} aria-label={t('titlebar.toggleRight')}>
            {rightAsideCollapsed ? (
              <IconLayoutSidebarRightExpand size={15} />
            ) : (
              <IconLayoutSidebarRightCollapse size={15} />
            )}
          </Button>
        </Tooltip>

        <Tooltip content={`${t('common.settings')}（${t('common.disabledHint')}）`}>
          <Button variant="ghost" size="sm" disabled aria-label={t('common.settings')}>
            <IconSettings size={15} />
          </Button>
        </Tooltip>

        {/* 自绘窗控（Z-03/Z-04）：仅桌面壳渲染；关窗=隐藏到托盘（Z-06） */}
        {windowControls ? (
          <div className="ml-1 flex items-center border-l border-line pl-1.5">
            <button
              type="button"
              aria-label={t('titlebar.minimize')}
              onClick={windowControls.minimize}
              className="rounded-[6px] p-1.5 text-muted hover:bg-accent-soft hover:text-text"
            >
              <IconMinus size={14} />
            </button>
            <button
              type="button"
              aria-label={t('titlebar.maximize')}
              onClick={windowControls.maximize}
              className="rounded-[6px] p-1.5 text-muted hover:bg-accent-soft hover:text-text"
            >
              <IconDeviceDesktop size={14} />
            </button>
            <button
              type="button"
              aria-label={t('titlebar.close')}
              onClick={windowControls.close}
              className="rounded-[6px] p-1.5 text-muted hover:bg-danger/10 hover:text-danger"
            >
              <IconX size={14} />
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
