# Multi-Auto-Agent 重构项目

该目录包含 `s_full.py` 智能体的重构版本。为了提高代码的可维护性和架构的清晰度，我们将单体脚本拆分为模块化的 Python 包。

## 📁 项目结构

核心逻辑位于 `multi_auto_agent` 包中，结构如下：

- **`config.py`**: 配置常量、环境变量加载和全局设置。
- **`tools/`**:
  - `base.py`: 底层工具实现（Bash 命令执行、文件读写、编辑）。
  - `definitions.py`: 定义提供给 LLM 的工具 Schema（JSON 格式）。
- **`systems/`**: 从原单体代码中提取的独立子系统：
  - `todo.py`: 待办事项列表管理 (`TodoManager`)。
  - `skills.py`: 技能加载机制 (`SkillLoader`)。
  - `tasks.py`: 基于文件的任务跟踪系统 (`TaskManager`)。
  - `background.py`: 后台进程管理 (`BackgroundManager`)。
  - `messaging.py`: Agent 间通信的消息总线 (`MessageBus`)。
  - `team.py`: 队友生成和管理 (`TeammateManager`)。
  - `compression.py`: 上下文压缩逻辑 (`microcompact`, `auto_compact`)。
- **`agent/`**: 核心 Agent 逻辑：
  - `core.py`: 主 `Agent` 类和循环逻辑。
  - `subagent.py`: 用于生成临时子 Agent 的逻辑。
- **`main.py`**: 入口点，负责组装所有组件并启动 REPL 交互环境。

## 🚀 运行步骤

### 1. 环境准备

确保你已安装 Python 3，并且项目根目录下有 `.env` 文件配置了必要的 API 密钥（如 `ANTHROPIC_API_KEY`）。

### 2. 运行 Agent

你可以使用以下两种方式之一来运行重构后的 Agent：

#### 方式 A：使用运行脚本（推荐）

在 `multi-auto-agent` 目录下，直接运行 `run.py` 脚本：

```bash
cd multi-auto-agent
python3 run.py
```

#### 方式 B：作为模块运行

在 `multi-auto-agent` 目录下，使用 `-m` 参数运行模块：

```bash
cd multi-auto-agent
python3 -m multi_auto_agent.main
```

## 📄 原始文件

原始的单体实现文件 `s_full.py` 仍然保留，作为参考对比。
