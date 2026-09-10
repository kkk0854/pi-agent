# T05 交付报告（最终版）

## 1. 交付范围
Tauri 2 桌面壳（Z-01..Z-10 按优先级）+ E-06/U-07/A-09/Q-03 + host 遗留（扩展 spawn 参数、watcher 动态重挂）。构建方式：本机企业环境无法编译 → **GitHub Actions 云构建出包**。

## 2. 文件树（新增/修改）

```
src-tauri/
  Cargo.toml                 # tauri 2.11.5 / tauri-plugin-notification / keyring / windows-sys
  build.rs
  Cargo.lock                 # 入库，CI 复现构建
  tauri.conf.json            # frontendDist=../packages/web/dist; externalBin=binaries/pi-agent-host;
                             # resources=binaries/pi-agent-host.cjs + ../extensions/pi-agent-permissions/
  tauri.windows.conf.json    # webview2 引导（Windows 专用 overlay）
  capabilities/default.json  # core:event + 自定义命令白名单
  icons/32x32.png 128x128.png icon.png icon.ico   # scripts/make-icons.ps1 生成
  .cargo/config.toml         # 仅 build-override 加速配置（无机器专属路径）
  src/main.rs lib.rs         # 无边框窗（decorations:false + 8px resize hit-test，window.rs）
                             # 关窗→托盘拦截（close_to_tray；仅托盘退出真退）
                             # Focused(true) → take_deeplink → emit approval:deeplink（A-09）
                             # setup: sidecar spawn + keybridge 启动 + tray 创建
  src/sidecar.rs             # Z-01：exe/cjs/扩展目录多候选定位、崩溃 3s 重启、
                             # __PI_AGENT_HOST_OVERRIDE__ 注入、host_endpoint 命令、
                             # PI_AGENT_EXTENSION_DIR / PI_AGENT_KEYBRIDGE_* 注入
  src/keychain.rs            # keyring → Windows Credential Manager（get/set/delete_secret）
  src/keybridge.rs           # 127.0.0.1 随机 token HTTP 桥：host secrets.ts → OS 钥匙串
  src/tray.rs                # 托盘图标 + 菜单（显示主窗/退出）
  src/notify.rs              # 桌面通知 + DeepLink 状态（A-09）
  src/window.rs              # window_minimize/toggle_maximize/is_maximized/close_to_tray/set_title
  src/cli.rs                 # E-06 骨架（open path/logs 命令）
.github/workflows/tauri-build.yml  # 云构建：workflow_dispatch + tag v* → windows-latest →
                                   # pnpm tauri:build → 上传 msi/nsis artifacts
scripts/
  make-sidecar.mjs           # esbuild bundle host → pi-agent-host.cjs + process.execPath(node.exe)
                             # 复制为 pi-agent-host-<rustc host triple>.exe（目标机无需 Node）
  make-icons.ps1             # System.Drawing 生成全套图标（纯 ASCII，PowerShell 5.1 兼容）
packages/web/src/
  host/tauriIpc.ts           # __TAURI_INTERNALS__ 检测 + invoke/listen（浏览器恒 null）
  host/TauriHostBridge.ts    # 仅替换 system.windowControls / notify / secret 三能力；
                             # WS/REST/fs/媒体仍走 HTTP sidecar；approval:deeplink→切会话；
                             # host:endpoint-changed→重载（崩溃重启后）
  vite-env.d.ts              # __TAURI_INTERNALS__ / __PI_AGENT_HOST_OVERRIDE__ 类型
  features/shell/TitleBar.tsx     # Tauri 下窗控三键 + data-tauri-drag-region（Web 版零变化）
  App.tsx                    # endpoint 优先 __PI_AGENT_HOST_OVERRIDE__
  lib/approvalFlow.ts        # 挂起审批 → bridge.notify（deepLink=sessionId，A-09）
packages/host/src/
  server/secrets.ts          # Q-03：PI_AGENT_KEYBRIDGE_URL/TOKEN 存在时优先钥匙串（keybridge），
                             # 失败回退 AES-GCM 文件 0600；明文旧键自动迁移
  server/extensions.ts       # 导出 spawnExtensionArgs（extensions.json 启用态 → spawn 参数）
  pi/args.ts                 # extraExtensionArgs
  runtime/SessionManager.ts  # 注入 extraExtensionArgs
  index.ts                   # 接线：EXTENSION_DIR 候选解析（env/cwd/源码树）、watcher 动态重挂
package.json（根）           # tauri/tauri:dev/tauri:build/sidecar/icons scripts；@tauri-apps/cli、esbuild
```

## 3. 验证证据

| 项 | 状态 |
|---|---|
| TS typecheck / 测试 / lint | ✅ 0 错误 / 241 测试（shared 76 + host 67 + web 98，2026-09-10 复核实跑）/ 0（CI 出包同一份代码） |
| pnpm build 前端产物 | ✅ 本机验证 |
| sidecar 冒烟（bundle → exe 启动 → listen → host.json） | ✅ 本机验证 |
| Rust 编译 + 打包（.msi/NSIS） | ✅ **GitHub Actions Run #4 验证**（本机环境崩溃绕过） |
| 产物 | ✅ `release/pi-agent_0.1.0_x64_en-US.msi`（35.9MB）、`pi-agent_0.1.0_x64_zh-CN.msi`（35.9MB）、`pi-agent_0.1.0_x64-setup.exe`（NSIS 24.6MB） |

### M15 自查清单
| 项 | 状态 |
|---|---|
| .msi 产出 | ✅ 已验证（CI Run #4，35.9MB ×2 语言） |
| 安装后与 Web 版一致 | ⏳ 待用户安装后验证（同一份前端产物 + sidecar 注入，结构上一致） |
| 窗控无死区（8px 可调窗 + 三键） | ⏳ 待用户安装后验证 |
| 关窗到托盘 | ⏳ 待用户安装后验证 |
| 通知点击直达审批 | ⏳ 待用户安装后验证（深链链路代码已闭环：notify→Focused→approval:deeplink→切会话） |
| 密钥入钥匙串且磁盘无明文 | ⏳ 待用户安装后验证（keyring→Credential Manager；文件态回退为 AES-GCM 密文） |

**安装与验证步骤**：双击 `release/pi-agent_0.1.0_x64_zh-CN.msi`（或免安装运行 `pi-agent_0.1.0_x64-setup.exe`）→ 启动后：① 拖拽窗口四边/三角确认 8px 可调带，右上三键最小化/最大化/关闭；② 点关闭 → 窗口消失但托盘图标在 → 托盘菜单「退出」才真退；③ 发起会话触发危险命令审批 → 收到桌面通知 → 点击通知窗口聚焦并切到对应会话审批条；④ 设置里保存一个 provider 密钥 → `Win+R` 输入 `control keymgr.dll` 查看凭据管理器出现 `pi-agent` 条目，且 `AppData\Roaming\pi-agent\secrets.json` 中无明文。

## 4. 坑（9 条）
1. **windows-gnu 工具链缺 `as.exe`**：windows crate raw-dylib 需要 dlltool→GNU as。解法：llvm-tools 组件的 `llvm-ar.exe` 是多调用二进制，复制为 `dlltool.exe` 即变成 llvm-dlltool（无需 as），并补 `libgcc_s_seh-1.dll`/`libwinpthread-1.dll` 到同目录。
2. **本机 tauri build-script 0xC0000005（未解，绕过）**：仅 tauri 的 build script 崩（~200 个其他 build script 正常），跨 tauri 2.10.1/2.11.5、rustc 1.97/1.98、工作区内外 target 目录、多套 codegen/32MB 栈、Defender 排除目录后全新二进制均复现；事件日志 BEX64/ntdll，Exploit Protection 全 NOTSET。结论：本机环境级（疑第三方 EDR/沙箱注入），最终以 GitHub Actions 云构建绕过。
3. **rustup toolchain install 默认装 msvc-host**：GNU 要显式 `1.97.0-x86_64-pc-windows-gnu`。
4. **[target.*.rustflags] 不作用于 build-script**（host 产物）：调 build-script 的链接参数必须用 `RUSTFLAGS` 环境变量（首轮 16MB 栈实验因此无效）。
5. **【CI 修复】make-sidecar.mjs 里 `function rustcHostTriple(): string | null` 的 TS 标注**留在 .mjs 中 → CI 裸 node SyntaxError；已删标注（node --check 全项目 .mjs 复查无同类）。
6. **【CI 修复】tauri 2.10.1 锁版与 lockfile 较新 tauri-runtime E0308 冲突**：恢复 `tauri = "2.11.5"` 并重新生成一致锁文件（tauri-runtime 2.11.3 / wry 0.55.1）。
7. **【CI 修复】两个真实 Rust 编译错误**（本地 cargo check 被坑 2 挡住从未编到）：`lib.rs` 缺 `use tauri::Emitter`（E0599）；`keybridge.rs` token 被 move 进线程闭包（E0382，已 clone）。
8. **esbuild CJS bundle 下 `import.meta.url` undefined**：host 的 EXTENSION_DIR 解析改为 env（PI_AGENT_EXTENSION_DIR）+ cwd 候选。
9. **PowerShell 5.1 按 ANSI 读 UTF-8 无 BOM**（中文注释 mojibake 吞行）→ make-icons.ps1 改纯 ASCII。

## 5. 遗留
- macOS .dmg：工作流仅 Windows；跨平台需加 macos-latest job（配置结构已就绪）。
- Z-05 自动更新：updater 通道未配置（本轮不做，见 §6 分类）。
- cli.rs（E-06）：命令骨架，未做独立 CLI 发布。
- 待用户安装后验证 M15 五项（见上表）。

## 6. 全项目收尾清单（PRD 171 条分类）

**总计：已实现 128 / 仅骨架 9 / 本轮不做 34 = 171 条**（按模块汇总，判定依据 = 代码证据 + T01–T05 任务报告；2026-09-10 文档-实现一致性复核修正，与 `CHANGELOG.md` 对齐）：

| 模块 | 覆盖 | 骨架 | 不做 | 说明 |
|---|---|---|---|---|
| A 权限审批（14） | 14 | 0 | 0 | T03 全链路 + T05 A-09 深链 |
| B 手机镜像（6） | 4 | 0 | 2 | B-04 客户端上限、B-05 公网隧道不做 |
| C 会话（7） | 6 | 0 | 1 | C-07 会话内查找不做 |
| D 媒体（7） | 5 | 1 | 1 | D-05 Office 预览骨架；D-06 长图不做 |
| E 本地 REST（6） | 4 | 2 | 0 | E-05 幂等键内存版；E-06 CLI 骨架 |
| F 分叉（6） | 4 | 0 | 2 | F-03 分支树（`features/branch/BranchTree.tsx`）已实现；F-05/F-06 参考会话不做 |
| G worktree（6） | 2 | 0 | 4 | G-01/02 可用；G-03..06 仅 501 占位，计入本轮不做 |
| I IM 桥接（6） | 0 | 0 | 6 | 整模块本轮不做 |
| K 看板（4） | 2 | 0 | 2 | K-01 四列看板 / K-02 卡片跳转已实现（`features/kanban/KanbanView.tsx`）；K-03/04 不做 |
| M 模型/上下文（10） | 8 | 0 | 2 | M-09 偏好范围、M-10 模型路由不做 |
| N 运行时（13） | 11 | 0 | 2 | N-12 Ghost 自愈、N-13 主聊天虚拟化未实现，计入不做 |
| P 项目（9） | 6 | 0 | 3 | P-07 导入历史、P-08 规则文件、P-09 虚拟化列表不做 |
| Q 账号/密钥/用量（7） | 5 | 0 | 2 | Q-06 多账号、Q-07 额度不做 |
| R 运行时抽象（9） | 9 | 0 | 0 | T01 全量 |
| S 外观/快捷键（7） | 6 | 1 | 0 | S-05 自定义外观骨架 |
| T 时间线/输入（14） | 11 | 1 | 2 | T-10 拖拽分流骨架；T-11/T-12 不做 |
| U 自动化/托盘（7） | 7 | 0 | 0 | T04b + T05 U-07 |
| V 设置（7） | 6 | 1 | 0 | V-05 深链已实现；V-06 双语仅骨架（当前中文，i18n 框架预留） |
| W 工具面板（9） | 8 | 0 | 1 | W-09 工具统计不做 |
| X 扩展生态（7） | 4 | 3 | 0 | X-05/06/07 骨架 |
| Z 桌面壳（10） | 6 | 0 | 4 | Z-05 updater、Z-07/08/09 不做（updater 通道未配置） |

## 7. 用户启动指引
- **仓库**：https://github.com/kkk0854/pi-agent（私有，main）
- **Web 版**：克隆后 `pnpm install && pnpm dev`（host + web 并起；启动后手动访问 http://localhost:5173，dev 脚本不会自动开浏览器；无 pi CLI 时自动降级 Mock 后端）
- **桌面版**：下载 `release/` 下 `pi-agent_0.1.0_x64_zh-CN.msi` 安装，或免安装运行 `pi-agent_0.1.0_x64-setup.exe`；以后打 tag `v*` 推送即自动出包（.github/workflows/tauri-build.yml）
- **桌面版架构**：Rust 壳内嵌 sidecar（esbuild 打包的 host + node 运行时，目标机无需装 Node），webview 加载同一份前端产物；密钥入 Windows Credential Manager，关窗驻留托盘
