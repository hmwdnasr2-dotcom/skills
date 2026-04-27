import OpenAI from 'openai';
import type { BrainAdapter, ChatOptions, ChatResponse, Message } from './adapter.js';

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

export class DeepSeekBrain implements BrainAdapter {
  private model: string;

  constructor({ model = 'deepseek-chat' }: { model?: string } = {}) {
    this.model = model;
  }

  // Fresh client per call so a key set via /setkey takes effect immediately.
  private get client(): OpenAI {
    return new OpenAI({
      apiKey:  process.env.DEEPSEEK_API_KEY,
      baseURL: DEEPSEEK_BASE_URL,
    });
  }

  private toOpenAIMessages(messages: Message[]): OpenAI.Chat.ChatCompletionMessageParam[] {
    return messages.map((m): OpenAI.Chat.ChatCompletionMessageParam => {
      // Assistant turn that included tool calls — restore tool_calls array
      if (m.role === 'assistant' && m._rawContent) {
        return {
          role:       'assistant',
          content:    m.content || null,
          tool_calls: m._rawContent as OpenAI.Chat.ChatCompletionMessageToolCall[],
        };
      }
      // Tool result — needs tool_call_id, not content alone
      if (m.role === 'tool') {
        return {
          role:         'tool',
          content:      m.content,
          tool_call_id: m.toolCallId ?? '',
        };
      }
      return { role: m.role as 'system' | 'user' | 'assistant', content: m.content };
    });
  }

  async chat(messages: Message[], opts: ChatOptions = {}): Promise<ChatResponse> {
    const response = await this.client.chat.completions.create({
      model:      this.model,
      max_tokens: opts.maxTokens ?? 8096,
      messages:   this.toOpenAIMessages(messages),
      tools: opts.tools?.map((t) => ({
        type:     'function' as const,
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
    });

    const choice    = response.choices[0];
    const rawCalls  = choice.message.tool_calls;
    const toolCalls = rawCalls?.map((tc) => ({
      id:    tc.id,
      name:  tc.function.name,
      input: JSON.parse(tc.function.arguments) as Record<string, unknown>,
    }));

    return {
      content:     choice.message.content ?? '',
      toolCalls,
      // Preserve raw tool_calls so the proxy can reconstruct them next turn
      _rawContent: rawCalls?.length ? rawCalls : undefined,
      usage: {
        inputTokens:  response.usage?.prompt_tokens    ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
    };
  }

  async *stream(messages: Message[], opts: ChatOptions = {}): AsyncGenerator<string> {
    const stream = await this.client.chat.completions.create({
      model:      this.model,
      max_tokens: opts.maxTokens ?? 8096,
      messages:   this.toOpenAIMessages(messages),
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield delta;
    }
  }
}
