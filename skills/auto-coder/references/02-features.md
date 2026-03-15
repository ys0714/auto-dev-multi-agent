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
