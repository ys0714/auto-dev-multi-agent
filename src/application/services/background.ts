import { v4 as uuidv4 } from 'uuid';
import { exec } from 'child_process';
import { WORKDIR } from '../../infra/config';
import { BackgroundTask, BackgroundNotification } from '../../domain/types';

export class BackgroundManager {
  private tasks: Map<string, BackgroundTask> = new Map();
  private notifications: BackgroundNotification[] = [];

  run(command: string, timeout: number = 120000): string {
    const tid = uuidv4().slice(0, 8);
    this.tasks.set(tid, { status: 'running', command, result: null });

    const child = exec(command, { cwd: WORKDIR, timeout }, (error, stdout, stderr) => {
      const output = (stdout + stderr).trim().slice(0, 50000);
      const status = error ? 'error' : 'completed';
      const result = output || '(no output)';

      const task = this.tasks.get(tid);
      if (task) {
        task.status = status;
        task.result = result;
        this.notifications.push({
          task_id: tid,
          status,
          result: result.slice(0, 500)
        });
      }
    });

    return `Background task ${tid} started: ${command.slice(0, 80)}`;
  }

  check(tid?: string): string {
    if (tid) {
      const task = this.tasks.get(tid);
      return task ? `[${task.status}] ${task.result || '(running)'}` : `Unknown: ${tid}`;
    }

    if (this.tasks.size === 0) return 'No bg tasks.';

    return Array.from(this.tasks.entries())
      .map(([id, task]) => `${id}: [${task.status}] ${task.command.slice(0, 60)}`)
      .join('\n');
  }

  drain(): BackgroundNotification[] {
    const notifs = [...this.notifications];
    this.notifications = [];
    return notifs;
  }
}
