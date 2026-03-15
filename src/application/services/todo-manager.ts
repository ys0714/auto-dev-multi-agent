import { TodoItem } from '../../domain/types';

export class TodoManager {
  private items: TodoItem[] = [];

  update(items: any[]): string {
    const validated: TodoItem[] = [];
    let inProgressCount = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const content = (item.content || '').trim();
      const status = (item.status || 'pending').toLowerCase();
      const activeForm = (item.activeForm || '').trim();

      if (!content) throw new Error(`Item ${i}: content required`);
      if (!['pending', 'in_progress', 'completed'].includes(status)) {
        throw new Error(`Item ${i}: invalid status '${status}'`);
      }
      if (!activeForm) throw new Error(`Item ${i}: activeForm required`);
      if (status === 'in_progress') inProgressCount++;

      validated.push({ content, status, activeForm });
    }

    if (validated.length > 20) throw new Error('Max 20 todos');
    if (inProgressCount > 1) throw new Error('Only one in_progress allowed');

    this.items = validated;
    return this.render();
  }

  render(): string {
    if (this.items.length === 0) return 'No todos.';
    
    const lines = this.items.map(item => {
      const mark = {
        completed: '[x]',
        in_progress: '[>]',
        pending: '[ ]'
      }[item.status] || '[?]';
      
      const suffix = item.status === 'in_progress' ? ` <- ${item.activeForm}` : '';
      return `${mark} ${item.content}${suffix}`;
    });

    const done = this.items.filter(t => t.status === 'completed').length;
    lines.push(`\n(${done}/${this.items.length} completed)`);
    return lines.join('\n');
  }

  hasOpenItems(): boolean {
    return this.items.some(item => item.status !== 'completed');
  }
}
