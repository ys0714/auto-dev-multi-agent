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
