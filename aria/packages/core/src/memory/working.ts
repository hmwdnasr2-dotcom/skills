import type { Message } from '../brain/adapter.js';

export class WorkingMemory {
  private messages: Message[] = [];
  private maxMessages: number;

  constructor({ maxMessages = 20 }: { maxMessages?: number } = {}) {
    this.maxMessages = maxMessages;
  }

  seed(messages: Message[]) {
    this.messages = messages.slice(-this.maxMessages);
  }

  append(message: Message) {
    this.messages.push(message);
    if (this.messages.length > this.maxMessages) {
      const system = this.messages.filter((m) => m.role === 'system');
      const rest = this.messages.filter((m) => m.role !== 'system');
      this.messages = [...system, ...rest.slice(-this.maxMessages + system.length)];
    }
  }

  get(): Message[] {
    return [...this.messages];
  }

  clear() {
    this.messages = [];
  }
}
