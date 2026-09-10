# pi RPC 协议参考（实测 + 源码核对）

> 来源：本机 `pi 0.85.0`（`@earendil-works/pi-coding-agent`）
> 实测路径：`C:\Users\hang\AppData\Roaming\npm\pi` → `C:\Users\hang\AppData\Roaming\npm\node_modules\@earendil-works\pi-coding-agent`
> 类型定义出处：
> - `dist/modes/rpc/rpc-types.d.ts`（命令 / 响应 / 扩展 UI）
> - `node_modules/@earendil-works/pi-agent-core/dist/types.d.ts:377-415`（AgentEvent）
> - `node_modules/@earendil-works/pi-ai/dist/types.d.ts:410+`（AssistantMessageEvent）
> - `dist/core/agent-session.d.ts:40-101`（AgentSessionEvent）

## 0. 传输层事实

- 启动：`pi --mode rpc [--session <path|id>] [--no-session] [--cwd] ...`
- 传输：**NDJSON**（每行一个 JSON）—— stdin 写命令，stdout 读事件与响应
- 三类出站帧：`{type:"response",...}`（命令回执）/ `AgentSessionEvent`（事件流）/ `{type:"extension_ui_request",...}`（扩展向宿主索要交互）
- 实测证据（本机真跑）：

```
$ pi --mode rpc --no-session --offline
{"type":"extension_ui_request","id":"fadedc1b-...","method":"setStatus","statusKey":"mcp","statusText":"🔌 MCP: 3 servers enabled"}
```

- Windows 注意：`pi` 是 npm shim（`pi.cmd`），Node 侧 spawn 需 `shell:true` 或直接调 `pi.cmd`

## 1. 命令（stdin → pi）

全部命令形如 `{ "id": "<correlation-id>", "type": "<cmd>", ... }`，`id` 用于响应关联。

| type | 关键字段 | 说明 |
|---|---|---|
| `prompt` | `message`, `images?`, `streamingBehavior?: "steer"\|"followUp"` | 发起一轮对话 |
| `steer` | `message`, `images?` | 流式中断当前轮（下一个 LLM 调用前生效） |
| `follow_up` | `message`, `images?` | 排队，等本轮彻底结束后执行 |
| `abort` | — | 中止当前运行 |
| `clear_queue` | — | 清空 steer/followUp 队列 |
| `new_session` | `parentSession?` | 新建会话 |
| `get_state` | — | 拉取 `RpcSessionState` |
| `set_model` | `provider`, `modelId` | 模型中途热切换 |
| `cycle_model` | — | 轮换模型 |
| `get_available_models` | — | 模型列表 |
| `set_thinking_level` | `level` | off/minimal/low/medium/high/xhigh/max |
| `cycle_thinking_level` | — | 轮换思考等级 |
| `get_available_thinking_levels` | — | 可用等级列表 |
| `set_steering_mode` | `mode: "all"\|"one-at-a-time"` | |
| `set_follow_up_mode` | `mode: "all"\|"one-at-a-time"` | |
| `compact` | `customInstructions?` | 手动压缩上下文 |
| `set_auto_compaction` | `enabled` | |
| `set_auto_retry` | `enabled` | |
| `abort_retry` | — | |
| `bash` | `command`, `excludeFromContext?` | 直接执行 bash |
| `abort_bash` | — | |
| `get_session_stats` | — | 返回 `SessionStats`（tokens/cost） |
| `export_html` | `outputPath?` | 导出会话 HTML |
| `switch_session` | `sessionPath` | 切换会话 |
| `fork` | `entryId` | 从指定节点分叉 |
| `clone` | — | 克隆会话 |
| `get_fork_messages` | — | 可 fork 的消息点 |
| `get_entries` | `since?` | 会话条目 |
| `get_tree` | — | 会话树（分支可视化） |
| `get_last_assistant_text` | — | |
| `set_session_name` | `name` | |
| `get_messages` | — | `AgentMessage[]` |
| `get_commands` | — | 斜杠命令清单（extension/prompt/skill） |

## 2. 响应（stdout ← pi）

```
{ "type":"response", "id":"...", "command":"<cmd>", "success":true, "data": {...} }
{ "type":"response", "id":"...", "command":"<cmd>", "success":false, "error":"..." }
```

- `get_state` → `RpcSessionState`
- `get_session_stats` → `SessionStats`
- `get_tree` → `{ tree: SessionTreeNode[], leafId }`
- `get_commands` → `{ commands: RpcSlashCommand[] }`

### RpcSessionState

```ts
{
  model?: Model<any>;
  thinkingLevel: ThinkingLevel;
  isStreaming: boolean;
  isCompacting: boolean;
  steeringMode: "all" | "one-at-a-time";
  followUpMode: "all" | "one-at-a-time";
  sessionFile?: string;
  sessionId: string;
  sessionName?: string;
  autoCompactionEnabled: boolean;
  messageCount: number;
  pendingMessageCount: number;
}
```

### SessionStats（做「配额/成本面板」的数据源）

```ts
{
  sessionFile, sessionId,
  userMessages, assistantMessages, toolCalls, toolResults, totalMessages,
  tokens: { input, output, cacheRead, cacheWrite, total },
  cost: number,
  contextUsage?: ContextUsage
}
```

## 3. 事件流（stdout ← pi）— 渲染核心

### 3.1 AgentEvent（`pi-agent-core`）

| type | 载荷 |
|---|---|
| `agent_start` | — |
| `turn_start` | — |
| `turn_end` | `message`, `toolResults` |
| `message_start` | `message` |
| **`message_update`** | `message`, `assistantMessageEvent` ← **流式渲染主通道** |
| `message_end` | `message` |
| `tool_execution_start` | `toolCallId`, `toolName`, `args` |
| `tool_execution_update` | `toolCallId`, `toolName`, `args`, `partialResult` |
| `tool_execution_end` | `toolCallId`, `toolName`, `result`, `isError` |
| `agent_end` | `messages` |

### 3.2 AssistantMessageEvent（嵌在 `message_update` 内）

```
start | text_start | text_delta | text_end
     | thinking_start | thinking_delta | thinking_end
     | toolcall_start | toolcall_delta | toolcall_end
     | done | error
```

- `*_start` 携带 `contentIndex` + `partial`（快照）
- `*_delta` 携带 `contentIndex` + `delta`（增量字符串）
- **渲染策略**：按 `contentIndex` 分块累积，不要整体替换，避免闪烁
- 内容块类型：text / thinking / toolCall

### 3.3 AgentSessionEvent（会话层，AgentEvent 超集）

| type | 用途 |
|---|---|
| `agent_settled` | 一轮彻底结束（含后续排队消息） |
| `queue_update` | `steering` / `followUp` 队列变化 → 侧栏「待投递消息」 |
| `compaction_start` / `compaction_end` | `reason: manual\|threshold\|overflow`，含 `result`/`aborted`/`willRetry` |
| `entry_appended` | 新会话条目落盘 |
| `session_info_changed` | 会话改名 |
| `thinking_level_changed` | 思考等级变化 |
| `auto_retry_start` / `auto_retry_end` | 自动重试（`attempt`/`maxAttempts`/`delayMs`） |
| `summarization_retry_*` | 摘要重试 |
| `bash_execution_update` | `id?`, `delta` → 终端输出流 |

> `agent_end` 在会话层被替换为携带 `messages` + `willRetry` 的版本。

## 4. 扩展 UI 请求（pi 反向要求 GUI 响应）

宿主**必须**回 `{type:"extension_ui_response", ...}`，否则扩展流程卡死。

| method | 字段 | 宿主应答 |
|---|---|---|
| `select` | `title`, `options[]`, `timeout?` | `value: string` |
| `confirm` | `title`, `message`, `timeout?` | `confirmed: boolean` |
| `input` | `title`, `placeholder?`, `timeout?` | `value: string` |
| `editor` | `title`, `prefill?` | `value: string` |
| `notify` | `message`, `notifyType?: info\|warning\|error` | 无需应答（toast） |
| `setStatus` | `statusKey`, `statusText` | 无需应答（状态栏） |
| `setWidget` | `widgetKey`, `widgetLines[]`, `placement?: aboveEditor\|belowEditor` | 无需应答 |
| `setTitle` | `title` | 无需应答（窗口标题） |
| `set_editor_text` | `text` | 无需应答 |

应答格式：
```ts
{ type:"extension_ui_response", id, value:"..." }      // select/input/editor
{ type:"extension_ui_response", id, confirmed:true }   // confirm
{ type:"extension_ui_response", id, cancelled:true }   // 取消
```

> ⚠️ `statusText` 中可能含 ANSI 转义码（实测 `\u001b[38;2;138;190;183m...`），GUI 侧需剥离或渲染为颜色。

## 5. 关键 CLI 参数（服务端 spawn 时用）

```
--mode rpc            # 必须
--session <path|id>   # 指定/恢复会话
--session-id <id>     # 精确会话 ID（不存在则创建）
--fork <path|id>      # 分叉
--session-dir <dir>   # 会话存储目录
--no-session          # 临时会话（不落盘）
--name <name>         # 会话显示名
--continue / -c       # 继续上次
--resume / -r         # 选择会话恢复
--provider / --model  # 指定模型
--thinking <level>    # 思考等级
--tools / --exclude-tools / --no-tools   # 工具开关
--extension / --skill / --prompt-template / --theme
--approve / -a        # 信任项目本地文件
--offline             # 禁用启动期网络操作
--export <file>       # 导出 HTML
--list-models [search]
```

## 6. 本机环境事实

| 项 | 值 |
|---|---|
| pi 版本 | 0.85.0 |
| pi 路径 | `C:\Users\hang\AppData\Roaming\npm\pi`（shim） |
| 配置目录 | `~/.pi/agent/`（settings.json / sessions/ / extensions/ / skills/ / auth.json） |
| 默认 provider | `my-gateway` |
| 默认模型 | `gemini-3.7-flash-high` |
| 默认思考等级 | `high` |
| 已装扩展 | 7 个（pi-mcp-adapter、pi-fff、rpiv-ask-user-question、notify、pi-cc-extensions、rtk-optimizer、rpiv-todo） |
| Node | v22.22.2 |
| pnpm | 11.22.0 |
| Rust | 1.98.0（Tauri 可用） |

## 7. 对 GUI 设计的直接启示

1. **会话树是原生的**：`get_tree` + `fork` 天然支持 grok-app 的「Session Forking」与分支可视化。
2. **看板状态可精确映射**：`agent_settled` / `queue_update` / `compaction_*` / `extension_ui_request(select|confirm|input)` → `Done` / `Working` / `Needs Input`。**「Needs Input」就是有待应答的 extension_ui_request**，这是比轮询更可靠的信号。
3. **成本面板有现成数据**：`get_session_stats` 直接给 tokens + cost + contextUsage。
4. **工具卡片可做得比 TUI 更好**：`tool_execution_start/update/end` 三段式天然对应「运行中/流式输出/结果与错误」。
5. **中断要在两个层级**：`abort`（agent）+ `abort_bash`（shell）。
6. **Mock 后端只需实现同构帧**：命令 35 种、事件 ~10 类，Mock 端按同样 NDJSON 发帧即可让前端无感切换。
