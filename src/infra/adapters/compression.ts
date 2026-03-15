import fs from 'fs';
import path from 'path';
import { TRANSCRIPT_DIR, MODEL_ID, WORKDIR, TOOL_OUTPUTS_DIR } from '../config';
import { Anthropic } from '@anthropic-ai/sdk';
import { Message, AgentSession, SessionSummaryBlock } from '../../domain/types';
import { v4 as uuidv4 } from 'uuid';
import { eventBus } from '../../domain/event-bus';

export function estimateTokens(messages: Message[]): number {
  return Math.floor(JSON.stringify(messages).length / 4);
}

export function compactSessionContext(session: AgentSession) {
  const COMPRESSION_LENGTH_THRESHOLD = 100000; // ~25k tokens
  const TOOL_OUTPUT_LENGTH_THRESHOLD = 1000;
  const RECENT_MESSAGES_TO_KEEP_FULL = 6;
  const COMPRESSION_CHUNK_SIZE = 10;

  const nonSystemMessages = session.messages.filter((m) => m.role !== 'system');
  let uncompressedMessages = nonSystemMessages.slice(session.compressedCount);
  
  let currentLength = JSON.stringify(uncompressedMessages).length;

  // Step 1: Compaction (Context Offloading)
  if (currentLength > COMPRESSION_LENGTH_THRESHOLD) {
    const messagesToCompact = uncompressedMessages.slice(0, Math.max(0, uncompressedMessages.length - RECENT_MESSAGES_TO_KEEP_FULL));
    
    let offloadedCount = 0;
    for (const msg of messagesToCompact) {
      if (msg.role === 'user' && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'tool_result' && typeof block.content === 'string' && block.content.length > TOOL_OUTPUT_LENGTH_THRESHOLD) {
            if (!fs.existsSync(TOOL_OUTPUTS_DIR)) fs.mkdirSync(TOOL_OUTPUTS_DIR, { recursive: true });
            
            const fileId = block.tool_use_id || uuidv4().slice(0, 8);
            const filePath = path.join(TOOL_OUTPUTS_DIR, `cmd_${fileId}.log`);
            
            fs.writeFileSync(filePath, block.content);
            block.content = `[Result too long. Offloaded to ${filePath}. Use read_file to view details if needed.]`;
            offloadedCount++;
          }
        }
      }
    }
    
    if (offloadedCount > 0) {
      eventBus.publish({ type: 'system:message', message: `[Compaction] Offloaded ${offloadedCount} large tool results to disk.` });
    }
  }

  // Recalculate length after compaction
  currentLength = JSON.stringify(uncompressedMessages).length;

  // Step 2: Summarization
  while (currentLength > COMPRESSION_LENGTH_THRESHOLD && uncompressedMessages.length > RECENT_MESSAGES_TO_KEEP_FULL) {
    const chunkStart = session.compressedCount;
    const chunk = uncompressedMessages.slice(0, COMPRESSION_CHUNK_SIZE);
    if (chunk.length === 0) break;

    const userNotes: string[] = [];
    const assistantNotes: string[] = [];
    const toolNotes: string[] = [];

    for (const message of chunk) {
      let content = '';
      if (typeof message.content === 'string') {
        content = message.content;
      } else if (Array.isArray(message.content)) {
        content = message.content.map((p: any) => typeof p === 'string' ? p : p.text || '').join(' ');
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

    const summary: SessionSummaryBlock = {
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

    uncompressedMessages = nonSystemMessages.slice(session.compressedCount);
    currentLength = JSON.stringify(uncompressedMessages).length;
  }
}

export function microcompact(messages: Message[]): void {
  const indices: any[] = [];
  messages.forEach((msg, i) => {
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      msg.content.forEach((part: any) => {
        if (part.type === 'tool_result') {
          indices.push(part);
        }
      });
    }
  });

  if (indices.length <= 3) {
    return;
  }

  for (const part of indices.slice(0, -3)) {
    if (typeof part.content === 'string' && part.content.length > 100) {
      part.content = '[cleared]';
    }
  }
}

export async function autoCompact(session: AgentSession, client: Anthropic): Promise<Message[]> {
  const messages = session.messages;
  if (!fs.existsSync(TRANSCRIPT_DIR)) {
    fs.mkdirSync(TRANSCRIPT_DIR, { recursive: true });
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const transcriptPath = path.join(TRANSCRIPT_DIR, `transcript_${timestamp}.jsonl`);
  
  const fileStream = fs.createWriteStream(transcriptPath);
  for (const msg of messages) {
    fileStream.write(JSON.stringify(msg) + '\n');
  }
  fileStream.end();

  const convText = JSON.stringify(messages).slice(0, 80000);
  
  const response = await client.messages.create({
    model: MODEL_ID,
    messages: [{ role: 'user', content: `Summarize for continuity:\n${convText}` }],
    max_tokens: 2000,
  });

  const summary = (response.content[0] as any).text;

  return [
    { role: 'user', content: `[Compressed. Transcript: ${transcriptPath}]\n${summary}` },
    { role: 'assistant', content: 'Understood. Continuing with summary context.' },
  ];
}
