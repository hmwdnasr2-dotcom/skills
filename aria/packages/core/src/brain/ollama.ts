import type { BrainAdapter, ChatOptions, ChatResponse, Message } from './adapter.js';

export class OllamaBrain implements BrainAdapter {
  private baseUrl: string;
  private model: string;

  constructor({
    model = 'llama3',
    baseUrl = 'http://localhost:11434',
  }: { model?: string; baseUrl?: string } = {}) {
    this.baseUrl = baseUrl;
    this.model = model;
  }

  async chat(messages: Message[], _opts: ChatOptions = {}): Promise<ChatResponse> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        stream: false,
      }),
    });

    const data = await res.json() as { message: { content: string } };
    return { content: data.message.content };
  }

  async *stream(messages: Message[], _opts: ChatOptions = {}): AsyncGenerator<string> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        stream: true,
      }),
    });

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const line = decoder.decode(value);
      try {
        const json = JSON.parse(line) as { message: { content: string }; done: boolean };
        if (json.message?.content) yield json.message.content;
      } catch {
        // partial chunk — skip
      }
    }
  }
}
