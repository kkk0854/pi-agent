# 更新日志

## v0.1.0 修订构建（2026-09-10，hotfix）—— 修复桌面版启动无响应

> 版本号仍为 0.1.0，安装包文件名不变；需重新安装覆盖旧版。

**问题**：v0.1.0 安装后双击启动无任何反应（进程直接退出）。

**根因**：`src-tauri/src/sidecar.rs` 的 `find_sidecar_exe()` 只按**开发布局**匹配 `pi-agent-host-<triple>.exe`；
而 Tauri 打包 `externalBin` 时会把 sidecar 打平为 `pi-agent-host.exe`（去掉 triple 后缀）并放在主程序同级目录，
安装后精确匹配失败 → setup hook 直接 `panic`（`sidecar exe 未找到`），窗口根本没被创建。

该代码本地始终无法运行验证（本机 cargo 编译被环境级崩溃挡在我们自己的 crate 之前），仅由 CI 云构建验证「编译通过」。

**修复**（提交 `3a1fc1d`）：

1. `sidecar.rs::find_sidecar_exe()` 增加安装布局候选：优先匹配主程序同目录的 `pi-agent-host.exe`，再回退 `pi-agent-host-*.exe` 开发布局。
2. `lib.rs` setup hook：sidecar 缺失不再 panic —— 记录 stderr 日志后继续开窗，前端进入离线/Mock 模式，保证任何情况下窗口都能起来。

**验证**：GitHub Actions [Run #5](https://github.com/kkk0854/pi-agent/actions/runs/34426366550) 构建成功，产出新版安装包（msi/nsis）。

---

## v0.1.0（2026-09-10）—— 首个完整交付

对标 grok-app 的 `pi` coding agent 图形化工作台，Phase 0-4 全部落地。

- **T01** 地基：pnpm workspace + `shared` 契约层（AgentRuntime / normalizer / 权限协议）+ 53 单测
- **T02** Node 宿主 + 双运行时（真实 `pi --mode rpc` / Mock）+ 聊天全链路（真实 pi E2E 通过）
- **T03** 四档权限审批 + 内置 pi 审批扩展 + 看板 + 设置/Doctor（真实 pi `e2e-approval` 通过）
- **T04a** 分叉与分支树、Diff + CodeMirror 6 内置编辑器、媒体查看器、命令面板（Ctrl/Cmd+K）
- **T04b** 本地 REST sessionApi、手机镜像、自动化调度、git worktree、用量热力图、扩展面板
- **T05** Tauri 2 桌面壳：内嵌 Node sidecar、Windows 凭据管理器钥匙串、无边框自绘窗控、托盘、审批通知深链

质量门：typecheck 0 错 / **183 测试全绿** / lint 0 错 / CI 云构建出 .msi + NSIS 安装包。

PRD 171 条覆盖：**已实现 128 / 骨架 15 / 本轮不做 28**，逐条明细见 `docs/REPORTS/T05-DELIVERY-REPORT.md` §6。
