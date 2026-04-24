import { GoogleGenerativeAI } from '@google/generative-ai';
import type { BrainAdapter, ChatOptions, ChatResponse, Message } from './adapter.js';

export class GeminiBrain implements BrainAdapter {
  private genAI: GoogleGenerativeAI;
  private model: string;

  constructor({ model = 'gemini-1.5-pro' }: { model?: string } = {}) {
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? '');
    this.model = model;
  }

  async chat(messages: Message[], _opts: ChatOptions = {}): Promise<ChatResponse> {
    const genModel = this.genAI.getGenerativeModel({ model: this.model });
    const history = messages
      .filter((m) => m.role !== 'system')
      .slice(0, -1)
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    const last = messages.at(-1)!;
    const chat = genModel.startChat({ history });
    const result = await chat.sendMessage(last.content);

    return { content: result.response.text() };
  }

  async *stream(messages: Message[], _opts: ChatOptions = {}): AsyncGenerator<string> {
    const genModel = this.genAI.getGenerativeModel({ model: this.model });
    const history = messages
      .filter((m) => m.role !== 'system')
      .slice(0, -1)
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    const last = messages.at(-1)!;
    const chat = genModel.startChat({ history });
    const result = await chat.sendMessageStream(last.content);

    for await (const chunk of result.stream) {
      yield chunk.text();
    }
  }
}
