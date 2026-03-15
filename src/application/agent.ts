import { Message, ToolResult, InboxMessage, AgentSession, SessionSummaryBlock } from '../domain/types';
import { TOOLS } from './tools';
import { client } from '../infra/adapters/llm';
import { MODEL_ID, WORKDIR, TOKEN_THRESHOLD } from '../infra/config';
import { TodoManager } from './services/todo-manager';
import { SkillLoader } from './services/skill-loader';
import { TaskManager } from './services/task-manager';
import { BackgroundManager } from './services/background';
import { MessageBus } from './services/message-bus';
import { TeammateManager } from './services/teammate';
import { WorktreeManager, EventBus } from './services/worktree';
import { ProfileManager } from './services/profile-manager';
import { eventBus } from '../domain/event-bus';
import { runRead, runWrite, runEdit } from '../infra/adapters/file-system';
import { runBash } from '../infra/adapters/shell';
import { estimateTokens, microcompact, compactSessionContext } from '../infra/adapters/compression';
import { v4 as uuidv4 } from 'uuid';

import fs from 'fs';
import path from 'path';

import { SecurityGuardSubscriber } from './subscribers/security-guard-subscriber';
import { CodeInspectorSubscriber } from './subscribers/code-inspector-subscriber';
import { codeInspectorSubscriber, securityGuardSubscriber } from './subscribers';

import { loadUserProfileBrief } from '../domain/user-profile';

export class Agent {
  private todo: TodoManager;
  private skills: SkillLoader;
  private taskMgr: TaskManager;
  private bg: BackgroundManager;
  private bus: MessageBus;
  private team: TeammateManager;
  private worktrees: WorktreeManager;
  private events: EventBus;
  private profile: ProfileManager;
  private security: SecurityGuardSubscriber;
  private inspector: CodeInspectorSubscriber;

  private shutdownRequests: Map<string, any> = new Map();
  private planRequests: Record<string, any>;

  constructor(
    todo: TodoManager,
    skills: SkillLoader,
    taskMgr: TaskManager,
    bg: BackgroundManager,
    bus: MessageBus,
    team: TeammateManager,
    worktrees: WorktreeManager,
    events: EventBus,
    profile: ProfileManager,
    planRegistry: Record<string, any>
  ) {
    this.todo = todo;
    this.skills = skills;
    this.taskMgr = taskMgr;
    this.bg = bg;
    this.bus = bus;
    this.team = team;
    this.worktrees = worktrees;
    this.events = events;
    this.profile = profile;
    this.planRequests = planRegistry;
    this.security = securityGuardSubscriber!;
    this.inspector = codeInspectorSubscriber!;
  }

  private getSystemPrompt(): string {
    const profileSection = this.profile.getSystemPromptSnippet();
    const globalProfile = loadUserProfileBrief();
    
    let basePrompt = `You are a coding agent at ${WORKDIR}. Use tools to solve tasks.
To collaborate and manage tasks, you MUST use the CLI tool via the bash tool. Run 'npx ts-node src/cli/agent-cli.ts --help' to see available commands for task management and messaging. (If running in production, use 'node dist/cli/agent-cli.js --help')
Use TodoWrite for short checklists. Use task for subagent delegation. Use load_skill for specialized knowledge.
Use worktree_* tools for isolated task execution.
Skills: ${this.skills.descriptions()}`;
    
    if (globalProfile) {
      basePrompt += `\n\nCross-project user profile (persistent memory, use as preference/context hints):\n${globalProfile}`;
    }
    
    return profileSection ? `${basePrompt}\n\nUser Profile Context:\n${profileSection}` : basePrompt;
  }

  private async runSubagent(prompt: string, agentType: string = 'Explore'): Promise<string> {
    const subTools: any[] = [
      {
        name: "bash",
        description: "Run command.",
        input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] }
      },
      {
        name: "read_file",
        description: "Read file.",
        input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] }
      }
    ];

    if (agentType !== 'Explore') {
      subTools.push(
        {
          name: "write_file",
          description: "Write file.",
          input_schema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] }
        },
        {
          name: "edit_file",
          description: "Edit file.",
          input_schema: { type: "object", properties: { path: { type: "string" }, old_text: { type: "string" }, new_text: { type: "string" } }, required: ["path", "old_text", "new_text"] }
        }
      );
    }

    const subMsgs: Message[] = [{ role: 'user', content: prompt }];
    let resp: any = null;

    for (let i = 0; i < 30; i++) {
      resp = await client.messages.create({
        model: MODEL_ID,
        messages: subMsgs as any,
        tools: subTools,
        max_tokens: 8000
      });

      subMsgs.push({ role: 'assistant', content: resp.content });

      if (resp.stop_reason !== 'tool_use') {
        break;
      }

      const results: any[] = [];
      for (const block of resp.content) {
        if (block.type === 'tool_use') {
          let output = 'Unknown tool';
          try {
            switch (block.name) {
              case 'bash': output = await runBash(block.input.command); break;
              case 'read_file': output = runRead(block.input.path); break;
              case 'write_file': output = runWrite(block.input.path, block.input.content); break;
              case 'edit_file': output = runEdit(block.input.path, block.input.old_text, block.input.new_text); break;
            }
          } catch (e: any) {
            output = `Error: ${e.message}`;
          }
          results.push({ type: 'tool_result', tool_use_id: block.id, content: output.slice(0, 50000) });
        }
      }
      subMsgs.push({ role: 'user', content: results });
    }

    if (resp) {
      const textBlocks = resp.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
      return textBlocks || '(no summary)';
    }
    return '(subagent failed)';
  }

  private handleShutdownRequest(teammate: string): string {
    const reqId = uuidv4().slice(0, 8);
    this.shutdownRequests.set(reqId, { target: teammate, status: 'pending' });
    this.bus.send('lead', teammate, 'Please shut down.', 'shutdown_request', { request_id: reqId });
    return `Shutdown request ${reqId} sent to '${teammate}'`;
  }

  private handlePlanReview(requestId: string, approve: boolean, feedback: string = ''): string {
    const req = this.planRequests[requestId];
    if (!req) return `Error: Unknown plan request_id '${requestId}'`;
    
    req.status = approve ? 'approved' : 'rejected';
    this.bus.send('lead', req.from, feedback, 'plan_approval_response', { request_id: requestId, approve, feedback });
    return `Plan ${req.status} for '${req.from}'`;
  }

  private maybeCompressContext(session: AgentSession) {
    compactSessionContext(session);
  }

  private buildContextFromSession(session: AgentSession): Message[] {
    const CONTEXT_WINDOW_SIZE = 20;
    const MAX_SUMMARY_BLOCKS_IN_CONTEXT = 3;

    const systemMessage = session.messages.find((m) => m.role === 'system');
    const nonSystem = session.messages.filter((m) => m.role !== 'system');
    const start = Math.max(session.compressedCount, nonSystem.length - CONTEXT_WINDOW_SIZE);
    let recent = nonSystem.slice(start);

    // trim leading tool messages to prevent API errors
    let trimIdx = 0;
    while (trimIdx < recent.length && recent[trimIdx].role === 'tool') {
      trimIdx += 1;
    }
    while (trimIdx < recent.length) {
      const head = recent[trimIdx];
      if (!head || head.role !== 'assistant') break;
      if (!Array.isArray(head.toolCalls) || head.toolCalls.length === 0) break;
      trimIdx += 1;
    }
    if (trimIdx > 0) {
      recent = recent.slice(trimIdx);
    }

    const summaryBlocks = session.summaries.slice(-MAX_SUMMARY_BLOCKS_IN_CONTEXT);
    const summaryMessage: Message | undefined = summaryBlocks.length > 0 ? {
      role: 'system',
      content: `Compressed memory blocks:\n${summaryBlocks.map((item) => `[${item.from}-${item.to}] ${item.content}`).join('\n\n')}`
    } : undefined;

    const base = systemMessage ? [systemMessage] : [];
    return summaryMessage ? [...base, summaryMessage, ...recent] : [...base, ...recent];
  }

  async loop(session: AgentSession): Promise<void> {
    let roundsWithoutTodo = 0;

    while (true) {
      this.maybeCompressContext(session);
      const apiMessages = this.buildContextFromSession(session);

      // s08: drain background notifications
      const notifs = this.bg.drain();
      if (notifs.length > 0) {
        const txt = notifs.map(n => `[bg:${n.task_id}] ${n.status}: ${n.result}`).join('\n');
        session.messages.push({ role: 'user', content: `<background-results>\n${txt}\n</background-results>` });
        session.messages.push({ role: 'assistant', content: 'Noted background results.' });
      }

      // s09: drain code inspector errors
      const inspectorErrors = this.inspector.drain();
      if (inspectorErrors.length > 0) {
        const txt = inspectorErrors.map(e => `[Code Inspection Error] ${e.file}: ${e.error}`).join('\n');
        session.messages.push({ role: 'user', content: `<system-check-failures>\n${txt}\n</system-check-failures>` });
        session.messages.push({ role: 'assistant', content: 'I see there are syntax errors in the files I just modified. I will fix them.' });
      }

      // s10: check lead inbox
      const inbox = this.bus.readInbox('lead');
      if (inbox.length > 0) {
        for (const msg of inbox) {
          if (msg.type === 'plan_approval_request' && msg.request_id) {
            this.planRequests[msg.request_id] = {
              status: 'pending',
              ...msg
            };
          }
        }
        session.messages.push({ role: 'user', content: `<inbox>${JSON.stringify(inbox, null, 2)}</inbox>` });
        session.messages.push({ role: 'assistant', content: 'Noted inbox messages.' });
      }

      // Filter out local system messages before sending to API
      // (already handled by buildContextFromSession, so we can just use apiMessages)

      // LLM call
      const response = await client.messages.create({
        model: MODEL_ID,
        system: this.getSystemPrompt(),
        messages: apiMessages as any,
        tools: TOOLS as any,
        max_tokens: 8000
      });

      session.messages.push({ role: 'assistant', content: response.content });
      eventBus.publish({ type: 'message:sent', role: 'assistant', content: response.content as any });

      if (response.stop_reason !== 'tool_use') {
        return;
      }

      // Tool execution
      const results: any[] = [];
      let usedTodo = false;
      let manualCompress = false;

      for (const block of response.content) {
        if (block.type === 'tool_use') {
          eventBus.publish({ type: 'tool:call', tool: block.name, input: block.input });
          if (block.name === 'compress') manualCompress = true;

          let output = 'Unknown tool';
          const input = block.input as any;
          
          // Security Check
          const securityCheck = this.security.validateToolUse(block.name, input);
          if (!securityCheck.allowed) {
            output = `Error: ${securityCheck.reason}`;
            eventBus.publish({ type: 'error:occurred', error: securityCheck.reason || 'Unknown error', tool: block.name });
            eventBus.publish({ type: 'tool:result', tool: block.name, result: output });
            results.push({ type: 'tool_result', tool_use_id: block.id, content: output });
            continue;
          }

          try {
            switch (block.name) {
              case 'bash': output = await runBash(input.command); break;
              case 'read_file': output = runRead(input.path, input.limit); break;
              case 'write_file': output = runWrite(input.path, input.content); break;
              case 'edit_file': output = runEdit(input.path, input.old_text, input.new_text); break;
              case 'TodoWrite': 
                output = this.todo.update(input.items); 
                usedTodo = true;
                break;
              case 'task': output = await this.runSubagent(input.prompt, input.agent_type); break;
              case 'load_skill': output = this.skills.load(input.name); break;
              case 'compress': output = 'Compressing...'; break;
              case 'background_run': output = this.bg.run(input.command, input.timeout); break;
              case 'check_background': output = this.bg.check(input.task_id); break;
              case 'idle': output = 'Lead does not idle.'; break;
              case 'worktree_create': output = await this.worktrees.create(input.name, input.task_id, input.base_ref); break;
              case 'worktree_list': output = this.worktrees.listAll(); break;
              case 'worktree_status': output = await this.worktrees.status(input.name); break;
              case 'worktree_run': output = await this.worktrees.run(input.name, input.command); break;
              case 'worktree_remove': output = await this.worktrees.remove(input.name, input.force, input.complete_task); break;
              case 'worktree_keep': output = this.worktrees.keep(input.name); break;
              case 'worktree_events': output = this.events.listRecent(input.limit); break;
              default: output = `Unknown tool: ${block.name}`;
            }
          } catch (e: any) {
            output = `Error: ${e.message}`;
            eventBus.publish({ type: 'error:occurred', error: e.message, tool: block.name });
          }

          console.log(`> ${block.name}: ${output.slice(0, 200)}`);
          eventBus.publish({ type: 'tool:result', tool: block.name, result: output });
          results.push({ type: 'tool_result', tool_use_id: block.id, content: output });
        }
      }

      // s03: nag reminder
      roundsWithoutTodo = usedTodo ? 0 : roundsWithoutTodo + 1;
      if (this.todo.hasOpenItems() && roundsWithoutTodo >= 3) {
        results.unshift({ type: 'text', text: '<reminder>Update your todos.</reminder>' });
      }

      session.messages.push({ role: 'user', content: results });

      // s06: manual compress
      if (manualCompress) {
        eventBus.publish({ type: 'system:message', message: '[manual compact]' });
        session.summaries = [];
        session.compressedCount = 0;
        
        const COMPRESSION_CHUNK_SIZE = 20;
        const nonSystemMessages = session.messages.filter((m) => m.role !== 'system');
        
        while (nonSystemMessages.length - session.compressedCount > COMPRESSION_CHUNK_SIZE) {
          const chunkStart = session.compressedCount;
          const chunk = nonSystemMessages.slice(chunkStart, chunkStart + COMPRESSION_CHUNK_SIZE);
          if (chunk.length === 0) break;

          const userNotes: string[] = [];
          const assistantNotes: string[] = [];
          const toolNotes: string[] = [];

          for (const message of chunk) {
            let content = '';
            if (typeof message.content === 'string') {
              content = message.content;
            } else if (Array.isArray(message.content)) {
              content = message.content.map(p => typeof p === 'string' ? p : (p as any).text || '').join(' ');
            }
            const text = content.replace(/\s+/g, ' ').trim();
            if (!text) continue;
            const short = text.length > 180 ? `${text.slice(0, 180)}...` : text;

            if (message.role === 'user') userNotes.push(short);
            if (message.role === 'assistant') assistantNotes.push(short);
            if (message.role === 'tool') toolNotes.push(short);
          }

          const lines: string[] = [];
          if (userNotes.length) lines.push(`user_intents: ${userNotes.slice(-3).join(' | ')}`);
          if (assistantNotes.length) lines.push(`assistant_actions: ${assistantNotes.slice(-3).join(' | ')}`);
          if (toolNotes.length) lines.push(`tool_results: ${toolNotes.slice(-5).join(' | ')}`);
          
          const summaryContent = lines.length === 0 ? '(summary empty)' : lines.join('\n');

          const summary = {
            ts: new Date().toISOString(),
            from: chunkStart,
            to: chunkStart + chunk.length - 1,
            content: summaryContent
          };

          session.summaries.push(summary);
          session.compressedCount += chunk.length;

          eventBus.publish({
            type: 'session:summary',
            sessionId: session.id,
            from: summary.from,
            to: summary.to,
            content: summary.content
          } as any);
        }
      }
    }
  }
}
