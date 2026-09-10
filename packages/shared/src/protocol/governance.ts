/**
 * 治理域契约（T03）：审计日志（A-10）、用量统计、诊断（V-02）、
 * Git 分支 chip（G-01）、密钥存管。
 * 自动化类型复用 workspace.ts 的 Automation 族（单一事实来源）。
 */
import type { RiskLevel } from './permissions';

/* ---------- 审计日志（A-10） ---------- */

export interface AuditEntry {
  /** ISO 时间 */
  at: string;
  sessionId: string;
  toolName: string;
  /** 已脱敏的参数摘要 */
  argsSummary: string;
  /** 决策时的生效档位 */
  tier: string;
  /** allow / deny / timeout-deny / timeout-allow / auto-allow / auto-deny */
  result: string;
  /** 命中的危险规则 id（未命中为 null） */
  matchedPatternId: string | null;
  /** 风险级别 */
  risk: RiskLevel;
}

/* ---------- 用量统计 ---------- */

export interface UsageRecord {
  sessionId: string;
  projectId: string | null;
  /** ISO 时间 */
  at: string;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  cost: number;
}

export interface UsageGroup {
  key: string;
  totalTokens: number;
  cost: number;
  turns: number;
}

/** 日 × 时段桶（Q-05 热力图数据源） */
export interface UsageDayHour {
  /** YYYY-MM-DD */
  day: string;
  /** 0-23 */
  hour: number;
  totalTokens: number;
  cost: number;
  turns: number;
}

export interface UsageSummary {
  bySession: UsageGroup[];
  byProject: UsageGroup[];
  byDay: UsageGroup[];
  /** 日 × 时段强度（Q-05；T04b 起提供） */
  byDayHour: UsageDayHour[];
}

/* ---------- 诊断（V-02） ---------- */

export type DoctorVerdict = 'pass' | 'warn' | 'fail';

export interface DoctorCheck {
  id: string;
  label: string;
  verdict: DoctorVerdict;
  /** 人类可读详情（已脱敏） */
  detail: string;
}

export interface DoctorReport {
  at: string;
  checks: DoctorCheck[];
}

/* ---------- Git 分支 chip（G-01） ---------- */

export interface GitWorktree {
  path: string;
  head: string;
  branch: string | null;
  /** 该 path 是否等于项目路径 */
  isMain: boolean;
}

/* ---------- 密钥存管（T03 只做加密落盘；钥匙串留 T05 接口） ---------- */

export interface SecretMeta {
  key: string;
  /** 值永不回传原文，仅返回是否存在与更新时间 */
  updatedAt: string;
}

export interface SecretValue {
  key: string;
  value: string;
}
