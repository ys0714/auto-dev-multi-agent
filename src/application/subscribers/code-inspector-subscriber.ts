import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { eventBus } from '../../domain/event-bus';

const execAsync = promisify(exec);

export interface InspectionResult {
  file: string;
  passed: boolean;
  error?: string;
  timestamp: number;
}

export class CodeInspectorSubscriber {
  private queue: string[] = [];
  private processing: boolean = false;
  private results: InspectionResult[] = [];

  constructor() {
    this.setupListeners();
  }

  private setupListeners() {
    // Listen for file writes
    eventBus.subscribe((event) => {
      if (event.type === 'file:write' && event.path) {
        this.queue.push(event.path);
        this.processQueue();
      }
    });
    
    // Listen for file edits
    eventBus.subscribe((event) => {
        if (event.type === 'file:edit' && event.path) {
          this.queue.push(event.path);
          this.processQueue();
        }
      });
  }

  private async processQueue() {
    if (this.processing || this.queue.length === 0) return;
    
    this.processing = true;
    const filePath = this.queue.shift();
    
    if (filePath) {
      await this.inspect(filePath);
    }
    
    this.processing = false;
    if (this.queue.length > 0) {
      this.processQueue();
    }
  }

  private async inspect(filePath: string) {
    const ext = path.extname(filePath);
    let error: string | undefined;

    try {
      if (ext === '.js') {
        await execAsync(`node --check "${filePath}"`);
      } else if (ext === '.py') {
        await execAsync(`python3 -m py_compile "${filePath}"`);
      } else if (ext === '.json') {
        // JSON syntax check via node one-liner
        // We need to escape the path properly for the shell command
        const safePath = filePath.replace(/"/g, '\\"');
        await execAsync(`node -e "JSON.parse(require('fs').readFileSync('${safePath}'))"`);
      }
    } catch (e: any) {
      error = e.stderr || e.message;
    }

    // Only create a result if there is an error (to keep noise low)
    if (error) {
        const result: InspectionResult = {
            file: filePath,
            passed: false,
            error: error.trim(),
            timestamp: Date.now()
        };
        this.results.push(result);
        eventBus.publish({ type: 'inspector:error', file: filePath, error: error.trim() });
    }
  }

  // Method for the Agent to drain results (like BackgroundManager)
  drain(): InspectionResult[] {
    const current = [...this.results];
    this.results = [];
    return current;
  }
}
