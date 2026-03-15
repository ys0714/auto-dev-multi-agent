import fs from 'fs';
import path from 'path';
import { AgentSession, Message, SessionSummaryBlock } from '../../domain/types';
import { SESSIONS_DIR } from '../../infra/config';
import { sessionLogSubscriber } from '../subscribers/session-log-subscriber';
import { eventBus } from '../../domain/event-bus';

export class SessionManager {
  private currentSessionId: string | null = null;
  private currentSession: AgentSession | null = null;

  constructor() {
    this.ensureSessionsDir();
  }

  private ensureSessionsDir() {
    if (!fs.existsSync(SESSIONS_DIR)) {
      fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    }
  }

  createSession(): AgentSession {
    const id = new Date().toISOString().replace(/[:.]/g, '-');
    this.currentSessionId = id;
    sessionLogSubscriber.setSessionId(id);
    
    this.currentSession = {
      id,
      messages: [],
      summaries: [],
      compressedCount: 0
    };
    
    return this.currentSession;
  }

  getSession(): AgentSession {
    if (!this.currentSession) {
      return this.createSession();
    }
    return this.currentSession;
  }

  async save(session: AgentSession): Promise<void> {
    // SessionLogSubscriber handles append-only persisting.
    // This is just to update the memory reference if needed.
    this.currentSession = session;
  }

  async load(sessionId: string): Promise<AgentSession> {
    const filePath = path.join(SESSIONS_DIR, `${sessionId}.jsonl`);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Session file not found: ${filePath}`);
    }

    const content = await fs.promises.readFile(filePath, 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    
    const messages: Message[] = [];
    const summaries: SessionSummaryBlock[] = [];
    let compressedCount = 0;

    for (const line of lines) {
      try {
        const record = JSON.parse(line);
        if (record.type === 'message') {
          messages.push({ 
            role: record.role, 
            content: record.content,
            toolCallId: record.toolCallId,
            toolName: record.toolName,
            toolCalls: record.toolCalls
          } as any);
        } else if (record.type === 'summary') {
          const from = record.from as number;
          const to = record.to as number;
          const text = record.content as string;
          const ts = record.ts as string;
          summaries.push({ ts, from, to, content: text });
          compressedCount = Math.max(compressedCount, to + 1);
        }
      } catch (e) {
        continue;
      }
    }

    this.currentSessionId = sessionId;
    sessionLogSubscriber.setSessionId(sessionId);
    
    this.currentSession = {
      id: sessionId,
      messages,
      summaries,
      compressedCount
    };
    
    return this.currentSession;
  }

  async loadLatest(): Promise<AgentSession | null> {
    const files = await fs.promises.readdir(SESSIONS_DIR);
    const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));
    
    if (jsonlFiles.length === 0) {
      return null;
    }

    const fileStats = await Promise.all(jsonlFiles.map(async (file) => {
      const filePath = path.join(SESSIONS_DIR, file);
      const stats = await fs.promises.stat(filePath);
      return { file, mtime: stats.mtimeMs };
    }));

    fileStats.sort((a, b) => b.mtime - a.mtime);
    
    const latestFile = fileStats[0].file;
    const sessionId = latestFile.replace('.jsonl', '');
    console.log(`Resuming session: ${sessionId}`);
    return this.load(sessionId);
  }

  listSessions(): string[] {
    if (!fs.existsSync(SESSIONS_DIR)) return [];
    return fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.jsonl')).map(f => f.replace('.jsonl', ''));
  }
}
