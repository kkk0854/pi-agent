/**
 * OpenSessionRequest → pi CLI 参数（架构 §2.3 pi/args.ts）。
 * 硬约束：
 * - 一律 `--mode rpc`
 * - 权限档位④ read-only 映射 `--tools read,grep,find,ls`（TIER_TO_SPAWN_TOOLS，W-05）
 * - cwd 不进 argv：由 spawn 的 options.cwd 承担（本模块一并返回 cwd）
 * - 返回参数数组，由 spawn 直传（argv 不走 shell 拼接，R-07）
 */
import os from 'node:os';
import { TIER_TO_SPAWN_TOOLS, type OpenSessionRequest } from '@pi-agent/shared';

export interface PiArgs {
  /** spawn argv（不含可执行文件本身，从第一个参数开始） */
  argv: string[];
  /** 子进程工作目录：worktreePath 优先，其次 projectPath；都没有 → 用户主目录（默认工作区 P-05） */
  cwd: string;
}

export interface BuildPiArgsOptions {
  /** 默认工作目录（默认 os.homedir()，测试可注入） */
  homeDir?: string;
  /**
   * 内置审批扩展路径（extensions/pi-agent-permissions）。
   * 提供时追加 `--extension <path>`（T03：tool_call 拦截 + 审批通道）。
   */
  extensionPath?: string;
  /**
   * 额外扩展 argv（T05：spawnExtensionArgs 产出，已按启用态过滤；
   * 形如 ['--extension', path, ...]，支持 builtin + user 多扩展）。
   */
  extraExtensionArgs?: string[];
}

/**
 * 组装 pi 启动参数。
 * @param req 打开会话请求（来自 web 端运行时）
 * @param opts homeDir / extensionPath（测试与装配可注入）
 */
export function buildPiArgs(req: OpenSessionRequest, opts: BuildPiArgsOptions = {}): PiArgs {
  const argv: string[] = ['--mode', 'rpc'];

  // 内置审批扩展（T03）：审批条 / 危险清单 / 审计的前置通道
  if (opts.extensionPath && opts.extensionPath.length > 0) {
    argv.push('--extension', opts.extensionPath);
  }

  // T05：扩展启用态接线（builtin 过滤 + user 扩展），每次 spawn 求值
  if (opts.extraExtensionArgs && opts.extraExtensionArgs.length > 0) {
    argv.push(...opts.extraExtensionArgs);
  }

  // 恢复会话：--session <path> 优先（C-03），其次 --session-id
  if (req.piSessionPath && req.piSessionPath.length > 0) {
    argv.push('--session', req.piSessionPath);
  } else if (req.piSessionId && req.piSessionId.length > 0) {
    argv.push('--session-id', req.piSessionId);
  }

  // 会话名
  if (req.title && req.title.trim().length > 0) {
    argv.push('--name', req.title.trim());
  }

  // 模型与思考档位
  if (req.model) {
    argv.push('--provider', req.model.provider, '--model', req.model.modelId);
  }
  if (req.thinking) {
    argv.push('--thinking', req.thinking);
  }

  // 工具白名单：显式 tools 优先，否则按权限档位映射（④ 只读档 → read,grep,find,ls）
  const tools = req.tools ?? TIER_TO_SPAWN_TOOLS[req.permissionTier];
  if (tools && tools.length > 0) {
    argv.push('--tools', tools.join(','));
  }

  // 额外参数（透传，供排障 / 实验）
  if (req.extraArgs && req.extraArgs.length > 0) {
    argv.push(...req.extraArgs);
  }

  const cwd = req.worktreePath ?? req.projectPath ?? opts.homeDir ?? os.homedir();
  return { argv, cwd };
}
