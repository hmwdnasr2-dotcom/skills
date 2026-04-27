import Anthropic from '@anthropic-ai/sdk';
import type { BrainAdapter, ChatOptions, ChatResponse, Message } from './adapter.js';

export class ClaudeBrain implements BrainAdapter {
  private model: string;

  constructor({ model = 'claude-haiku-4-5-20251001' }: { model?: string } = {}) {
    this.model = model;
  }

  // Create a fresh client on each use so a key change via /setkey takes
  // effect immediately without needing a server restart.
  private get client(): Anthropic {
    return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  async chat(messages: Message[], opts: ChatOptions = {}): Promise<ChatResponse> {
    const systemText = messages.find((m) => m.role === 'system')?.content;
    const convo = toAnthropicMessages(messages.filter((m) => m.role !== 'system'));

    const toolDefs = opts.tools?.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool['input_schema'],
    }));

    const baseParams = {
      model:      this.model,
      max_tokens: opts.maxTokens ?? 8096,
      messages:   convo,
      ...(toolDefs?.length ? { tools: toolDefs } : {}),
    };

    // Use prompt-caching beta when there is a system prompt (caches it across turns).
    const response = systemText
      ? await this.client.beta.promptCaching.messages.create({
          ...baseParams,
          system: [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }],
        })
      : await this.client.messages.create(baseParams);

    const textBlock  = response.content.find((b) => b.type === 'text');
    const toolBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');

    return {
      content:  textBlock?.type === 'text' ? textBlock.text : '',
      toolCalls: toolBlocks.map((b) => ({ id: b.id, name: b.name, input: b.input as Record<string, unknown> })),
      // Preserve raw blocks so the brain proxy can rebuild the assistant message correctly.
      _rawContent: toolBlocks.length ? response.content : undefined,
      usage: {
        inputTokens:  response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }

  async *stream(messages: Message[], opts: ChatOptions = {}): AsyncGenerator<string> {
    const systemText = messages.find((m) => m.role === 'system')?.content;
    const convo = toAnthropicMessages(messages.filter((m) => m.role !== 'system'));

    const stream = await this.client.messages.stream({
      model:      this.model,
      max_tokens: opts.maxTokens ?? 8096,
      system:     systemText,
      messages:   convo,
    });

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        yield chunk.delta.text;
      }
    }
  }
}

/**
 * Convert internal Message[] to the Anthropic MessageParam[] format.
 * Handles:
 *  - role:'system'   → filtered out by callers before this function
 *  - role:'tool'     → merged into a user message as tool_result content blocks
 *  - role:'assistant' with _rawContent → use the full content block array
 *    (required so tool_use blocks appear in the assistant turn)
 */
function toAnthropicMessages(messages: Message[]): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = [];

  for (const m of messages) {
    if (m.role === 'tool') {
      // Tool results must be user-role messages with tool_result content blocks.
      const block: Anthropic.ToolResultBlockParam = {
        type:        'tool_result',
        tool_use_id: m.toolCallId!,
        content:     m.content,
      };
      const prev = result[result.length - 1];
      if (prev?.role === 'user' && Array.isArray(prev.content)) {
        (prev.content as Anthropic.ToolResultBlockParam[]).push(block);
      } else {
        result.push({ role: 'user', content: [block] });
      }
    } else if (m.role === 'assistant' && m._rawContent) {
      // Assistant turn that contained tool_use blocks — send the full block array
      // so Anthropic can match them with the subsequent tool_result blocks.
      result.push({ role: 'assistant', content: m._rawContent as Anthropic.ContentBlock[] });
    } else {
      result.push({ role: m.role as 'user' | 'assistant', content: m.content });
    }
  }

  return result;
}
