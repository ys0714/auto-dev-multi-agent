# Multi-Auto-Agent vs MyClaw Feature Integration Plan

## 1. Feature Gap Analysis

| Feature | `multi-auto-agent` (Current) | `myclaw` (Target) | Gap / Action Item |
| :--- | :--- | :--- | :--- |
| **Architecture** | Direct synchronous tool execution in loop | Event-Driven (EventBus), Async Subscribers | **Critical**: Decouple side effects (logging, checks) from main loop. |
| **Code Safety** | None (writes happen immediately) | Async Soft-Gate (Lint/Syntax Check after write) | **High**: Implement `systems/quality_gate.py` to check files post-write. |
| **User Memory** | None | Persistent `user-profile.json` (learning preferences) | **High**: Implement `systems/profile.py` for cross-session memory. |
| **Session Mgmt** | Transient (in-memory list) | Persistent JSONL logs, Resume capability | **Medium**: structured logging & session restoration. |
| **CLI Experience** | Basic `input()` loop | Robust `oclif` (commands, help, doctor) | **Medium**: Enhance `main.py` with `argparse`/`click` & `doctor` cmd. |
| **Observability** | `print()` statements | Structured Metrics & Events | **Low**: Move to structured event logging. |

## 2. Integration Architecture

We will evolve `multi-auto-agent` from a monolithic loop to an **Event-Driven Architecture**.

### Current Flow
`User Input -> LLM -> Tool Execution -> Output`

### New Flow
`User Input -> LLM -> Tool Execution -> EventBus.publish("tool_result")`
                                      `-> Subscribers (Logging, Metrics, QualityGate)`

## 3. Implementation Roadmap

### Phase 1: Event Bus Foundation (Architectural Core)
**Goal**: Decouple the system.
- Create `systems/eventbus.py`:
    - `Event` class (type, payload, timestamp).
    - `EventBus` class (subscribe, publish).
- Refactor `Agent` to publish events (`step_start`, `tool_use`, `tool_result`, `step_end`) instead of just printing.
- Create basic `LoggerSubscriber` to replace `print()` statements.

### Phase 2: Code Quality Gates (Reliability)
**Goal**: Catch errors early like `myclaw`'s soft-gate.
- Create `systems/quality_gate.py`:
    - Subscribe to `file_written` events.
    - Run `python -m py_compile` or `pylint` on modified files.
    - If error: Inject a "Feedback" message into the *next* agent turn (e.g., "Hey, you just broke syntax in file X").

### Phase 3: User Profile & Memory (Intelligence)
**Goal**: Make the agent "know" the user.
- Create `systems/profile.py`:
    - Load `user_profile.json`.
    - Analyze user feedback (positive/negative) to update preferences.
    - Inject profile summary into `Agent.system_prompt`.

### Phase 4: CLI & Session Management (Experience)
**Goal**: Professional CLI feel.
- Refactor `main.py` or create `cli.py` using `click` or `argparse`.
- Add commands:
    - `start`: Run agent.
    - `resume --id <session_id>`: Load previous chat history.
    - `doctor`: Check env vars, python version, dependencies.
    - `config`: View/Edit `.env` or config files.
- Implement `SessionManager` to save/load chat history to `sessions/*.jsonl`.

## 4. Proposed Directory Structure Changes

```text
multi-auto-agent/
├── multi_auto_agent/
│   ├── systems/
│   │   ├── eventbus.py       # [NEW] Core event system
│   │   ├── quality_gate.py   # [NEW] Linter/Syntax checker
│   │   ├── profile.py        # [NEW] User profile memory
│   │   ├── session.py        # [NEW] Session storage/resume
│   │   └── ... (existing)
│   ├── cli.py                # [NEW] Enhanced entry point
│   └── ...
```

## 5. Immediate Next Steps
1.  Scaffold `systems/eventbus.py`.
2.  Update `Agent` to use `EventBus`.
3.  Implement `quality_gate` subscriber.
