# T05 交付报告（草稿骨架 — 验证状态段待 cargo check/打包结果回填）

## 1. 交付范围
Tauri 2 桌面壳（Z-01..Z-10 按优先级）+ E-06/U-07/A-09/Q-03 + host 遗留（扩展 spawn 参数、watcher 动态重挂）。

## 2. 文件树（新增/修改）

```
src-tauri/
  Cargo.toml                 # tauri 2 / tauri-plugin-notification / keyring / windows-sys
  build.rs
  tauri.conf.json            # frontendDist=../packages/web/dist; externalBin=binaries/pi-agent-host;
                             # resources=binaries/pi-agent-host.cjs + ../extensions/pi-agent-permissions/
  tauri.windows.conf.json    # webview2 引导（Windows 专用 overlay）
  capabilities/default.json  # core:event + 自定义命令白名单
  icons/32x32.png 128x128.png icon.png icon.ico   # scripts/make-icons.ps1 生成
  .cargo/config.toml         # [build] target-dir 迁出工作区（杀软干扰规避）+ shim 说明
  .cargo/shim/               # llvm-ar→dlltool（raw-dylib 无 as.exe 的解法）、ld.lld、运行时 dll
  src/main.rs lib.rs         # 无边框窗 decorations:false + 8px resize hit-test（window.rs）
                             # 关窗→托盘拦截（close_to_tray；仅托盘退出真退，Z-06/U-07）
                             # Focused(true) → take_deeplink → emit approval:deeplink（A-09）
                             # setup: sidecar spawn + keybridge 启动 + tray 创建
  src/sidecar.rs             # Z-01：exe/cjs/扩展目录多候选定位、崩溃 3s 重启、
                             # __PI_AGENT_HOST_OVERRIDE__ 注入、host_endpoint 命令、
                             # PI_AGENT_EXTENSION_DIR / PI_AGENT_KEYBRIDGE_* 注入
  src/keychain.rs            # Z-10/Q-03：keyring → Windows Credential Manager（get/set/delete_secret）
  src/keybridge.rs           # 127.0.0.1 随机 token HTTP 桥：host secrets.ts → OS 钥匙串
  src/tray.rs                # 托盘图标 + 菜单（显示主窗/退出）
  src/notify.rs              # 桌面通知 + DeepLink 状态（A-09）
  src/window.rs              # window_minimize/toggle_maximize/is_maximized/close_to_tray/set_title
  src/cli.rs                 # E-06 骨架（open path/logs 命令）
scripts/
  make-sidecar.mjs           # esbuild bundle host → pi-agent-host.cjs + node.exe 复制为
                             # pi-agent-host-<rustc host triple>.exe（目标机无需 Node）
  make-icons.ps1             # System.Drawing 生成全套图标
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
eslint.config.js             # ignore src-tauri/binaries
```

## 3. 验证证据
- [待回填] cargo check 状态
- typecheck 0 错误 / 56+48+79=183 测试全过 / lint 0（已验证 ✅）
- pnpm build 前端产物 ✅
- sidecar 冒烟：exe + cjs → listen → host.json ✅
- [待回填] pnpm tauri:build 产物（.msi/NSIS 路径）
- M15 自查清单：[待回填]

## 4. 坑
1. **pnpm-workspace GNU 工具链缺 as.exe**：windows crate raw-dylib 需要 dlltool→as，rustup 自带 dlltool 是 GNU binutils 版。解法：llvm-tools 组件的 llvm-ar.exe 是多调用二进制，复制为 dlltool.exe 即变成 llvm-dlltool（无需 as），补 libgcc_s_seh-1.dll/libwinpthread-1.dll 到同目录。
2. **rustup toolchain install 默认装 msvc-host**：`rustup toolchain install 1.97.0` 装的是 `1.97.0-x86_64-pc-windows-msvc`；GNU 要显式 `1.97.0-x86_64-pc-windows-gnu`。
3. **esbuild CJS bundle 下 import.meta.url undefined**：host 的 EXTENSION_DIR 解析改为 env（PI_AGENT_EXTENSION_DIR）+ cwd 候选。
4. **make-sidecar 三元组**：不能写死 x86_64-pc-windows-msvc，改为 `rustc -vV` 取 host triple（GNU 工具链时须为 -gnu，否则 tauri externalBin 找不到 sidecar）。
5. **tauri build-script 0xC0000005（BEX64/ntdll，faulting module unknown）**：仅 tauri 的 build script 崩，其余 ~200 个 build script 正常；跨 1.97/1.98 双工具链、3 种 codegen 配置、16MB 栈、删 icons/resources 均复现；Defender 排除需管理员。[待回填：最终根因/解法]
6. PowerShell 5.1 读 UTF-8 无 BOM 按 ANSI（make-icons.ps1 中文注释 mojibake 吞行）→ 脚本改纯 ASCII。

## 5. 遗留
- macOS .dmg：配置就绪（tauri.conf targets），本机无法验证，注明。
- Z-08 更新器：仅骨架（按分工不做完整）。
- cli.rs（E-06）为命令骨架，未做独立 CLI 发布。

## 6. 全项目收尾清单（PRD 171 条分类）
- [待回填：已覆盖 X 条 / 骨架 Y 条 / 不做 Z 条 + 明细出处]

## 7. 用户启动指引
- Web 版：仓库根 `pnpm install && pnpm dev`（host+web 并起，浏览器打开 http://127.0.0.1:5173）
- 桌面版（开发态）：`pnpm tauri:dev`
- 桌面版（安装包）：`pnpm tauri:build` → [待回填：产物路径]；安装后密钥入 Windows Credential Manager（Q-03），关窗驻留托盘，托盘菜单退出。
