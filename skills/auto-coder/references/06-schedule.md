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
