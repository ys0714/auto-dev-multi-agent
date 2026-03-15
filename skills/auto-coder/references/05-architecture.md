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
