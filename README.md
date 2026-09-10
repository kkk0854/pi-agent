# pi-agent

`pi` coding agent（`@earendil-works/pi-coding-agent`）的图形化工作台。

> MIT 开源社区客户端，非 pi / pi-mono 官方产品。

## 结构

pnpm workspace 三包：

| 包 | 职责 |
|---|---|
| `packages/shared` | 契约与归一化：AgentRuntime 接口、RuntimeEvent、PiFrameNormalizer、权限/线协议类型、工具库（jsonl / ansi / redact 等） |
| `packages/host` | 本地 Node 宿主服务（Fastify + WS，绑 127.0.0.1 随机端口）：spawn pi、透传原始 JSONL 行 |
| `packages/web` | React 19 + Tailwind 4 + Radix 前端工作台 |

## 启动

```bash
pnpm install
pnpm dev        # 同时启动 host 与 web（vite），浏览器打开 http://localhost:5173
```

单独启动：

```bash
pnpm -C packages/host dev   # host，写 {appData}/pi-agent/host.json
pnpm -C packages/web dev    # vite，自动注入 host 端点到 window.__PI_AGENT_HOST__
```

## 桌面版（Tauri 2）

```bash
pnpm install
pnpm tauri:build   # 串联 make-sidecar（内嵌 Node）→ 前端构建 → Tauri 出包
```

产物：`src-tauri/target/release/bundle/` 下 `.msi` 与 NSIS `setup.exe`。
已构建好的安装包放在 `release/`（中/英 `.msi` + NSIS 便携安装器）。

打包要素（均由 `pnpm tauri:build` 自动处理）：

- sidecar：`scripts/make-sidecar.mjs` 用 esbuild 把 host 打成 `pi-agent-host.cjs`，并把本机 node.exe 复制为
  `pi-agent-host-<rustc host triple>.exe` —— **目标机无需安装 Node**。
- 资源：`resources` 携带 `pi-agent-host.cjs` 与 `extensions/pi-agent-permissions/`（权限审批扩展）。

> 云端出包：仓库已配 `.github/workflows/tauri-build.yml`，打 tag `v*` 或手动 `workflow_dispatch` 即触发
> Windows runner 构建并上传安装包产物。

## 质量检查

```bash
pnpm typecheck   # 全包 tsc --noEmit
pnpm lint        # eslint
pnpm test        # vitest（shared：jsonl/normalizer/ansi/redact 等）
pnpm check-env   # Node / pnpm / pi / Rust 环境体检
```

## 安全约定

- host 仅绑定 `127.0.0.1`，WS/REST 由令牌门禁；令牌文件 `{appData}/pi-agent/host.json` 权限 0600。
- 日志强制经 `@pi-agent/shared` 的 `redact` 脱敏，禁止明文输出凭据。
- 遥测默认关闭（V-07）。
