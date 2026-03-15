import { eventBus, AgentEvent } from '../../domain/event-bus';

export class ConsoleLogger {
  constructor() {
    eventBus.subscribe(this.handleEvent.bind(this));
  }

  handleEvent(event: AgentEvent) {
    switch (event.type) {
      case 'tool:call':
        // console.log(`[Tool Call] ${event.tool}`);
        break;
      case 'tool:result':
        // console.log(`[Tool Result] ${event.tool} => ${String(event.result).slice(0, 100)}...`);
        break;
      case 'error:occurred':
        console.error(`[Error] ${event.tool || 'Unknown'}: ${event.error}`);
        break;
      case 'message:sent':
        const content = event.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text') {
              console.log(`\x1b[32m[Assistant]\x1b[0m ${block.text}`);
            }
          }
        } else if (typeof content === 'string') {
          console.log(`\x1b[32m[Assistant]\x1b[0m ${content}`);
        }
        break;
      case 'agent:start':
        console.log('[Agent Started]');
        break;
      case 'agent:stop':
        console.log('[Agent Stopped]');
        break;
    }
  }
}
