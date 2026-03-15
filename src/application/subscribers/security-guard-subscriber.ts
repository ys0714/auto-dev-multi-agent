import { eventBus } from '../../domain/event-bus';

export class SecurityGuardSubscriber {
  private readFiles: Set<string> = new Set();
  private sensitivePatterns: string[] = [
    'rm -rf /',
    'mkfs',
    '> /dev/sda', 
    ':(){:|:&};:',
    'dd if=/dev/zero'
  ];

  constructor() {
    this.setupListeners();
  }

  private setupListeners() {
    eventBus.subscribe((event) => {
      if (event.type === 'file:read' && event.path) {
        this.readFiles.add(event.path);
      }
    });
  }

  validateToolUse(toolName: string, input: any): { allowed: boolean, reason?: string } {
    if (toolName === 'write_file' || toolName === 'edit_file') {
      return this.validateWrite(input.path);
    }
    
    if (toolName === 'bash' || toolName === 'worktree_run') {
      return this.validateCommand(input.command);
    }

    return { allowed: true };
  }

  private validateWrite(filePath: string): { allowed: boolean, reason?: string } {
    // In a strict implementation, we would block writes to unread files.
    // However, creating NEW files is common and valid without reading first.
    // The risk is overwriting existing files without reading.
    // For this reference implementation, we'll log a warning but allow it to be non-intrusive.
    
    if (!this.readFiles.has(filePath)) {
       // Ideally check if file exists on disk. If exists && !read => BLOCK.
       // Here we just warn.
       console.warn(`[Security Warning] Writing to file '${filePath}' without prior read.`);
    }
    return { allowed: true };
  }

  private validateCommand(command: string): { allowed: boolean, reason?: string } {
    const isSensitive = this.sensitivePatterns.some(pattern => command.includes(pattern));
    
    if (isSensitive) {
      const reason = `Command contains sensitive pattern and is blocked by SecurityGuard: ${command}`;
      console.error(`[Security Block] ${reason}`);
      return { allowed: false, reason };
    }
    return { allowed: true };
  }
}
