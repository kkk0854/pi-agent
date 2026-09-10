/**
 * 审批/扩展 UI 请求存储（A-06 / A-09）：
 * - 同一会话同一时刻至多一个挂起请求（pi 串行 tool_call）
 * - A-09 后台审批：请求保留在本 store（按会话索引），切走不丢，回来仍可处理
 * - 超时兜底（A-14）：approvalTimeoutPolicy 默认 deny
 */
import { create } from 'zustand';
import type { ExtensionUIRequest, RiskLevel } from '@pi-agent/shared';

export interface PendingItem {
  sessionId: string;
  req: ExtensionUIRequest;
  /** approval = 内置审批扩展的 confirm；ui = 其他扩展 UI（select/input/editor/confirm） */
  kind: 'approval' | 'ui';
  receivedAt: number;
  timeoutAt: number;
  /** 以下仅 kind='approval' 有值 */
  toolName?: string;
  argsSummary?: string;
  risk?: RiskLevel;
  tier?: string;
  matchedPatternId?: string | null;
  matchedDescription?: string | null;
}

interface ApprovalState {
  items: PendingItem[];
  push(item: PendingItem): void;
  /** 取走并移除（应答后调用）；@returns 被移除的项（不存在为 undefined） */
  take(requestId: string): PendingItem | undefined;
  bySession(sessionId: string | null): PendingItem[];
}

export const useApprovalStore = create<ApprovalState>()((set, get) => ({
  items: [],

  push(item: PendingItem): void {
    set((s) => ({
      // 同会话幂等：同 requestId 不重复；同会话新请求顶替旧请求（pi 串行语义）
      items: [...s.items.filter((i) => i.req.id !== item.req.id && i.sessionId !== item.sessionId), item],
    }));
  },

  take(requestId: string): PendingItem | undefined {
    const found = get().items.find((i) => i.req.id === requestId);
    if (found) {
      set((s) => ({ items: s.items.filter((i) => i.req.id !== requestId) }));
    }
    return found;
  },

  bySession(sessionId: string | null): PendingItem[] {
    if (sessionId === null) return [];
    return get().items.filter((i) => i.sessionId === sessionId);
  },
}));
