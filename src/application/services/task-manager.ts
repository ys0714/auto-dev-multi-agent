import fs from 'fs';
import path from 'path';
import { TASKS_DIR } from '../../infra/config';
import { Task } from '../../domain/types';

export class TaskManager {
  constructor() {
    if (!fs.existsSync(TASKS_DIR)) {
      fs.mkdirSync(TASKS_DIR, { recursive: true });
    }
  }

  private nextId(): number {
    const files = fs.readdirSync(TASKS_DIR).filter(f => f.startsWith('task_') && f.endsWith('.json'));
    const ids = files.map(f => parseInt(f.split('_')[1].split('.')[0]));
    return Math.max(0, ...ids) + 1;
  }

  private load(tid: number): Task {
    const p = path.join(TASKS_DIR, `task_${tid}.json`);
    if (!fs.existsSync(p)) throw new Error(`Task ${tid} not found`);
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  }

  private save(task: Task): void {
    const p = path.join(TASKS_DIR, `task_${task.id}.json`);
    fs.writeFileSync(p, JSON.stringify(task, null, 2));
  }

  create(subject: string, description: string = ''): string {
    const task: Task = {
      id: this.nextId(),
      subject,
      description,
      status: 'pending',
      owner: null,
      blockedBy: [],
      blocks: [],
      worktree: null
    };
    this.save(task);
    return JSON.stringify(task, null, 2);
  }

  get(tid: number): string {
    return JSON.stringify(this.load(tid), null, 2);
  }

  update(tid: number, status?: string, addBlockedBy?: number[], addBlocks?: number[], owner?: string): string {
    const task = this.load(tid);
    
    if (status) {
      task.status = status as any;
      if (status === 'completed') {
        const files = fs.readdirSync(TASKS_DIR).filter(f => f.startsWith('task_') && f.endsWith('.json'));
        for (const f of files) {
          const t: Task = JSON.parse(fs.readFileSync(path.join(TASKS_DIR, f), 'utf-8'));
          if (t.blockedBy.includes(tid)) {
            t.blockedBy = t.blockedBy.filter(id => id !== tid);
            this.save(t);
          }
        }
      }
      if (status === 'deleted') {
        fs.unlinkSync(path.join(TASKS_DIR, `task_${tid}.json`));
        return `Task ${tid} deleted`;
      }
    }

    if (owner !== undefined) {
      task.owner = owner;
    }

    if (addBlockedBy) {
      task.blockedBy = [...new Set([...task.blockedBy, ...addBlockedBy])];
    }
    if (addBlocks) {
      task.blocks = [...new Set([...task.blocks, ...addBlocks])];
    }

    this.save(task);
    return JSON.stringify(task, null, 2);
  }

  listAll(): string {
    const files = fs.readdirSync(TASKS_DIR).filter(f => f.startsWith('task_') && f.endsWith('.json'));
    const tasks: Task[] = files.map(f => JSON.parse(fs.readFileSync(path.join(TASKS_DIR, f), 'utf-8')));
    
    if (tasks.length === 0) return 'No tasks.';

    return tasks.map(t => {
      const m = {
        pending: '[ ]',
        in_progress: '[>]',
        completed: '[x]',
        deleted: '[-]'
      }[t.status] || '[?]';
      
      const owner = t.owner ? ` @${t.owner}` : '';
      const blocked = t.blockedBy.length > 0 ? ` (blocked by: ${t.blockedBy.join(', ')})` : '';
      const wt = t.worktree ? ` wt=${t.worktree}` : '';
      
      return `${m} #${t.id}: ${t.subject}${owner}${blocked}${wt}`;
    }).join('\n');
  }

  claim(tid: number, owner: string): string {
    const task = this.load(tid);
    task.owner = owner;
    task.status = 'in_progress';
    this.save(task);
    return `Claimed task #${tid} for ${owner}`;
  }

  bindWorktree(tid: number, worktree: string, owner?: string): string {
    const task = this.load(tid);
    task.worktree = worktree;
    if (owner) task.owner = owner;
    if (task.status === 'pending') task.status = 'in_progress';
    this.save(task);
    return JSON.stringify(task, null, 2);
  }

  unbindWorktree(tid: number): string {
    const task = this.load(tid);
    task.worktree = null;
    this.save(task);
    return JSON.stringify(task, null, 2);
  }
}
