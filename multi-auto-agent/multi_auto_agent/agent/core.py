import json
import uuid
from ..config import WORKDIR, TOKEN_THRESHOLD, MODEL, client
from ..tools.base import run_bash, run_read, run_write, run_edit
from ..tools.definitions import TOOLS
from ..systems.compression import microcompact, auto_compact, estimate_tokens
from .subagent import run_subagent

class Agent:
    def __init__(self, todo_mgr, skill_loader, task_mgr, bg_mgr, msg_bus, team_mgr, worktree_mgr, events_bus, plan_registry: dict = None):
        self.todo = todo_mgr
        self.skills = skill_loader
        self.tasks = task_mgr
        self.bg = bg_mgr
        self.bus = msg_bus
        self.team = team_mgr
        self.worktrees = worktree_mgr
        self.events = events_bus
        self.shutdown_requests = {}
        self.plan_requests = plan_registry if plan_registry is not None else {}
        
        self.system_prompt = f"""You are a coding agent at {WORKDIR}. Use tools to solve tasks.
Prefer task_create/task_update/task_list for multi-step work. Use TodoWrite for short checklists.
Use task for subagent delegation. Use load_skill for specialized knowledge.
Use worktree_* tools for isolated task execution.
Skills: {self.skills.descriptions()}"""

        self.tool_handlers = {
            "bash":             lambda **kw: run_bash(kw["command"]),
            "read_file":        lambda **kw: run_read(kw["path"], kw.get("limit")),
            "write_file":       lambda **kw: run_write(kw["path"], kw["content"]),
            "edit_file":        lambda **kw: run_edit(kw["path"], kw["old_text"], kw["new_text"]),
            "TodoWrite":        lambda **kw: self.todo.update(kw["items"]),
            "task":             lambda **kw: run_subagent(kw["prompt"], kw.get("agent_type", "Explore")),
            "load_skill":       lambda **kw: self.skills.load(kw["name"]),
            "compress":         lambda **kw: "Compressing...",
            "background_run":   lambda **kw: self.bg.run(kw["command"], kw.get("timeout", 120)),
            "check_background": lambda **kw: self.bg.check(kw.get("task_id")),
            "task_create":      lambda **kw: self.tasks.create(kw["subject"], kw.get("description", "")),
            "task_get":         lambda **kw: self.tasks.get(kw["task_id"]),
            "task_update":      lambda **kw: self.tasks.update(kw["task_id"], kw.get("status"), kw.get("owner"), kw.get("add_blocked_by"), kw.get("add_blocks")),
            "task_bind_worktree": lambda **kw: self.tasks.bind_worktree(kw["task_id"], kw["worktree"], kw.get("owner", "")),
            "task_list":        lambda **kw: self.tasks.list_all(),
            "spawn_teammate":   lambda **kw: self.team.spawn(kw["name"], kw["role"], kw["prompt"]),
            "list_teammates":   lambda **kw: self.team.list_all(),
            "send_message":     lambda **kw: self.bus.send("lead", kw["to"], kw["content"], kw.get("msg_type", "message")),
            "read_inbox":       lambda **kw: json.dumps(self.bus.read_inbox("lead"), indent=2),
            "broadcast":        lambda **kw: self.bus.broadcast("lead", kw["content"], self.team.member_names()),
            "shutdown_request": lambda **kw: self.handle_shutdown_request(kw["teammate"]),
            "plan_approval":    lambda **kw: self.handle_plan_review(kw["request_id"], kw["approve"], kw.get("feedback", "")),
            "idle":             lambda **kw: "Lead does not idle.",
            "claim_task":       lambda **kw: self.tasks.claim(kw["task_id"], "lead"),
            "worktree_create":  lambda **kw: self.worktrees.create(kw["name"], kw.get("task_id"), kw.get("base_ref", "HEAD")),
            "worktree_list":    lambda **kw: self.worktrees.list_all(),
            "worktree_status":  lambda **kw: self.worktrees.status(kw["name"]),
            "worktree_run":     lambda **kw: self.worktrees.run(kw["name"], kw["command"]),
            "worktree_remove":  lambda **kw: self.worktrees.remove(kw["name"], kw.get("force", False), kw.get("complete_task", False)),
            "worktree_keep":    lambda **kw: self.worktrees.keep(kw["name"]),
            "worktree_events":  lambda **kw: self.events.list_recent(kw.get("limit", 20)),
        }

    def handle_shutdown_request(self, teammate: str) -> str:
        req_id = str(uuid.uuid4())[:8]
        self.shutdown_requests[req_id] = {"target": teammate, "status": "pending"}
        self.bus.send("lead", teammate, "Please shut down.", "shutdown_request", {"request_id": req_id})
        return f"Shutdown request {req_id} sent to '{teammate}'"

    def handle_plan_review(self, request_id: str, approve: bool, feedback: str = "") -> str:
        req = self.plan_requests.get(request_id)
        if not req: return f"Error: Unknown plan request_id '{request_id}'"
        req["status"] = "approved" if approve else "rejected"
        self.bus.send("lead", req["from"], feedback, "plan_approval_response",
                 {"request_id": request_id, "approve": approve, "feedback": feedback})
        return f"Plan {req['status']} for '{req['from']}'"

    def loop(self, messages: list):
        rounds_without_todo = 0
        while True:
            # s06: compression pipeline
            microcompact(messages)
            if estimate_tokens(messages) > TOKEN_THRESHOLD:
                print("[auto-compact triggered]")
                messages[:] = auto_compact(messages)
            
            # s08: drain background notifications
            notifs = self.bg.drain()
            if notifs:
                txt = "\n".join(f"[bg:{n['task_id']}] {n['status']}: {n['result']}" for n in notifs)
                messages.append({"role": "user", "content": f"<background-results>\n{txt}\n</background-results>"})
                messages.append({"role": "assistant", "content": "Noted background results."})
            
            # s10: check lead inbox
            inbox = self.bus.read_inbox("lead")
            if inbox:
                messages.append({"role": "user", "content": f"<inbox>{json.dumps(inbox, indent=2)}</inbox>"})
                messages.append({"role": "assistant", "content": "Noted inbox messages."})
            
            # LLM call
            response = client.messages.create(
                model=MODEL, system=self.system_prompt, messages=messages,
                tools=TOOLS, max_tokens=8000,
            )
            messages.append({"role": "assistant", "content": response.content})
            if response.stop_reason != "tool_use":
                return
            
            # Tool execution
            results = []
            used_todo = False
            manual_compress = False
            for block in response.content:
                if block.type == "tool_use":
                    if block.name == "compress":
                        manual_compress = True
                    handler = self.tool_handlers.get(block.name)
                    try:
                        output = handler(**block.input) if handler else f"Unknown tool: {block.name}"
                    except Exception as e:
                        output = f"Error: {e}"
                    print(f"> {block.name}: {str(output)[:200]}")
                    results.append({"type": "tool_result", "tool_use_id": block.id, "content": str(output)})
                    if block.name == "TodoWrite":
                        used_todo = True
            
            # s03: nag reminder (only when todo workflow is active)
            rounds_without_todo = 0 if used_todo else rounds_without_todo + 1
            if self.todo.has_open_items() and rounds_without_todo >= 3:
                results.insert(0, {"type": "text", "text": "<reminder>Update your todos.</reminder>"})
            messages.append({"role": "user", "content": results})
            
            # s06: manual compress
            if manual_compress:
                print("[manual compact]")
                messages[:] = auto_compact(messages)
