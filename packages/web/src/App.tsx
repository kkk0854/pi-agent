/**
 * App 根（T02 版）：
 * - 主题应用（亮/暗/跟随系统，S-03）
 * - 启动引导：createRuntime（auto 降级 Mock + host 未运行引导分支）
 *   → setRuntimeRefs / setRuntimeMeta → workspaceApi 双轨装填 stores
 * - RuntimeEvent 订阅：路由到 chatStore（会话/消息/审批/错误）
 */
import { useEffect } from 'react';
import type { HostEndpoint, RuntimeEvent } from '@pi-agent/shared';
import { useAppStore } from './store';
import { useChatStore } from './store/chatStore';
import { AppShell } from './features/shell/AppShell';
import { TooltipProvider } from './components/ui/Tooltip';
import { ToastProvider, useToast } from './components/ui/Toast';
import { createRuntime } from './runtime/createRuntime';
import { setRuntimeRefs } from './runtime/runtimeRef';
import { createWorkspaceApi } from './lib/workspaceApi';
import { handleUiRequest, snapshotForWrite, recordWriteToolEnd } from './lib/approvalFlow';
import { trackWriteToolStart, takeWriteToolEnd } from './lib/changesPipeline';
import { permissionEngine } from './lib/permissionEngine';
import { isTauri } from './host/tauriIpc';
import { installDesktopBridge } from './host/TauriHostBridge';
import { useActivityStore } from './store/activityStore';
import { useCommandPaletteStore } from './features/command/commandPaletteStore';
import { CommandPalette } from './features/command/CommandPalette';
import { MediaLightbox } from './features/media/MediaLightbox';

function useThemeEffect(): void {
  const theme = useAppStore((s) => s.theme);
  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia('(prefers-color-scheme: dark)');

    const apply = (): void => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches);
      root.classList.toggle('dark', dark);
    };
    apply();

    if (theme === 'system') {
      media.addEventListener('change', apply);
      return () => media.removeEventListener('change', apply);
    }
  }, [theme]);
}

/** bootstrap 防重入标记（模块级，StrictMode 双 effect 防护） */
let bootstrapRan = false;

/** 全局快捷键：Cmd/Ctrl+K 打开命令面板（P-06） */
function useCommandPaletteHotkey(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        useCommandPaletteStore.getState().toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** 启动引导：运行时创建 + 工作区装填 + 事件接线（仅执行一次） */
function useRuntimeBootstrap(): void {
  const setRuntimeMeta = useAppStore((s) => s.setRuntimeMeta);
  const settings = useAppStore((s) => s.settings);
  const replaceSettings = useAppStore((s) => s.replaceSettings);
  const showToast = useToast();

  useEffect(() => {
    // StrictMode（dev）会双调用 effect：第二次直接跳过，避免创建两个 runtime /
    // 两条 WS 连接 / 泄漏的 pi 子进程（生产构建无双调用，但防护两全）
    if (bootstrapRan) return;
    bootstrapRan = true;
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    void (async () => {
      // T05 桌面壳：Rust initialization_script 注入的端点优先（dist 内构建期注入的是陈旧快照）
      const endpoint: HostEndpoint | null = window.__PI_AGENT_HOST_OVERRIDE__ ?? window.__PI_AGENT_HOST__ ?? null;

      // 桌面桥（Z-03/Z-06/A-09）：仅 Tauri 环境装配；Web 版零行为
      if (isTauri()) installDesktopBridge(endpoint);

      const result = await createRuntime({
        mode: settings.runtimeMode,
        host: endpoint ?? undefined,
        maxConcurrentAgents: settings.maxConcurrentAgents,
        idleRecycleMs: settings.idleRecycleMs,
        connectTimeoutMs: settings.connectTimeoutMs,
        uiRequestTimeoutMs: settings.uiRequestTimeoutMs,
        approvalTimeoutPolicy: settings.approvalTimeoutPolicy,
        stallWarnMs: settings.stallWarnMs,
        piPath: settings.piPath,
      });
      if (cancelled) {
        void result.runtime.dispose();
        return;
      }

      setRuntimeRefs({ runtime: result.runtime, hostClient: result.hostClient });
      setRuntimeMeta(result.mode, result.reason ?? null, endpoint !== null);

      // 工作区双轨：host 可达走 REST；否则 localStorage 兜底
      const workspace = createWorkspaceApi(result.hostClient);
      setRuntimeRefs({ workspace });

      // T03 A-13：危险清单合并下发到前端策略引擎（默认 + 自定义 + 覆盖）
      workspace
        .listDangerousPatterns()
        .then((patterns) => permissionEngine.setPatterns(patterns))
        .catch(() => undefined);

      try {
        const [projects, sessions] = await Promise.all([workspace.listProjects(), workspace.listSessions()]);
        if (cancelled) return;
        const st = useAppStore.getState();
        for (const p of projects) st.upsertProject(p);
        for (const s of sessions) st.upsertSession(s);
      } catch {
        // 装填失败保持空列表（空态引导可见）
      }

      // host 设置同步（在线时以 host settings.json 为准，回写本地切片）
      if (workspace.online) {
        workspace
          .getSettings()
          .then((remote) => replaceSettings({ ...settings, ...remote }))
          .catch(() => undefined);
      }

      // 事件接线：RuntimeEvent → 审批流 / 看板活动 / chatStore（错误提示经 Toast）
      unsubscribe = result.runtime.onEvent((e: RuntimeEvent) => {
        if (e.t === 'error') {
          showToast(e.message, { level: 'error' });
        }
        if (e.t === 'ui.notify') {
          showToast(e.message, { level: e.level === 'error' ? 'error' : e.level === 'warning' ? 'warning' : 'info' });
        }
        // T03 审批流：ui.request 先经 PermissionEngine（自动应答/弹条），不进 chatStore
        if (e.t === 'ui.request') {
          handleUiRequest(e.sessionId, e.req);
          return;
        }
        // T04b 变更真实链路：写工具 start 兜底快照（双保险）+ end 后读文件入变更列表
        if (e.t === 'tool.start') {
          const p = trackWriteToolStart(e.toolCallId, e.toolName, e.args);
          if (p) snapshotForWrite(p);
        }
        if (e.t === 'tool.end') {
          const p = takeWriteToolEnd(e.toolCallId);
          if (p) recordWriteToolEnd(p);
        }
        // K-01/K-02 看板活动标记（对全部会话，含非当前会话）
        if (e.t === 'agent.start' || e.t === 'turn.start') {
          useActivityStore.getState().mark(e.sessionId, 'running');
        }
        if (e.t === 'agent.settled') {
          useActivityStore.getState().mark(e.sessionId, 'ready');
        }
        // C-03 双轨持久化：pi 会话文件/名称回写（host REST + 本地兜底）
        if (e.t === 'session.info' && (e.sessionFile || e.name)) {
          const st = useAppStore.getState();
          const sid = st.currentSessionId;
          const session = typeof sid === 'string' ? st.sessions.find((s) => s.id === sid) : undefined;
          if (session && typeof sid === 'string') {
            const patch = {
              ...(e.sessionFile ? { piSessionPath: e.sessionFile } : {}),
              ...(e.name ? { title: e.name } : {}),
            };
            st.upsertSession({ ...session, ...patch });
            void workspace.updateSession(sid, patch).catch(() => undefined);
          }
        }
        useChatStore.getState().applyEvent(e);
      });

      // 首个会话：有历史则选最近，否则不自动建（空态引导）
      const st = useAppStore.getState();
      if (st.currentSessionId === null && st.sessions.length > 0) {
        st.setCurrentSession(st.sessions[0]!.id);
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
    // 仅在挂载时执行一次（设置变化经 replaceSettings 整包同步，不重建运行时）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function useRuntimeBootstrapInsideProviders(): void {
  useRuntimeBootstrap();
  useThemeEffect();
  useCommandPaletteHotkey();
}

function Bootstrap() {
  useRuntimeBootstrapInsideProviders();
  return (
    <>
      <AppShell />
      <CommandPalette />
      <MediaLightbox />
    </>
  );
}

export default function App() {
  return (
    <TooltipProvider>
      <ToastProvider>
        <Bootstrap />
      </ToastProvider>
    </TooltipProvider>
  );
}
