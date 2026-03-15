import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { WORKDIR } from '../../infra/config';
import { TaskManager } from './task-manager';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface Worktree {
  name: string;
  path: string;
  branch: string;
  task_id: number | null;
  status: 'active' | 'removed' | 'kept';
  created_at: number;
  removed_at?: number;
  kept_at?: number;
}

export interface WorktreeIndex {
  worktrees: Worktree[];
}

export class EventBus {
  private path: string;

  constructor(eventLogPath: string) {
    this.path = eventLogPath;
    if (!fs.existsSync(path.dirname(this.path))) {
      fs.mkdirSync(path.dirname(this.path), { recursive: true });
    }
    if (!fs.existsSync(this.path)) {
      fs.writeFileSync(this.path, '');
    }
  }

  emit(event: string, task: any = {}, worktree: any = {}, error?: string): void {
    const payload = {
      event,
      ts: Date.now() / 1000,
      task: task || {},
      worktree: worktree || {},
      ...(error ? { error } : {})
    };
    fs.appendFileSync(this.path, JSON.stringify(payload) + '\n');
  }

  listRecent(limit: number = 20): string {
    const n = Math.max(1, Math.min(limit || 20, 200));
    const content = fs.readFileSync(this.path, 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    const recent = lines.slice(-n);
    const items = recent.map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return { event: 'parse_error', raw: line };
      }
    });
    return JSON.stringify(items, null, 2);
  }
}

export class WorktreeManager {
  private repoRoot: string;
  private tasks: TaskManager;
  private events: EventBus;
  private dir: string;
  private indexPath: string;
  public gitAvailable: boolean = false;

  constructor(repoRoot: string, tasks: TaskManager, events: EventBus) {
    this.repoRoot = repoRoot;
    this.tasks = tasks;
    this.events = events;
    this.dir = path.join(repoRoot, '..', `${path.basename(repoRoot)}-worktrees`);
    this.indexPath = path.join(this.dir, 'index.json');

    if (!fs.existsSync(this.dir)) {
      fs.mkdirSync(this.dir, { recursive: true });
    }
    if (!fs.existsSync(this.indexPath)) {
      fs.writeFileSync(this.indexPath, JSON.stringify({ worktrees: [] }, null, 2));
    }

    this.checkGitRepo();
  }

  private async checkGitRepo() {
    try {
      await execAsync('git rev-parse --is-inside-work-tree', { cwd: this.repoRoot });
      this.gitAvailable = true;
    } catch {
      this.gitAvailable = false;
    }
  }

  private async runGit(args: string[]): Promise<string> {
    if (!this.gitAvailable) {
      throw new Error("Not in a git repository. worktree tools require git.");
    }
    try {
      const { stdout, stderr } = await execAsync(`git ${args.join(' ')}`, { cwd: this.repoRoot, timeout: 120000 });
      return (stdout + stderr).trim() || "(no output)";
    } catch (error: any) {
      const msg = (error.stdout + error.stderr).trim();
      throw new Error(msg || `git ${args.join(' ')} failed`);
    }
  }

  private loadIndex(): WorktreeIndex {
    return JSON.parse(fs.readFileSync(this.indexPath, 'utf-8'));
  }

  private saveIndex(data: WorktreeIndex): void {
    fs.writeFileSync(this.indexPath, JSON.stringify(data, null, 2));
  }

  private find(name: string): Worktree | undefined {
    const idx = this.loadIndex();
    return idx.worktrees.find(wt => wt.name === name);
  }

  private validateName(name: string): void {
    if (!/^[A-Za-z0-9._-]{1,40}$/.test(name || "")) {
      throw new Error("Invalid worktree name. Use 1-40 chars: letters, numbers, ., _, -");
    }
  }

  async create(name: string, taskId?: number, baseRef: string = "HEAD"): Promise<string> {
    this.validateName(name);
    if (this.find(name)) {
      throw new Error(`Worktree '${name}' already exists in index`);
    }
    if (taskId !== undefined) {
      // Check if task exists (we'll implement exist check in TaskManager)
      try {
        this.tasks.get(taskId);
      } catch {
        throw new Error(`Task ${taskId} not found`);
      }
    }

    const wtPath = path.join(this.dir, name);
    const branch = `wt/${name}`;
    this.events.emit("worktree.create.before", taskId !== undefined ? { id: taskId } : {}, { name, base_ref: baseRef });

    try {
      await this.runGit(["worktree", "add", "-b", branch, wtPath, baseRef]);

      const entry: Worktree = {
        name,
        path: wtPath,
        branch,
        task_id: taskId ?? null,
        status: 'active',
        created_at: Date.now() / 1000
      };

      const idx = this.loadIndex();
      idx.worktrees.push(entry);
      this.saveIndex(idx);

      if (taskId !== undefined) {
        this.tasks.bindWorktree(taskId, name);
      }

      this.events.emit("worktree.create.after", taskId !== undefined ? { id: taskId } : {}, { name, path: wtPath, branch, status: 'active' });
      return JSON.stringify(entry, null, 2);
    } catch (e: any) {
      this.events.emit("worktree.create.failed", taskId !== undefined ? { id: taskId } : {}, { name, base_ref: baseRef }, e.message);
      throw e;
    }
  }

  listAll(): string {
    const idx = this.loadIndex();
    const wts = idx.worktrees;
    if (wts.length === 0) return "No worktrees in index.";
    
    return wts.map(wt => {
      const suffix = wt.task_id ? ` task=${wt.task_id}` : "";
      return `[${wt.status}] ${wt.name} -> ${wt.path} (${wt.branch})${suffix}`;
    }).join('\n');
  }

  async status(name: string): Promise<string> {
    const wt = this.find(name);
    if (!wt) return `Error: Unknown worktree '${name}'`;
    
    if (!fs.existsSync(wt.path)) return `Error: Worktree path missing: ${wt.path}`;

    try {
      const { stdout, stderr } = await execAsync("git status --short --branch", { cwd: wt.path, timeout: 60000 });
      return (stdout + stderr).trim() || "Clean worktree";
    } catch (e: any) {
      return (e.stdout + e.stderr).trim();
    }
  }

  async run(name: string, command: string): Promise<string> {
    const dangerous = ["rm -rf /", "sudo", "shutdown", "reboot", "> /dev/"];
    if (dangerous.some(d => command.includes(d))) {
      return "Error: Dangerous command blocked";
    }

    const wt = this.find(name);
    if (!wt) return `Error: Unknown worktree '${name}'`;
    if (!fs.existsSync(wt.path)) return `Error: Worktree path missing: ${wt.path}`;

    try {
      const { stdout, stderr } = await execAsync(command, { cwd: wt.path, timeout: 300000 });
      const out = (stdout + stderr).trim();
      return out.length > 50000 ? out.substring(0, 50000) : (out || "(no output)");
    } catch (e: any) {
       if (e.code === 'ETIMEDOUT') return "Error: Timeout (300s)";
       const msg = (e.stdout + e.stderr).trim();
       return msg || `Error: ${e.message}`;
    }
  }

  async remove(name: string, force: boolean = false, completeTask: boolean = false): Promise<string> {
    const wt = this.find(name);
    if (!wt) return `Error: Unknown worktree '${name}'`;

    this.events.emit("worktree.remove.before", wt.task_id !== null ? { id: wt.task_id } : {}, { name, path: wt.path });

    try {
      const args = ["worktree", "remove"];
      if (force) args.push("--force");
      args.push(wt.path);
      await this.runGit(args);

      if (completeTask && wt.task_id !== null) {
        const taskId = wt.task_id;
        const taskJson = this.tasks.get(taskId);
        const before = JSON.parse(taskJson);
        this.tasks.update(taskId, "completed");
        this.tasks.unbindWorktree(taskId);
        this.events.emit("task.completed", { id: taskId, subject: before.subject, status: "completed" }, { name });
      }

      const idx = this.loadIndex();
      const item = idx.worktrees.find(w => w.name === name);
      if (item) {
        item.status = 'removed';
        item.removed_at = Date.now() / 1000;
      }
      this.saveIndex(idx);

      this.events.emit("worktree.remove.after", wt.task_id !== null ? { id: wt.task_id } : {}, { name, path: wt.path, status: 'removed' });
      return `Removed worktree '${name}'`;
    } catch (e: any) {
      this.events.emit("worktree.remove.failed", wt.task_id !== null ? { id: wt.task_id } : {}, { name, path: wt.path }, e.message);
      throw e;
    }
  }

  keep(name: string): string {
    const wt = this.find(name);
    if (!wt) return `Error: Unknown worktree '${name}'`;

    const idx = this.loadIndex();
    const item = idx.worktrees.find(w => w.name === name);
    if (item) {
      item.status = 'kept';
      item.kept_at = Date.now() / 1000;
    }
    this.saveIndex(idx);
    
    const kept = idx.worktrees.find(w => w.name === name);

    this.events.emit("worktree.keep", wt.task_id !== null ? { id: wt.task_id } : {}, { name, path: wt.path, status: 'kept' });
    return JSON.stringify(kept, null, 2);
  }
}
