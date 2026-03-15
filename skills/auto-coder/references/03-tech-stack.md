## 3. 技术选型

### 3.1 核心语言与运行时

| 技术 | 选型 | 版本 | 选型理由 |
|------|------|------|---------|
| 语言 | TypeScript | 5.7.3 | 强类型保障、优秀的 IDE 支持、与 Node.js 生态深度集成 |
| 运行时 | Node.js | ≥ v16 | 异步 IO 模型天然适合 Agent 的事件驱动架构 |
| 编译目标 | ES2022 | - | 支持 top-level await、class fields 等现代语法 |
| 模块系统 | CommonJS | - | 与 Ink/React 生态兼容性最佳 |
| 开发运行 | ts-node | 10.9.2 | 开发阶段免编译直接运行 .tsx |
| 严格模式 | `strict: true` | - | 启用全量 TS 严格检查 |

### 3.2 UI 框架

| 技术 | 选型 | 版本 | 选型理由 |
|------|------|------|---------|
| UI 引擎 | Ink | 3.2.0 | 在终端中渲染 React 组件，组件化管理 TUI 状态 |
| 视图层 | React | 18.3.1 | 声明式 UI、Hooks 状态管理、成熟的组件生态 |
| 输入组件 | ink-text-input | 4.0.3 | 终端内的受控文本输入组件 |
| 加载指示器 | ink-spinner | 4.0.3 | 终端内的 Spinner 动画（dots 样式） |
| 边框渲染 | cli-boxes | 4.0.1 | 工具输出的边框包裹渲染 |

**UI 组件架构**：
```
App.tsx (主容器，管理 session 状态、处理用户输入和 Agent 循环)
├── Chat.tsx   (对话历史渲染，最近 20 条消息，支持 text/tool_use/tool_result 三种 block 类型)
├── Status.tsx (处理状态指示器，显示当前正在运行的工具名)
└── Input.tsx  (用户输入框，prompt 为 "s_full >> "，支持 placeholder 提示)
```

### 3.3 LLM 集成

| 技术 | 选型 | 版本 | 选型理由 |
|------|------|------|---------|
| LLM SDK | @anthropic-ai/sdk | 0.36.3 | Anthropic 官方 SDK，原生支持 Tool Use / Streaming |
| 默认模型 | claude-3-5-sonnet-20241022 | - | 通过 `MODEL_ID` 环境变量可切换 |
| API 基地址 | 可配置 | - | 通过 `ANTHROPIC_BASE_URL` 支持代理/自定义端点 |
| 工具协议 | Anthropic Tool Use | - | 18 个工具定义，覆盖文件操作、Shell、任务管理、Worktree 等全部能力 |

**当前已注册的 18 个 Tool Schema**：

| Tool Name | 输入参数 | 功能分类 |
|-----------|---------|---------|
| `bash` | `command: string` | Shell 执行 |
| `read_file` | `path: string`, `limit?: int` | 文件操作 |
| `write_file` | `path: string`, `content: string` | 文件操作 |
| `edit_file` | `path: string`, `old_text: string`, `new_text: string` | 文件操作 |
| `TodoWrite` | `items: TodoItem[]` | 任务管理 |
| `task` | `prompt: string`, `agent_type?: enum` | 子智能体 |
| `load_skill` | `name: string` | 技能系统 |
| `compress` | (无参数) | 上下文管理 |
| `background_run` | `command: string`, `timeout?: int` | 后台任务 |
| `check_background` | `task_id?: string` | 后台任务 |
| `worktree_create` | `name: string`, `task_id?: int`, `base_ref?: string` | Git Worktree |
| `worktree_list` | (无参数) | Git Worktree |
| `worktree_status` | `name: string` | Git Worktree |
| `worktree_run` | `name: string`, `command: string` | Git Worktree |
| `worktree_remove` | `name: string`, `force?: bool`, `complete_task?: bool` | Git Worktree |
| `worktree_keep` | `name: string` | Git Worktree |
| `worktree_events` | `limit?: int` | Git Worktree |
| `idle` | (无参数) | Teammate 专用 |

### 3.4 CLI 工具链

| 技术 | 选型 | 版本 | 选型理由 |
|------|------|------|---------|
| CLI 框架 | Commander | 14.0.3 | 成熟的 Node.js CLI 解析框架，支持子命令 |
| ID 生成 | uuid | 11.1.0 | 任务 ID、消息 ID 的唯一标识生成 |
| 环境变量 | dotenv | 16.4.7 | `.env` 文件加载，支持 `override: true` |
| 验证 | Zod | 3.24.2 | 已引入但尚未在生产代码中深度使用（预留） |

**CLI 脚本**：
- `agent-cli.ts`：14 个子命令，涵盖消息收发（`send_message`, `read_inbox`, `broadcast`）、任务管理（`task_create`, `task_get`, `task_update`, `task_list`, `claim_task`, `task_bind_worktree`）、团队管理（`spawn_teammate`, `list_teammates`, `plan_request`, `shutdown_request`, `plan_approval`）
- `run-teammate.ts`：Teammate 独立进程入口，接收 `--name`, `--role`, `--prompt`, `--schema_path` 参数启动 `teammateLoop()`
- `generate-schema.ts`：调用 LLM 将自然语言描述转换为 JSON Schema（Draft 7），存储到 `$AGENT_DIR/schemas/`

### 3.5 持久化策略

> **路径变量说明**：
> - `$GLOBAL_DIR` = `$AGENT_HOME` 环境变量 || `~/.{APP_NAME}/`（默认 `~/.multi-auto-agent/`）
> - `$AGENT_DIR` = `$WORKDIR/.{APP_NAME}/`（默认 `$CWD/.multi-auto-agent/`）
> - `$APP_NAME` 可通过 `APP_NAME` 环境变量自定义，默认 `multi-auto-agent`

| 数据类型 | 存储格式 | 存储路径 | 作用域 |
|---------|---------|---------|--------|
| 会话日志 | JSONL (append-only) | `$GLOBAL_DIR/sessions/{id}.jsonl` | 全局跨项目 |
| 用户画像 | JSON | `$GLOBAL_DIR/user-profile.json` | 全局跨项目 |
| 任务数据 | JSON (per-task) | `$AGENT_DIR/tasks/task_{id}.json` | 项目级 |
| 团队配置 | JSON | `$AGENT_DIR/team/config.json` | 项目级 |
| 消息收件箱 | JSONL (per-agent) | `$AGENT_DIR/team/inbox/{name}.jsonl` | 项目级 |
| Worktree 索引 | JSON | `{repo}-worktrees/index.json` | 项目级 |
| Worktree 事件 | JSONL | `$AGENT_DIR/worktree-events.jsonl` | 项目级 |
| 工具输出归档 | 纯文本 | `$AGENT_DIR/tool-outputs/cmd_{id}.log` | 项目级 |
| JSON Schema | JSON | `$AGENT_DIR/schemas/schema_{id}.json` | 项目级 |
| 对话转录归档 | JSONL | `$AGENT_DIR/transcripts/transcript_{ts}.jsonl` | 项目级 |

---
