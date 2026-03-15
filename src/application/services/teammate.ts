import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { TEAM_DIR } from '../../infra/config';
import { TeamConfig, TeammateConfig, PlanRequest } from '../../domain/types';
import { MessageBus } from './message-bus';
import { TaskManager } from './task-manager';

export class TeammateManager {
  private configPath: string;
  private config: TeamConfig;
  private bus: MessageBus;
  private taskMgr: TaskManager;
  public planRegistry: Record<string, PlanRequest>;

  constructor(bus: MessageBus, taskMgr: TaskManager, planRegistry?: Record<string, PlanRequest>) {
    if (!fs.existsSync(TEAM_DIR)) {
      fs.mkdirSync(TEAM_DIR, { recursive: true });
    }
    this.configPath = path.join(TEAM_DIR, 'config.json');
    this.config = this.load();
    this.bus = bus;
    this.taskMgr = taskMgr;
    this.planRegistry = planRegistry || {};
  }

  private load(): TeamConfig {
    if (fs.existsSync(this.configPath)) {
      return JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
    }
    return { team_name: 'default', members: [] };
  }

  private save(): void {
    fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
  }

  private find(name: string): TeammateConfig | undefined {
    return this.config.members.find(m => m.name === name);
  }

  spawn(name: string, role: string, prompt: string, schemaPath?: string): string {
    let member = this.find(name);
    if (member) {
      if (member.status !== 'idle' && member.status !== 'shutdown') {
        return `Error: '${name}' is currently ${member.status}`;
      }
      member.status = 'working';
      member.role = role;
    } else {
      member = { name, role, status: 'working' };
      this.config.members.push(member);
    }
    this.save();
    
    // Spawn the teammate process in the background
    const scriptPath = path.join(process.cwd(), 'src/cli/run-teammate.ts');
    
    const isCompiled = __filename.endsWith('.js');
    const args = isCompiled ? [scriptPath.replace('.ts', '.js'), '--name', name, '--role', role, '--prompt', prompt] : ['ts-node', scriptPath, '--name', name, '--role', role, '--prompt', prompt];
    if (schemaPath) {
      args.push('--schema_path', schemaPath);
    }

    const child = spawn(isCompiled ? 'node' : 'npx', args, {
      detached: true,
      stdio: 'ignore' // We don't want to pipe I/O to lead process
    });
    
    child.unref(); // Allow the parent (lead) to exit independently
    
    return `Spawned '${name}' (role: ${role}) with PID ${child.pid}`;
  }

  setStatus(name: string, status: 'idle' | 'working' | 'shutdown'): void {
    const member = this.find(name);
    if (member) {
      member.status = status;
      this.save();
    }
  }

  listAll(): string {
    if (this.config.members.length === 0) return 'No teammates.';
    
    const lines = [`Team: ${this.config.team_name}`];
    for (const m of this.config.members) {
      lines.push(`  ${m.name} (${m.role}): ${m.status}`);
    }
    return lines.join('\n');
  }

  memberNames(): string[] {
    return this.config.members.map(m => m.name);
  }
}
