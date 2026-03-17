import json
from .config import SKILLS_DIR, REPO_ROOT
from .systems.todo import TodoManager
from .systems.skills import SkillLoader
from .systems.tasks import TaskManager
from .systems.background import BackgroundManager
from .systems.messaging import MessageBus
from .systems.worktree import WorktreeManager, EventBus
from .systems.team import TeammateManager
from .systems.compression import auto_compact
from .agent.core import Agent

def main():
    # Initialize shared state
    shared_plan_registry = {}

    # Initialize systems
    todo_mgr = TodoManager()
    skill_loader = SkillLoader(SKILLS_DIR)
    task_mgr = TaskManager()
    bg_mgr = BackgroundManager()
    msg_bus = MessageBus()
    team_mgr = TeammateManager(msg_bus, task_mgr, shared_plan_registry)
    
    events_bus = EventBus(REPO_ROOT / ".worktrees" / "events.jsonl")
    worktree_mgr = WorktreeManager(REPO_ROOT, task_mgr, events_bus)

    # Initialize agent
    agent = Agent(todo_mgr, skill_loader, task_mgr, bg_mgr, msg_bus, team_mgr, worktree_mgr, events_bus, shared_plan_registry)

    # REPL Loop
    history = []
    print("Agent initialized. Type 'exit' to quit.")
    
    while True:
        try:
            query = input("\033[36ms_full >> \033[0m")
        except (EOFError, KeyboardInterrupt):
            break
            
        if query.strip().lower() in ("q", "exit", ""):
            break
            
        if query.strip() == "/compact":
            if history:
                print("[manual compact via /compact]")
                history[:] = auto_compact(history)
            continue
            
        if query.strip() == "/tasks":
            print(task_mgr.list_all())
            continue
            
        if query.strip() == "/team":
            print(team_mgr.list_all())
            continue
            
        if query.strip() == "/inbox":
            print(json.dumps(msg_bus.read_inbox("lead"), indent=2))
            continue
            
        history.append({"role": "user", "content": query})
        agent.loop(history)

        # Print the latest assistant reply (if any)
        last_assistant = None
        for msg in reversed(history):
            if isinstance(msg, dict) and msg.get("role") == "assistant":
                last_assistant = msg
                break
        if last_assistant is not None:
            content = last_assistant.get("content", "")
            # anthropic SDK returns a list of content blocks; extract text fields if present
            if isinstance(content, list):
                parts = []
                for block in content:
                    text = getattr(block, "text", None) or getattr(block, "content", None)
                    if text:
                        parts.append(text)
                to_print = "".join(parts) if parts else str(content)
            else:
                to_print = str(content)
            print(to_print)
        print()

if __name__ == "__main__":
    main()
