# Developer Specification (PROJECT_SPEC)

> 版本：1.0 — 基于源码全量分析的深度技术规范

## 目录

- [1. 项目概述](#1-项目概述)
- [2. 核心特点](#2-核心特点)
- [3. 技术选型](#3-技术选型)
- [4. 测试方案](#4-测试方案)
- [5. 系统架构与模块设计](#5-系统架构与模块设计)
- [6. 项目排期](#6-项目排期)
- [7. 可扩展性与未来展望](#7-可扩展性与未来展望)

---

## 1. 项目概述

本项目是一个 **多智能体自动化框架（Multi-Agent Automation Framework）** 的 TypeScript 参考实现。它不是简单的 LLM REPL 封装，而是一个完整的、面向软件工程场景的自主编程智能体平台，具备以下核心能力：

- **Lead-Teammate 多智能体协作**：主控智能体（Lead）可衍生、管理、通信多个独立进程运行的 Teammate 智能体。
- **全链路事件可观测**：所有行为（工具调用、文件操作、错误、压缩）通过 EventBus 广播，支持实时 UI 渲染和持久化审计。
- **生产级安全守卫**：命令拦截、未读写保护、路径沙箱，防止智能体执行破坏性操作。
- **会话持久化与恢复**：基于 JSONL 的 append-only 会话日志，支持 `--resume` 跨进程恢复完整对话状态（含压缩摘要）。
- **Git Worktree 沙箱隔离**：任务绑定到独立的 Git Worktree 分支，智能体在隔离环境中执行代码修改，防止污染主工作区。
- **自适应上下文管理**：二阶段压缩策略（工具输出卸载 + 滚动摘要），确保长会话中核心意图不丢失。

### 设计理念

| 原则 | 说明 |
|------|------|
| **CLI & Local First** | 所有交互在本地终端完成，数据不离开本机 |
| **Event-Driven Architecture** | 解耦的发布-订阅模型，模块间零耦合 |
| **Clean Architecture / DDD** | 四层分离（Domain → Application → Infrastructure → Presentation） |
| **Convention over Configuration** | 目录约定（`.{APP_NAME}/`, `skills/`）替代复杂配置，`APP_NAME` 可通过环境变量自定义 |
| **Fail-Safe by Default** | 危险操作默认拦截，优雅降级而非崩溃 |

---

## 2. 核心特点

### 2.1 Lead-Teammate 多智能体协作体系

本系统实现了完整的 **Lead-Worker 多智能体架构**，而非简单的单 Agent 循环：

- **Lead Agent**（主控）：运行在 TUI 前台进程中，拥有全量工具集（18 个 Tools），负责任务分解、Teammate 调度和全局决策。
- **Teammate Agent**（工作者）：通过 `child_process.spawn()` 作为**独立子进程**后台运行，拥有独立的 LLM 会话上下文，通过 MessageBus 与 Lead 通信。
- **Subagent**（轻量探索者）：通过 `task` 工具内联衍生，共享 Lead 的进程，用于快速的只读探索或短期任务，最多 30 轮自动退出。

**通信协议**：

```
Lead Agent ←→ MessageBus (JSONL 文件) ←→ Teammate Agent
     ↑                                        ↑
     │         TaskManager (.tasks/ JSON)      │
     └─────── 共享任务看板 ───────────────────────┘
```

- **消息类型**：`message`, `broadcast`, `shutdown_request`, `shutdown_response`, `plan_approval_request`, `plan_approval_response`, `task_result`
- **任务自动认领**：Teammate 在 Idle Phase 自动扫描 `.tasks/` 目录，认领无主且无阻塞依赖的 pending 任务，无需 Lead 手动分配。
- **计划审批流**：Teammate 可通过 `plan_approval_request` 请求 Lead 审核其执行计划，Lead 审批后 Teammate 才继续执行，实现人在回路（Human-in-the-Loop）的监督机制。
- **MapReduce 结构化输出**：Teammate 可接受 `--schema_path` 参数，强制要求其通过 `submit_result` 工具以指定 JSON Schema 格式提交结果，适用于并行分治任务。
- **优雅关闭**：通过 `shutdown_request` 消息实现协商式关闭，Teammate 确认后自动设置状态为 `shutdown` 并退出进程。

### 2.2 全链路事件驱动架构 (Event-Driven Architecture)

所有核心行为通过 `InMemoryEventBus<AgentEvent>` 发布-订阅：

**已定义事件类型（18 种）**：

| 事件类型 | 触发时机 | 消费者 |
|---------|---------|--------|
| `agent:start` / `agent:stop` | 会话开始/结束 | SessionLogSubscriber, UserProfileSubscriber |
| `tool:call` / `tool:result` | 每次工具调用前/后 | App (UI 状态), ConsoleLogger |
| `message:sent` | LLM 返回消息 | App (聊天渲染), SessionLogSubscriber, UserProfileSubscriber |
| `file:read` / `file:write` / `file:edit` | 文件操作 | SecurityGuardSubscriber, CodeInspectorSubscriber |
| `task:created` / `task:updated` / `task:completed` | 任务生命周期 | SessionLogSubscriber |
| `worktree:created` / `worktree:removed` | Worktree 生命周期 | SessionLogSubscriber |
| `inspector:error` | 代码检查发现语法错误 | Agent (自动修复) |
| `system:message` | 系统级通知（压缩、错误） | App (UI), UserProfileSubscriber |
| `session:summary` | 上下文压缩生成摘要块 | SessionLogSubscriber |

**四大 Subscriber 实现**：

1. **`SecurityGuardSubscriber`**：监听 `file:read` 事件维护"已读文件集合"，在 `write_file`/`edit_file` 前校验是否已读（防止盲写覆盖）；拦截包含 `rm -rf /`, `mkfs`, `dd if=/dev/zero`, Fork Bomb 等 5 种危险模式的 Bash 命令。
2. **`CodeInspectorSubscriber`**：监听 `file:write` 和 `file:edit` 事件，异步队列化执行语法检查（`node --check` for JS, `python3 -m py_compile` for Python, `JSON.parse` for JSON），错误通过 `inspector:error` 事件反馈。Agent 主循环每轮自动 `drain()` 检查结果并注入到对话中，驱动自我修复。
3. **`SessionLogSubscriber`**：监听全部关键事件，以 append-only 的 JSONL 格式持久化到 `$GLOBAL_DIR/sessions/{sessionId}.jsonl`，支持完整的会话恢复（含 summary blocks）。写入操作通过 Promise 链串行化，避免并发写冲突。
4. **`UserProfileSubscriber`**：监听用户消息，通过正则提取语言偏好（中文/英文检测）、编码语言（TypeScript/Python/Go 等 6 种）、操作系统、Shell 类型、包管理器、交互偏好（简洁/详细/结论先行等 5 种模式），会话结束时持久化到 `$GLOBAL_DIR/user-profile.json`，跨会话保持用户画像。

### 2.3 自适应上下文管理 (Context Window Management)

系统实现了 **三层递进式** 的上下文压缩策略，确保长会话下核心信息不丢失：

**Layer 1 — Micro-Compaction（微压缩）**：
- 触发条件：每轮自动执行
- 策略：保留最近 3 个 `tool_result` 的完整内容，更早的 `tool_result` 如果超过 100 字符则替换为 `[cleared]`
- 成本：零 LLM 调用

**Layer 2 — Context Offloading（上下文卸载）**：
- 触发条件：未压缩消息的 JSON 序列化长度超过 100,000 字符（约 25K tokens）
- 策略：遍历非最近 6 条消息中的 `tool_result`，如果内容超过 1,000 字符，将完整内容写入磁盘文件（`$AGENT_DIR/tool-outputs/cmd_{id}.log`），原位替换为指向磁盘文件的引用指针
- 成本：零 LLM 调用，仅磁盘 IO

**Layer 3 — Rolling Summarization（滚动摘要）**：
- 触发条件：Layer 2 执行后仍超过阈值
- 策略：以 10 条消息为一个 chunk，提取 `user_intents`（最近 3 条）、`assistant_actions`（最近 3 条）、`tool_results`（最近 5 条），生成结构化摘要块（`SessionSummaryBlock`），移动 `compressedCount` 指针
- 摘要块会被注入到发送给 LLM 的上下文头部（最多保留 3 个摘要块）
- 成本：零 LLM 调用（纯规则提取，非 LLM 总结）

**Layer 4 — Manual Deep Compact（手动深度压缩）**：
- 触发条件：用户输入 `/compact` 或 Agent 调用 `compress` 工具
- 策略：调用 LLM 对完整对话历史生成 2,000 token 的延续性摘要，同时将原始对话归档到 `$AGENT_DIR/transcripts/transcript_{timestamp}.jsonl`
- 成本：1 次 LLM 调用

**上下文构建流程**（每轮 LLM 调用前）：
```
系统消息 → 压缩摘要块(最多3个) → 最近20条非系统消息（跳过已压缩部分，修剪开头的孤立tool消息）
```

### 2.4 Git Worktree 沙箱隔离

**完整的 Worktree 生命周期管理**，7 个专用工具覆盖创建到销毁的全流程：

| 工具 | 功能 | 关键实现 |
|------|------|---------|
| `worktree_create` | 创建隔离分支 `wt/{name}` | `git worktree add -b wt/{name} {path} {baseRef}`，自动绑定 Task |
| `worktree_list` | 列出所有 Worktree（含状态） | 读取 `index.json`，展示 active/removed/kept 状态 |
| `worktree_status` | 查看单个 Worktree 的 git 状态 | 在 Worktree 目录中执行 `git status --short --branch` |
| `worktree_run` | 在 Worktree 中执行命令 | 300s 超时，内置危险命令拦截，输出截断到 50KB |
| `worktree_remove` | 删除 Worktree 并可选完成关联 Task | `git worktree remove`，可 `--force`，可联动 `task.completed` |
| `worktree_keep` | 标记 Worktree 为保留状态 | 将 status 改为 `kept`，不删除物理文件 |
| `worktree_events` | 查看生命周期事件日志 | 读取 `worktree-events.jsonl`，支持 limit 参数 |

**与 TaskManager 的联动**：
- `worktree_create` 可传入 `task_id`，自动调用 `TaskManager.bindWorktree()` 绑定任务
- `worktree_remove` 传入 `complete_task=true` 时，自动标记关联任务为 completed 并解绑
- Task 的 `blockedBy` 依赖在完成时自动级联清除

### 2.5 安全体系 (Security Architecture)

**三道防线**：

1. **路径沙箱（Path Sandbox）**：`file-system.ts` 中的 `safePath()` 函数将所有路径 `path.resolve()` 后校验是否以 `WORKDIR` 开头，阻止路径穿越攻击（如 `../../etc/passwd`）。

2. **命令拦截（Command Interception）**：双重拦截机制——
   - `shell.ts` 中的 `runBash()` 内置静态黑名单：`rm -rf /`, `sudo`, `shutdown`, `reboot`, `> /dev/`
   - `SecurityGuardSubscriber` 额外拦截：`mkfs`, `> /dev/sda`, Fork Bomb `:(){:|:&};:`、`dd if=/dev/zero`
   - `worktree_run` 同样有独立的危险命令拦截

3. **写保护（Write Protection）**：`SecurityGuardSubscriber` 监听 `file:read` 事件维护已读文件集合，对未读文件的写入操作发出警告（当前为 warn 级别，可升级为 block）。

### 2.6 会话持久化与恢复

- **存储格式**：JSONL（每行一个 JSON 记录），append-only 写入，天然支持增量记录和崩溃恢复。
- **记录类型**：`session_start`, `session_end`, `message`, `tool_call`, `tool_result`, `error:occurred`, `summary`
- **恢复流程**：`SessionManager.loadLatest()` → 按修改时间排序找到最新的 `.jsonl` → 逐行解析重建 `messages[]` 和 `summaries[]` → 恢复 `compressedCount` → 设置 `sessionLogSubscriber` 的 sessionId → 继续追加新记录
- **存储路径**：全局 `$GLOBAL_DIR/sessions/`（跨项目共享，`GLOBAL_DIR` 默认为 `~/.multi-auto-agent/`，可通过 `AGENT_HOME` 环境变量覆盖）

### 2.7 用户画像自动学习

`UserProfileSubscriber` 实现了**被动式用户画像学习**，无需用户显式配置：

- **语言偏好**：检测消息中的中文字符（`[\u4e00-\u9fa5]`）和关键词自动切换 `zh-CN` / `en-US`
- **编码语言**：匹配 TypeScript / JavaScript / Python / Go / Java / Rust 6 种语言关键词
- **环境检测**：识别 macOS / Windows / Linux、zsh / bash / fish、npm / pnpm / yarn、Node 版本号
- **交互偏好**：识别 5 种偏好模式——"结论先行"、"简洁回答"、"详细展开"、"先跑测试"、"仅审查不修改"
- **持久化时机**：会话结束（`agent:stop`）或压缩摘要（`system:message` with `isSummary`）时写入磁盘
- **跨项目共享**：存储于 `$GLOBAL_DIR/user-profile.json`，每次新会话开始时注入 System Prompt

### 2.8 技能系统 (Skill System)

- **加载机制**：启动时递归扫描 `skills/` 目录下的 `SKILL.md` 文件
- **格式规范**：支持 YAML Front Matter（`---` 分隔），提取 `name` 和 `description` 元数据
- **注入方式**：Agent 调用 `load_skill` 工具时，将技能内容包裹在 `<skill name="...">` XML 标签中注入对话
- **System Prompt 集成**：所有已加载技能的描述列表自动附加到 System Prompt

### 2.9 任务管理 (Task & Todo Dual-Track)

**双轨制**任务管理，分别面向不同粒度：

| 维度 | TodoManager（即时清单） | TaskManager（持久任务） |
|------|----------------------|----------------------|
| 存储 | 内存 | 磁盘 JSON 文件（`$AGENT_DIR/tasks/task_{id}.json`） |
| 生命周期 | 当前会话 | 跨会话 |
| 规模 | 最多 20 条，同时仅 1 条 in_progress | 无上限 |
| 依赖管理 | 无 | 支持 `blockedBy` / `blocks` 有向依赖图 |
| 分配机制 | Agent 自用 | 可 assign 给 Teammate，支持 `owner` 字段 |
| Worktree 绑定 | 不支持 | 支持 `worktree` 字段，与 Git Worktree 联动 |
| 催促机制 | 连续 3 轮未更新自动注入 `<reminder>` | 无 |

### 2.10 后台任务管理

- `background_run` 通过 `child_process.exec()` 在后台执行长时间命令
- 默认超时 120s，支持自定义
- 结果通过 `BackgroundNotification` 队列异步通知 Agent
- Agent 主循环每轮自动 `drain()` 后台通知并注入到对话中

---

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

## 4. 测试方案

### 4.1 当前已实现的运行时安全检查

本项目当前尚未引入单元测试框架，但通过以下 **运行时防御机制** 保障系统健壮性：

| 检查类型 | 实现位置 | 检查内容 |
|---------|---------|---------|
| 路径穿越防护 | `file-system.ts → safePath()` | `path.resolve()` 后校验 `WORKDIR` 前缀 |
| 危险命令拦截 | `shell.ts` + `SecurityGuardSubscriber` | 5+5 种危险模式静态匹配 |
| 未读写保护 | `SecurityGuardSubscriber` | 维护 `readFiles: Set<string>`，写入未读文件时警告 |
| 语法检查 | `CodeInspectorSubscriber` | JS (`node --check`), Python (`py_compile`), JSON (`JSON.parse`) |
| Todo 约束 | `TodoManager.update()` | 最多 20 条、同时仅 1 条 in_progress、content/activeForm 必填 |
| Worktree 名称校验 | `WorktreeManager.validateName()` | 正则 `/^[A-Za-z0-9._-]{1,40}$/` |
| 工具输出截断 | `runBash()`, `worktree_run()`, `BackgroundManager` | 50,000 / 50,000 / 500 字符截断 |
| Bash 超时控制 | `runBash()`, `worktree_run()`, `BackgroundManager` | 120s / 300s / 120s 超时 |
| EventBus 容错 | `InMemoryEventBus.publish()` | try-catch 包裹每个 subscriber，Promise 异常独立捕获 |
| Session 写串行化 | `SessionLogSubscriber.append()` | Promise 链式串行化，避免并发写冲突 |

### 4.2 建议引入的测试方案（TODO）

| 测试层级 | 框架建议 | 覆盖范围 | 优先级 |
|---------|---------|---------|--------|
| **单元测试** | Vitest / Jest | Domain 层类型验证、TodoManager 约束逻辑、safePath 路径校验、EventBus 发布订阅、压缩算法正确性 | P0 |
| **集成测试** | Vitest + Mock | Agent 主循环（Mock LLM 响应）、Worktree 创建-运行-删除全流程、SessionManager 持久化与恢复、Teammate 消息收发 | P0 |
| **安全测试** | 专项用例 | 路径穿越攻击向量、危险命令变体绕过、并发写冲突模拟 | P1 |
| **E2E 测试** | 自定义脚本 | 启动 TUI → 输入命令 → 验证输出 → 验证持久化文件 | P2 |
| **快照测试** | Vitest Snapshot | React (Ink) UI 组件渲染结果 | P2 |

---

## 5. 系统架构与模块设计

### 5.1 四层架构总览

```
┌─────────────────────────────────────────────────────────────────────┐
│  Presentation Layer (表现层)                                         │
│  src/presentation/                                                   │
│  ├── index.tsx          → 应用入口：服务初始化、Session 创建、Ink 渲染  │
│  └── ui/                                                             │
│      ├── App.tsx         → 主容器：EventBus 订阅、用户输入路由、        │
│      │                     Agent 循环调度、/compact /tasks /team 命令  │
│      ├── Chat.tsx        → 对话渲染：最近 20 条、text/tool_use/        │
│      │                     tool_result 三种 block 类型渲染            │
│      ├── Input.tsx       → 输入框：受控 TextInput + 回车提交          │
│      └── Status.tsx      → 状态指示：Spinner + 当前工具名             │
├─────────────────────────────────────────────────────────────────────┤
│  Application Layer (应用层)                                          │
│  src/application/                                                    │
│  ├── agent.ts            → Agent 核心：系统 Prompt 构建、主循环、      │
│      │                     上下文构建、工具分发、子智能体、上下文压缩   │
│  ├── tools.ts            → 18 个 Tool Schema 定义（Anthropic 格式）  │
│  ├── services/                                                       │
│  │   ├── todo-manager.ts     → 即时 Todo 清单（内存，20 条上限）      │
│  │   ├── task-manager.ts     → 持久化任务管理（JSON 文件，依赖图）    │
│  │   ├── background.ts       → 后台进程管理（UUID 追踪，异步通知）    │
│  │   ├── message-bus.ts      → 智能体间通信（JSONL 收件箱，read-drain │
│  │   │                         语义）                                │
│  │   ├── teammate.ts         → Teammate 管理（spawn 子进程，状态追踪）│
│  │   ├── teammate-loop.ts    → Teammate 独立循环（Work Phase → Idle  │
│  │   │                         Phase → 自动认领任务 → 循环）          │
│  │   ├── worktree.ts         → Git Worktree 管理（含 EventBus 日志） │
│  │   ├── skill-loader.ts     → 技能加载（递归扫描 SKILL.md）         │
│  │   ├── session-manager.ts  → 会话管理（创建/加载/恢复/列出）       │
│  │   └── profile-manager.ts  → 本地用户配置（$GLOBAL_DIR/）          │
│  └── subscribers/                                                    │
│      ├── index.ts                → Subscriber 初始化入口             │
│      ├── security-guard-subscriber.ts  → 安全守卫                    │
│      ├── code-inspector-subscriber.ts  → 代码审查                    │
│      ├── session-log-subscriber.ts     → 会话日志持久化              │
│      └── user-profile-subscriber.ts    → 用户画像自动学习            │
├─────────────────────────────────────────────────────────────────────┤
│  Domain Layer (领域层)                                               │
│  src/domain/                                                         │
│  ├── types.ts            → 全局类型定义                              │
│  │   ├── Tool, ToolResult                   → 工具接口               │
│  │   ├── Message, AgentSession              → 会话核心类型           │
│  │   ├── SessionSummaryBlock                → 压缩摘要块             │
│  │   ├── TodoItem                           → Todo 条目              │
│  │   ├── Task                               → 持久化任务             │
│  │   │   └── id, subject, description, status, owner,               │
│  │   │       blockedBy[], blocks[], worktree                        │
│  │   ├── BackgroundTask, BackgroundNotification  → 后台任务          │
│  │   ├── InboxMessage                       → 收件箱消息             │
│  │   ├── TeammateConfig, TeamConfig         → 团队配置               │
│  │   └── ShutdownRequest, PlanRequest       → 协作协议              │
│  ├── event-bus.ts        → 事件总线                                  │
│  │   ├── AgentEvent (18 种联合类型)                                  │
│  │   └── InMemoryEventBus<T> (泛型，发布-订阅，全局单例)             │
│  └── user-profile.ts     → 用户画像                                  │
│      ├── StableUserProfile (结构化画像)                              │
│      ├── UserProfileDoc (v2 版本化文档)                              │
│      └── readUserProfile / updateUserProfile / loadUserProfileBrief │
├─────────────────────────────────────────────────────────────────────┤
│  Infrastructure Layer (基础设施层)                                    │
│  src/infra/                                                          │
│  ├── config.ts           → 配置中心                                  │
│  │   ├── APP_NAME (env 可覆盖, 默认 'multi-auto-agent')             │
│  │   ├── 路径常量：WORKDIR, GLOBAL_DIR, AGENT_DIR, TEAM_DIR,        │
│  │   │   INBOX_DIR, TASKS_DIR, SKILLS_DIR, TRANSCRIPT_DIR,          │
│  │   │   TOOL_OUTPUTS_DIR, SCHEMAS_DIR, WORKTREE_EVENTS_PATH,       │
│  │   │   SESSIONS_DIR, USER_PROFILE_PATH                            │
│  │   ├── 运行参数：TOKEN_THRESHOLD(100K), POLL_INTERVAL(5s),        │
│  │   │   IDLE_TIMEOUT(60s)                                          │
│  │   └── 模型配置：MODEL_ID, ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL  │
│  └── adapters/                                                       │
│      ├── llm.ts          → Anthropic SDK 客户端实例化                │
│      ├── shell.ts        → Shell 执行器（危险命令拦截，120s 超时）   │
│      ├── file-system.ts  → 文件操作（safePath 沙箱，EventBus 集成） │
│      ├── compression.ts  → 上下文压缩（4 层策略全部实现）            │
│      └── logger.ts       → 控制台日志（EventBus 订阅，彩色输出）     │
├─────────────────────────────────────────────────────────────────────┤
│  CLI Layer (命令行工具层)                                            │
│  src/cli/                                                            │
│  ├── agent-cli.ts        → 14 个子命令（消息、任务、团队管理）       │
│  ├── run-teammate.ts     → Teammate 独立进程入口                     │
│  └── generate-schema.ts  → LLM 驱动的 JSON Schema 生成器            │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.2 核心数据流

#### Agent 主循环（`Agent.loop()`）

```
┌──────────────────────────────────────────────────────────┐
│ While True:                                                │
│                                                            │
│ 1. maybeCompressContext(session)     → Layer 2+3 自动压缩  │
│ 2. buildContextFromSession(session)  → 构建 API 消息数组   │
│                                                            │
│ 3. bg.drain()                        → 收集后台任务通知    │
│    → 注入 <background-results>                             │
│                                                            │
│ 4. inspector.drain()                 → 收集代码检查错误    │
│    → 注入 <system-check-failures>                          │
│                                                            │
│ 5. bus.readInbox('lead')             → 收集 Teammate 消息  │
│    → 注入 <inbox>                                          │
│    → plan_approval_request → planRequests 注册             │
│                                                            │
│ 6. client.messages.create(...)       → 调用 LLM            │
│    → system: getSystemPrompt()                             │
│    → messages: apiMessages                                 │
│    → tools: TOOLS (18个)                                   │
│    → max_tokens: 8000                                      │
│                                                            │
│ 7. If stop_reason !== 'tool_use' → return (交还用户输入)   │
│                                                            │
│ 8. For each tool_use block:                                │
│    a. SecurityGuard.validateToolUse() → 安全校验           │
│    b. Switch(tool_name) → 路由到对应 Service               │
│    c. EventBus publish (tool:call, tool:result)            │
│                                                            │
│ 9. Todo Nag: 连续 3 轮未更新 → 注入 <reminder>            │
│                                                            │
│ 10. Manual Compress: 如果调用了 compress 工具 → 全量压缩   │
│                                                            │
│ → 回到 Step 1                                              │
└──────────────────────────────────────────────────────────┘
```

#### Teammate 循环（`teammateLoop()`）

```
┌────────────────────────────────────────────────┐
│  WORK PHASE (最多 50 轮):                       │
│    1. 读取收件箱 → 收到 shutdown_request → 退出 │
│    2. 调用 LLM (相同 TOOLS + submit_result)     │
│    3. 执行工具 (bash/read/write/edit/submit)    │
│    4. idle 请求 → 跳出 Work Phase               │
│                                                  │
│  IDLE PHASE:                                     │
│    Loop (IDLE_TIMEOUT / POLL_INTERVAL 次):       │
│    1. Sleep POLL_INTERVAL 秒                     │
│    2. 检查收件箱 → shutdown → 退出              │
│    3. 扫描 .tasks/ → 找到 unclaimed → 自动认领  │
│       → Identity 重注入 → 回到 WORK PHASE       │
│    4. 超时无活动 → shutdown 退出                 │
└────────────────────────────────────────────────┘
```

### 5.3 模块依赖关系

```
                ┌─────────────┐
                │  domain/    │
                │  types.ts   │ ← 零依赖，纯类型定义
                │  event-bus  │ ← 零外部依赖
                │  user-profile│← 依赖 config (路径)
                └──────┬──────┘
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
   ┌────────────┐ ┌──────────┐ ┌──────────────┐
   │ infra/     │ │ infra/   │ │ application/ │
   │ config.ts  │ │ adapters/│ │ services/    │
   │ (常量)     │ │ llm.ts   │ │ subscribers/ │
   │            │ │ shell.ts │ │ agent.ts     │
   │            │ │ fs.ts    │ │ tools.ts     │
   │            │ │ compress │ │              │
   │            │ │ logger   │ │              │
   └────────────┘ └──────────┘ └──────┬───────┘
                                      │
                              ┌───────┴────────┐
                              ▼                ▼
                       ┌────────────┐   ┌──────────┐
                       │presentation│   │  cli/    │
                       │ index.tsx  │   │ agent-cli│
                       │ ui/*.tsx   │   │ run-mate │
                       └────────────┘   │ gen-schema│
                                        └──────────┘
```

---

## 6. 项目排期

> 以下为基于源码实际实现状态的模块级排期。
> **状态说明**：✅ 已完成 | 🔧 需优化 | 📋 待实现

### Phase 0: 基础骨架（已完成 ✅）

| 模块 | 任务 | 状态 | 关键文件 |
|------|------|------|---------|
| P0-1 | 项目初始化、TypeScript 配置、依赖管理 | ✅ | `package.json`, `tsconfig.json` |
| P0-2 | Domain 层类型定义（Message, Tool, AgentSession, Task 等 12 个接口） | ✅ | `domain/types.ts` |
| P0-3 | EventBus 实现（泛型 `InMemoryEventBus<T>`，18 种事件类型定义） | ✅ | `domain/event-bus.ts` |
| P0-4 | 配置中心（路径常量、环境变量、模型配置） | ✅ | `infra/config.ts` |

### Phase 1: 核心 Agent 循环（已完成 ✅）

| 模块 | 任务 | 状态 | 关键文件 |
|------|------|------|---------|
| P1-1 | LLM 客户端封装（Anthropic SDK 实例化） | ✅ | `infra/adapters/llm.ts` |
| P1-2 | 文件操作适配器（read/write/edit + safePath 沙箱 + EventBus 集成） | ✅ | `infra/adapters/file-system.ts` |
| P1-3 | Shell 执行器（危险命令拦截，120s 超时，50KB 输出截断） | ✅ | `infra/adapters/shell.ts` |
| P1-4 | Tool Schema 定义（18 个工具的 Anthropic 格式 JSON Schema） | ✅ | `application/tools.ts` |
| P1-5 | Agent 主循环实现（LLM 调用 → Tool 分发 → 结果收集 → 循环） | ✅ | `application/agent.ts` |
| P1-6 | System Prompt 构建（动态注入 Profile + Skills + Worktree） | ✅ | `application/agent.ts` |

### Phase 2: 上下文管理（已完成 ✅）

| 模块 | 任务 | 状态 | 关键文件 |
|------|------|------|---------|
| P2-1 | Token 估算（JSON 序列化长度 / 4） | ✅ | `infra/adapters/compression.ts` |
| P2-2 | Micro-Compaction 实现（保留最近 3 个 tool_result） | ✅ | `compression.ts → microcompact()` |
| P2-3 | Context Offloading 实现（大输出卸载到 `.tool_outputs/`） | ✅ | `compression.ts → compactSessionContext()` |
| P2-4 | Rolling Summarization 实现（10 条 chunk，结构化摘要提取） | ✅ | `compression.ts → compactSessionContext()` |
| P2-5 | Manual Deep Compact 实现（LLM 总结 + 转录归档） | ✅ | `compression.ts → autoCompact()` |
| P2-6 | 上下文构建逻辑（摘要注入 + 滑动窗口 + 孤立消息修剪） | ✅ | `agent.ts → buildContextFromSession()` |

### Phase 3: 安全与质量守卫（已完成 ✅）

| 模块 | 任务 | 状态 | 关键文件 |
|------|------|------|---------|
| P3-1 | SecurityGuardSubscriber（危险命令拦截 + 未读写保护） | ✅ | `subscribers/security-guard-subscriber.ts` |
| P3-2 | CodeInspectorSubscriber（JS/Python/JSON 异步语法检查 + drain 机制） | ✅ | `subscribers/code-inspector-subscriber.ts` |
| P3-3 | Agent 循环集成（每轮 drain inspector 错误 + 注入自修复指令） | ✅ | `agent.ts → loop()` |
| P3-4 | Subscriber 初始化入口（单例管理） | ✅ | `subscribers/index.ts` |

### Phase 4: 会话持久化（已完成 ✅）

| 模块 | 任务 | 状态 | 关键文件 |
|------|------|------|---------|
| P4-1 | SessionLogSubscriber（append-only JSONL，Promise 链串行化写入） | ✅ | `subscribers/session-log-subscriber.ts` |
| P4-2 | SessionManager（创建/加载/恢复最新/列出会话） | ✅ | `services/session-manager.ts` |
| P4-3 | `--resume` 启动参数支持 | ✅ | `presentation/index.tsx` |

### Phase 5: 用户画像（已完成 ✅）

| 模块 | 任务 | 状态 | 关键文件 |
|------|------|------|---------|
| P5-1 | UserProfileSubscriber（被动语言/环境/偏好提取，6 种语言 + 5 种偏好） | ✅ | `subscribers/user-profile-subscriber.ts` |
| P5-2 | 用户画像持久化（v2 版本化文档，跨会话跨项目） | ✅ | `domain/user-profile.ts` |
| P5-3 | ProfileManager（本地 `$GLOBAL_DIR/user-profile.json`） | ✅ | `services/profile-manager.ts` |
| P5-4 | System Prompt 动态注入用户画像 | ✅ | `agent.ts → getSystemPrompt()` |

### Phase 6: 任务管理（已完成 ✅）

| 模块 | 任务 | 状态 | 关键文件 |
|------|------|------|---------|
| P6-1 | TodoManager（内存清单，20 条上限，单 in_progress 约束，催促机制） | ✅ | `services/todo-manager.ts` |
| P6-2 | TaskManager（持久化 JSON，CRUD + 依赖图 + 认领 + Worktree 绑定） | ✅ | `services/task-manager.ts` |
| P6-3 | BackgroundManager（UUID 追踪，异步通知队列，drain 机制） | ✅ | `services/background.ts` |

### Phase 7: 多智能体协作（已完成 ✅）

| 模块 | 任务 | 状态 | 关键文件 |
|------|------|------|---------|
| P7-1 | MessageBus（JSONL 收件箱，send/readInbox(drain)/broadcast） | ✅ | `services/message-bus.ts` |
| P7-2 | TeammateManager（spawn 子进程，状态追踪，config.json 持久化） | ✅ | `services/teammate.ts` |
| P7-3 | Teammate 独立循环（Work→Idle→Auto-Claim→Resume，50 轮/Identity 重注入） | ✅ | `services/teammate-loop.ts` |
| P7-4 | MapReduce 结构化输出（`submit_result` 工具 + JSON Schema 强制） | ✅ | `teammate-loop.ts`, `generate-schema.ts` |
| P7-5 | 计划审批流（plan_approval_request → Lead 审核 → plan_approval_response） | ✅ | `agent.ts`, `agent-cli.ts` |
| P7-6 | 协商式关闭（shutdown_request/response） | ✅ | `agent.ts`, `teammate-loop.ts` |

### Phase 8: Git Worktree 隔离（已完成 ✅）

| 模块 | 任务 | 状态 | 关键文件 |
|------|------|------|---------|
| P8-1 | WorktreeManager（create/list/status/run/remove/keep，7 个 Tools） | ✅ | `services/worktree.ts` |
| P8-2 | Worktree EventBus 日志（JSONL 事件追踪，含 before/after/failed） | ✅ | `services/worktree.ts → EventBus` |
| P8-3 | Task-Worktree 联动（bindWorktree/unbindWorktree/complete_task） | ✅ | `task-manager.ts`, `worktree.ts` |

### Phase 9: TUI 界面（已完成 ✅）

| 模块 | 任务 | 状态 | 关键文件 |
|------|------|------|---------|
| P9-1 | App 主容器（EventBus 订阅，用户输入路由，Agent 循环调度） | ✅ | `presentation/ui/App.tsx` |
| P9-2 | Chat 组件（最近 20 条，text/tool_use/tool_result 渲染，截断预览） | ✅ | `presentation/ui/Chat.tsx` |
| P9-3 | Input 组件（受控 TextInput，placeholder 提示） | ✅ | `presentation/ui/Input.tsx` |
| P9-4 | Status 组件（Spinner + 当前工具名指示） | ✅ | `presentation/ui/Status.tsx` |
| P9-5 | 内置命令（`/compact`, `/tasks`, `/team`, `/inbox`, `q/exit/quit`） | ✅ | `presentation/ui/App.tsx` |

### Phase 10: CLI 工具（已完成 ✅）

| 模块 | 任务 | 状态 | 关键文件 |
|------|------|------|---------|
| P10-1 | agent-cli（14 个子命令：消息、任务、团队管理） | ✅ | `cli/agent-cli.ts` |
| P10-2 | run-teammate（Teammate 独立进程入口） | ✅ | `cli/run-teammate.ts` |
| P10-3 | generate-schema（LLM → JSON Schema 生成器） | ✅ | `cli/generate-schema.ts` |

### Phase 11: 待优化项（🔧）

| 模块 | 任务 | 状态 | 说明 |
|------|------|------|------|
| P11-1 | SecurityGuard 写保护升级 | 🔧 | 当前仅 warn，应升级为对已存在文件的 block |
| P11-2 | LLM 接口抽象 | 🔧 | 当前硬绑定 Anthropic SDK，需抽象 `BaseLLM` 接口 |
| P11-3 | 错误恢复机制 | 🔧 | LLM 调用失败时缺少重试/指数退避策略 |
| P11-4 | Zod 验证集成 | 🔧 | 已引入 zod 依赖但未在运行时使用，Tool 输入应加 Zod 校验 |
| P11-5 | TypeScript 编译检查 | 🔧 | CodeInspector 缺少 `.ts` / `.tsx` 的 `tsc --noEmit` 检查 |
| P11-6 | Teammate 日志隔离 | 🔧 | Teammate 子进程 stdio 设为 `ignore`，缺少独立日志收集 |

### Phase 12: 待实现功能（📋）

| 模块 | 任务 | 状态 | 说明 |
|------|------|------|------|
| P12-1 | 单元测试框架引入 | 📋 | Vitest 配置 + Domain/Service 层核心逻辑覆盖 |
| P12-2 | 集成测试 | 📋 | Mock LLM 的 Agent 循环测试、Worktree 全流程测试 |
| P12-3 | MCP Server 接入 | 📋 | 将 Tool 逻辑解耦为 MCP Server，支持跨进程/跨语言工具调用 |
| P12-4 | 多模型适配 | 📋 | 抽象 LLMClient 接口，支持 OpenAI / Ollama / DeepSeek |
| P12-5 | 流式输出 | 📋 | 当前等待完整响应，应改为 streaming 逐 token 渲染 |
| P12-6 | RAG 记忆向量化 | 📋 | 将归档摘要存入向量库，支持语义检索历史上下文 |
| P12-7 | 工作流编排 | 📋 | 基于状态机/DAG 的多 Teammate 编排，替代当前的自由调度 |
| P12-8 | Dashboard Web UI | 📋 | 基于 Web 的管理面板，可视化任务看板、Teammate 状态、会话历史 |

---

## 7. 可扩展性与未来展望

### 7.1 架构层面

| 方向 | 当前状态 | 演进路径 |
|------|---------|---------|
| **LLM 多模型** | 硬绑定 Anthropic SDK | → 抽象 `BaseLLM` 接口 → 工厂模式 → 配置驱动切换 |
| **MCP 协议** | 自定义 Tool Schema | → 实现 MCP Server → Tool 逻辑外置 → 支持跨语言 MCP Client |
| **工作流编排** | Teammate 自由调度 | → DAG 定义 → 依赖拓扑排序 → 并行执行 + 聚合 |
| **持久化后端** | JSON/JSONL 文件 | → SQLite → PostgreSQL（企业级） |
| **事件持久化** | 内存 EventBus | → Redis Pub/Sub（分布式） → Kafka（高吞吐） |

### 7.2 功能层面

| 方向 | 说明 |
|------|------|
| **Streaming 输出** | 使用 `client.messages.stream()` 替代 `create()`，TUI 逐 token 渲染 |
| **RAG 长期记忆** | 将 `SessionSummaryBlock` 嵌入向量数据库，支持"你之前帮我做过什么"类查询 |
| **插件系统** | 将 Skills 从 Markdown 升级为可执行插件（TypeScript 模块动态加载） |
| **远程协作** | MessageBus 从文件升级为 WebSocket/gRPC，支持跨机器的 Teammate 协作 |
| **观测性增强** | 集成 OpenTelemetry，Tool 调用链路追踪、LLM Token 用量统计、延迟分布 |
| **权限模型** | Teammate 级别的工具权限控制（如 Explorer 只允许 read_file + bash） |

### 7.3 教学与社区

| 方向 | 说明 |
|------|------|
| **逐模块教程** | 每个 Phase 配套视频讲解 + 代码 walkthrough |
| **面试准备** | Agent 架构、Tool Calling、Context Window 管理等高频考点整理 |
| **简历指南** | 如何将本项目的亮点（多智能体、事件驱动、安全守卫）写入简历 |
