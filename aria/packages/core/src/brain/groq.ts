import OpenAI from 'openai';
import type { BrainAdapter, ChatOptions, ChatResponse, Message } from './adapter.js';

export class GroqBrain implements BrainAdapter {
  private client: OpenAI;
  private model: string;

  constructor({ model = 'llama-3.3-70b-versatile' }: { model?: string } = {}) {
    this.client = new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: 'https://api.groq.com/openai/v1',
    });
    this.model = model;
  }

  async chat(messages: Message[], opts: ChatOptions = {}): Promise<ChatResponse> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: opts.maxTokens ?? 8096,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })) as OpenAI.Chat.ChatCompletionMessageParam[],
      tools: opts.tools?.map((t) => ({
        type: 'function' as const,
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
    });

    const choice = response.choices[0];
    const toolCalls = choice.message.tool_calls?.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      input: JSON.parse(tc.function.arguments) as Record<string, unknown>,
    }));

    return {
      content: choice.message.content ?? '',
      toolCalls,
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
    };
  }

  async *stream(messages: Message[], opts: ChatOptions = {}): AsyncGenerator<string> {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: opts.maxTokens ?? 8096,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })) as OpenAI.Chat.ChatCompletionMessageParam[],
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield delta;
    }
  }
}
