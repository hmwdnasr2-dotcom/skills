import Anthropic from '@anthropic-ai/sdk';
import type { BrainAdapter, ChatOptions, ChatResponse, Message } from './adapter.js';

export class ClaudeBrain implements BrainAdapter {
  private client: Anthropic;
  private model: string;

  constructor({ model = 'claude-sonnet-4-6' }: { model?: string } = {}) {
    this.client = new Anthropic();
    this.model = model;
  }

  async chat(messages: Message[], opts: ChatOptions = {}): Promise<ChatResponse> {
    const systemText = messages.find((m) => m.role === 'system')?.content;
    const convo = messages.filter((m) => m.role !== 'system');

    // Use the prompt-caching beta when a system prompt is present so the
    // system block is cached across turns (avoids re-billing on long system prompts).
    if (systemText) {
      const response = await this.client.beta.promptCaching.messages.create({
        model: this.model,
        max_tokens: opts.maxTokens ?? 8096,
        system: [
          { type: 'text', text: systemText, cache_control: { type: 'ephemeral' } },
        ],
        messages: convo.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
        tools: opts.tools?.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters as Anthropic.Tool['input_schema'],
        })),
      });

      const textBlock = response.content.find((b) => b.type === 'text');
      const toolBlocks = response.content.filter((b) => b.type === 'tool_use');

      return {
        content: textBlock?.type === 'text' ? textBlock.text : '',
        toolCalls: toolBlocks
          .filter((b) => b.type === 'tool_use')
          .map((b) => {
            if (b.type !== 'tool_use') return null!;
            return { id: b.id, name: b.name, input: b.input as Record<string, unknown> };
          }),
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      };
    }

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: opts.maxTokens ?? 8096,
      messages: convo.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      tools: opts.tools?.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters as Anthropic.Tool['input_schema'],
      })),
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    const toolBlocks = response.content.filter((b) => b.type === 'tool_use');

    return {
      content: textBlock?.type === 'text' ? textBlock.text : '',
      toolCalls: toolBlocks
        .filter((b) => b.type === 'tool_use')
        .map((b) => {
          if (b.type !== 'tool_use') return null!;
          return { id: b.id, name: b.name, input: b.input as Record<string, unknown> };
        }),
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }

  async *stream(messages: Message[], opts: ChatOptions = {}): AsyncGenerator<string> {
    const systemText = messages.find((m) => m.role === 'system')?.content;
    const convo = messages.filter((m) => m.role !== 'system');

    const streamParams: Anthropic.MessageStreamParams = {
      model: this.model,
      max_tokens: opts.maxTokens ?? 8096,
      system: systemText,
      messages: convo.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    };

    const stream = await this.client.messages.stream(streamParams);

    for await (const chunk of stream) {
      if (
        chunk.type === 'content_block_delta' &&
        chunk.delta.type === 'text_delta'
      ) {
        yield chunk.delta.text;
      }
    }
  }
}
