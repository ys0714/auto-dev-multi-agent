export type AgentEvent =
  | { type: 'agent:start'; sessionId?: string }
  | { type: 'agent:stop'; sessionId?: string }
  | { type: 'tool:call'; tool: string; input: any; sessionId?: string }
  | { type: 'tool:result'; tool: string; result: any; sessionId?: string }
  | { type: 'message:sent'; role: string; content: any; sessionId?: string }
  | { type: 'error:occurred'; error: string; tool?: string; sessionId?: string }
  | { type: 'file:read'; path: string; content?: string; sessionId?: string }
  | { type: 'file:write'; path: string; content: string; sessionId?: string }
  | { type: 'file:edit'; path: string; old_text: string; new_text: string; sessionId?: string }
  | { type: 'task:created'; task_id: string; subject: string; sessionId?: string }
  | { type: 'task:updated'; task_id: string; status: string; sessionId?: string }
  | { type: 'task:completed'; task_id: string; sessionId?: string }
  | { type: 'worktree:created'; name: string; task_id: string; sessionId?: string }
  | { type: 'worktree:removed'; name: string; sessionId?: string }
  | { type: 'inspector:error'; file: string; error: string; sessionId?: string }
  | { type: 'system:message'; message: string; isSummary?: boolean; sessionId?: string }
  | { type: 'session:summary'; from: number; to: number; content: string; sessionId?: string };

type Subscriber<T> = (event: T) => void | Promise<void>;

export class InMemoryEventBus<T extends { type: string }> {
  private subscribers = new Set<Subscriber<T>>();

  subscribe(subscriber: Subscriber<T>): () => void {
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  publish(event: T): void {
    for (const subscriber of this.subscribers) {
      try {
        const result = subscriber(event);
        if (result instanceof Promise) {
          result.catch(err => console.error('EventBus error in async subscriber:', err));
        }
      } catch (err) {
        console.error('EventBus error in sync subscriber:', err);
      }
    }
  }
}

// Global singleton instance
export const eventBus = new InMemoryEventBus<AgentEvent>();
