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
