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
