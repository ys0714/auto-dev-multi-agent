import fs from 'fs';
import path from 'path';
import { INBOX_DIR } from '../../infra/config';
import { InboxMessage } from '../../domain/types';

export class MessageBus {
  constructor() {
    if (!fs.existsSync(INBOX_DIR)) {
      fs.mkdirSync(INBOX_DIR, { recursive: true });
    }
  }

  send(sender: string, to: string, content: string, msgType: string = 'message', extra: any = {}): string {
    const msg: InboxMessage = {
      type: msgType,
      from: sender,
      content,
      timestamp: Date.now(),
      ...extra
    };

    const inboxPath = path.join(INBOX_DIR, `${to}.jsonl`);
    fs.appendFileSync(inboxPath, JSON.stringify(msg) + '\n');
    return `Sent ${msgType} to ${to}`;
  }

  readInbox(name: string): InboxMessage[] {
    const inboxPath = path.join(INBOX_DIR, `${name}.jsonl`);
    if (!fs.existsSync(inboxPath)) return [];

    const content = fs.readFileSync(inboxPath, 'utf-8');
    const messages = content.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
    
    fs.writeFileSync(inboxPath, ''); // Clear inbox
    return messages;
  }

  broadcast(sender: string, content: string, names: string[]): string {
    let count = 0;
    for (const name of names) {
      if (name !== sender) {
        this.send(sender, name, content, 'broadcast');
        count++;
      }
    }
    return `Broadcast to ${count} teammates`;
  }
}
