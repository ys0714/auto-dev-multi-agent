import fs from 'fs';
import path from 'path';
import { eventBus, AgentEvent } from '../../domain/event-bus';
import { SESSIONS_DIR, WORKDIR } from '../../infra/config';

type SessionLogRecord = {
  ts: string;
  type: string;
  [key: string]: unknown;
};

export class SessionLogSubscriber {
  private readonly pendingBySession = new Map<string, Promise<void>>();
  private currentSessionId: string | null = null;

  constructor() {
    if (!fs.existsSync(SESSIONS_DIR)) {
      fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    }
    eventBus.subscribe(this.handleEvent.bind(this));
  }

  setSessionId(sessionId: string) {
    this.currentSessionId = sessionId;
  }

  private async handleEvent(event: AgentEvent) {
    const sessionId = (event as any).sessionId || this.currentSessionId;
    if (!sessionId) return;

    const ts = new Date().toISOString();
    
    if (event.type === 'agent:start') {
      await this.append(sessionId, { ts, type: 'session_start', sessionId, workspace: WORKDIR });
      return;
    } 
    
    if (event.type === 'agent:stop') {
      await this.append(sessionId, { ts, type: 'session_end', sessionId });
      return;
    } 
    
    if (event.type === 'message:sent') {
      await this.append(sessionId, { ts, type: 'message', role: event.role, content: event.content });
      return;
    } 
    
    if (event.type === 'system:message') {
      await this.append(sessionId, { ts, type: 'message', role: 'system', content: event.message, isSummary: event.isSummary });
      return;
    } 
    
    if (event.type === 'tool:call') {
      await this.append(sessionId, { ts, type: 'tool_call', tool: event.tool, input: event.input });
      return;
    } 
    
    if (event.type === 'tool:result') {
      await this.append(sessionId, { ts, type: 'tool_result', tool: event.tool, result: event.result });
      return;
    } 
    
    if (event.type === 'error:occurred') {
       await this.append(sessionId, { ts, type: 'error:occurred', tool: event.tool, error: event.error });
       return;
    }

    if (event.type === 'session:summary') {
      await this.append(sessionId, {
        ts,
        type: 'summary',
        from: event.from,
        to: event.to,
        content: event.content
      });
      return;
    }
  }

  private async append(sessionId: string, record: SessionLogRecord): Promise<void> {
    const logPath = path.join(SESSIONS_DIR, `${sessionId}.jsonl`);
    
    const previous = this.pendingBySession.get(sessionId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        try {
          await fs.promises.appendFile(logPath, `${JSON.stringify(record)}\n`, 'utf8');
        } catch {
          // Best effort logging
        }
      });
    
    this.pendingBySession.set(sessionId, next);
    await next;
  }
}

// Global instance for session logging
export const sessionLogSubscriber = new SessionLogSubscriber();
