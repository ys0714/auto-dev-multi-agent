import { TeammateManager } from './teammate';
import { MessageBus } from './message-bus';
import { TaskManager } from './task-manager';
import { WorktreeManager } from './worktree';
import { TOOLS } from '../tools';
import { MODEL_ID, WORKDIR, POLL_INTERVAL, IDLE_TIMEOUT, TASKS_DIR } from '../../infra/config';
import { Anthropic } from '@anthropic-ai/sdk';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);

// Helper functions for tools
const runBash = async (command: string) => {
  try {
    const { stdout, stderr } = await execAsync(command, { cwd: WORKDIR, timeout: 120000 });
    return (stdout + stderr).trim() || "(no output)";
  } catch (e: any) {
    return e.message;
  }
};

const runRead = (filePath: string, limit?: number) => {
  try {
    const fullPath = path.resolve(WORKDIR, filePath);
    const content = fs.readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');
    if (limit && limit < lines.length) {
      return lines.slice(0, limit).join('\n') + `\n... (${lines.length - limit} more)`;
    }
    return content;
  } catch (e: any) {
    return `Error: ${e.message}`;
  }
};

const runWrite = (filePath: string, content: string) => {
  try {
    const fullPath = path.resolve(WORKDIR, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
    return `Wrote ${content.length} bytes`;
  } catch (e: any) {
    return `Error: ${e.message}`;
  }
};

const runEdit = (filePath: string, oldText: string, newText: string) => {
  try {
    const fullPath = path.resolve(WORKDIR, filePath);
    const content = fs.readFileSync(fullPath, 'utf-8');
    if (!content.includes(oldText)) return `Error: Text not found in ${filePath}`;
    fs.writeFileSync(fullPath, content.replace(oldText, newText));
    return `Edited ${filePath}`;
  } catch (e: any) {
    return `Error: ${e.message}`;
  }
};

export async function teammateLoop(
  name: string,
  role: string,
  prompt: string,
  teamMgr: TeammateManager,
  bus: MessageBus,
  taskMgr: TaskManager,
  worktreeMgr: WorktreeManager,
  client: Anthropic,
  schemaPath?: string
) {
  const teamName = teamMgr['config'].team_name; // Accessing private property for simplicity in this refactor
  let sysPrompt = `You are '${name}', role: ${role}, team: ${teamName}, at ${WORKDIR}.
To collaborate and manage tasks, you MUST use the CLI tool via the bash tool. Run 'npx ts-node src/cli/agent-cli.ts --help' to see available commands. (If running in production, use 'node dist/cli/agent-cli.js --help')
You will auto-claim new tasks. Use idle tool when you have no more work.`;

  const localTools = [...TOOLS];
  let requireSubmit = false;

  if (schemaPath && fs.existsSync(schemaPath)) {
    try {
      const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
      localTools.push({
        name: 'submit_result',
        description: 'Submit the final result of your task using the mandated schema structure.',
        input_schema: schema
      });
      requireSubmit = true;
      sysPrompt += `\n\nCRITICAL: You have been assigned a strict MapReduce task. You MUST use the 'submit_result' tool to submit your final answer before shutting down. Your answer must strictly match the schema.`;
    } catch (e) {
      console.error(`Failed to load schema from ${schemaPath}:`, e);
    }
  }

  const messages: any[] = [{ role: 'user', content: prompt }];
  
  while (true) {
    // -- WORK PHASE --
    for (let i = 0; i < 50; i++) {
      const inbox = bus.readInbox(name);
      for (const msg of inbox) {
        if (msg.type === 'shutdown_request') {
          teamMgr.setStatus(name, 'shutdown');
          return;
        }
        messages.push({ role: 'user', content: JSON.stringify(msg) });
      }

      let response;
      try {
        response = await client.messages.create({
          model: MODEL_ID,
          system: sysPrompt,
          messages: messages,
          tools: localTools as any,
          max_tokens: 8000
        });
      } catch (e) {
        teamMgr.setStatus(name, 'shutdown'); // Or idle/error
        return;
      }

      messages.push({ role: 'assistant', content: response.content });

      if (response.stop_reason !== 'tool_use') {
        break;
      }

      const results = [];
      let idleRequested = false;

      for (const block of response.content) {
        if (block.type === 'tool_use') {
          let output = '';
          const input = block.input as any;

          if (block.name === 'idle') {
            idleRequested = true;
            output = "Entering idle phase.";
          } else if (block.name === 'bash') {
            output = await runBash(input.command);
          } else if (block.name === 'read_file') {
            output = runRead(input.path, input.limit);
          } else if (block.name === 'write_file') {
            output = runWrite(input.path, input.content);
          } else if (block.name === 'edit_file') {
            output = runEdit(input.path, input.old_text, input.new_text);
          } else if (block.name === 'submit_result') {
            const resultPayload = JSON.stringify(input, null, 2);
            output = bus.send(name, 'lead', `Task Result:\n${resultPayload}`, 'task_result');
            // Allow teammate to shut down after submitting
            teamMgr.setStatus(name, 'shutdown');
            return;
          } else {
             // Handle other tools or return unknown
             output = `Unknown tool: ${block.name}`;
          }
          
          console.log(`  [${name}] ${block.name}: ${output.substring(0, 120)}`);
          results.push({ type: 'tool_result', tool_use_id: block.id, content: output });
        }
      }
      messages.push({ role: 'user', content: results });
      
      if (idleRequested) break;
    }

    // -- IDLE PHASE --
    teamMgr.setStatus(name, 'idle');
    let resume = false;
    const polls = Math.floor(IDLE_TIMEOUT / Math.max(POLL_INTERVAL, 1));
    
    for (let i = 0; i < polls; i++) {
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL * 1000));
      
      const inbox = bus.readInbox(name);
      if (inbox.length > 0) {
        for (const msg of inbox) {
          if (msg.type === 'shutdown_request') {
            teamMgr.setStatus(name, 'shutdown');
            return;
          }
          messages.push({ role: 'user', content: JSON.stringify(msg) });
        }
        resume = true;
        break;
      }

      // Scan for unclaimed tasks
      // This is a simplified version of scanning .tasks dir
      const allTasksStr = taskMgr.listAll();
      // We need to parse the listAll output or use a method that returns objects.
      // Since listAll returns a string, we should probably add a method to TaskManager to get unclaimed tasks.
      // For now, let's assume we can read the files directly or use a helper.
      // Let's rely on taskMgr having a method or just reading files here since we imported fs/path.
      
      const taskFiles = fs.readdirSync(TASKS_DIR).filter(f => f.startsWith('task_') && f.endsWith('.json'));
      const unclaimed = [];
      for (const f of taskFiles) {
        const t = JSON.parse(fs.readFileSync(path.join(TASKS_DIR, f), 'utf-8'));
        if (t.status === 'pending' && !t.owner && (!t.blockedBy || t.blockedBy.length === 0)) {
          unclaimed.push(t);
        }
      }

      if (unclaimed.length > 0) {
        const task = unclaimed[0];
        taskMgr.claim(task.id, name);
        
        // Identity re-injection
        if (messages.length <= 3) {
          messages.unshift({ role: 'user', content: `<identity>You are '${name}', role: ${role}, team: ${teamName}.</identity>` });
          messages.splice(1, 0, { role: 'assistant', content: `I am ${name}. Continuing.` });
        }
        
        messages.push({ role: 'user', content: `<auto-claimed>Task #${task.id}: ${task.subject}\n${task.description || ''}</auto-claimed>` });
        messages.push({ role: 'assistant', content: `Claimed task #${task.id}. Working on it.` });
        resume = true;
        break;
      }
    }

    if (!resume) {
      teamMgr.setStatus(name, 'shutdown');
      return;
    }
    teamMgr.setStatus(name, 'working');
  }
}
