import fs from 'fs';
import path from 'path';
import { WORKDIR } from '../../infra/config';
import { eventBus } from '../../domain/event-bus';

export function safePath(p: string): string {
  const resolvedPath = path.resolve(WORKDIR, p);
  if (!resolvedPath.startsWith(WORKDIR)) {
    throw new Error(`Path escapes workspace: ${p}`);
  }
  return resolvedPath;
}

export function runRead(filePath: string, limit?: number): string {
  try {
    const fullPath = safePath(filePath);
    if (!fs.existsSync(fullPath)) {
      return `Error: File not found: ${filePath}`;
    }
    const content = fs.readFileSync(fullPath, 'utf-8');
    eventBus.publish({ type: 'file:read', path: fullPath, content });
    const lines = content.split('\n');
    if (limit && limit < lines.length) {
      return lines.slice(0, limit).join('\n') + `\n... (${lines.length - limit} more)`;
    }
    return content.slice(0, 50000);
  } catch (e: any) {
    return `Error: ${e.message}`;
  }
}

export function runWrite(filePath: string, content: string): string {
  try {
    const fullPath = safePath(filePath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(fullPath, content, 'utf-8');
    eventBus.publish({ type: 'file:write', path: fullPath, content });
    return `Wrote ${content.length} bytes to ${filePath}`;
  } catch (e: any) {
    return `Error: ${e.message}`;
  }
}

export function runEdit(filePath: string, oldText: string, newText: string): string {
  try {
    const fullPath = safePath(filePath);
    if (!fs.existsSync(fullPath)) {
      return `Error: File not found: ${filePath}`;
    }
    const content = fs.readFileSync(fullPath, 'utf-8');
    eventBus.publish({ type: 'file:read', path: fullPath, content });
    if (!content.includes(oldText)) {
      return `Error: Text not found in ${filePath}`;
    }
    const newContent = content.replace(oldText, newText);
    fs.writeFileSync(fullPath, newContent, 'utf-8');
    eventBus.publish({ type: 'file:edit', path: fullPath, old_text: oldText, new_text: newText });
    return `Edited ${filePath}`;
  } catch (e: any) {
    return `Error: ${e.message}`;
  }
}
