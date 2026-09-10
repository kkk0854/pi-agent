/**
 * 运行时单例引用（模块级，非 hook 上下文也能拿到 runtime 与 workspaceApi）。
 * App 挂载时 createRuntime → setRuntimeRefs；store 订阅走事件分发，不经此直连。
 */
import type { AgentRuntime } from '@pi-agent/shared';
import type { WorkspaceApi } from '../lib/workspaceApi';
import type { HostClient } from '../lib/hostClient';

interface RuntimeRefs {
  runtime: AgentRuntime | null;
  workspace: WorkspaceApi | null;
  /** host REST 客户端（离线为 null；诊断/危险清单 CRUD 等治理接口直连用） */
  hostClient: HostClient | null;
}

const refs: RuntimeRefs = { runtime: null, workspace: null, hostClient: null };

export function setRuntimeRefs(next: Partial<RuntimeRefs>): void {
  if (next.runtime !== undefined) refs.runtime = next.runtime;
  if (next.workspace !== undefined) refs.workspace = next.workspace;
  if (next.hostClient !== undefined) refs.hostClient = next.hostClient;
}

export function getRuntime(): AgentRuntime | null {
  return refs.runtime;
}

export function getWorkspace(): WorkspaceApi | null {
  return refs.workspace;
}

export function getHostClient(): HostClient | null {
  return refs.hostClient;
}
