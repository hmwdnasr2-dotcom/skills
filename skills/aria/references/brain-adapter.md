# BrainAdapter — Pluggable Brain Interface

The `BrainAdapter` interface decouples ARIA's orchestration logic from any specific
LLM provider. Swap providers by passing a different adapter to `OpenClaw` at bootstrap —
no other code changes.

**Default**: Claude Sonnet (`claude-sonnet-4-6`) via the Anthropic SDK.
**Alternatives**: GPT-4o (OpenAI), Gemini (Google), Ollama (local).

---

## Interface

```typescript
// src/core/brain/adapter.ts

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;   // present when role === 'tool'
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema object
}

export interface ChatOptions {
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface ChatResponse {
  content: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
  }>;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface BrainAdapter {
  /** Single-turn completion — returns when the model is done (no tool loops). */
  chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse>;

  /** Streaming variant — yields text deltas. */
  stream(messages: Message[], options?: ChatOptions): AsyncGenerator<string>;
}
```

OpenClaw owns the tool-calling loop. `BrainAdapter.chat()` only needs to return
raw tool-call blocks; OpenClaw dispatches them and re-enters the brain automatically.

---

## Default: Claude Sonnet

Uses the official Anthropic SDK with prompt caching enabled on the system prompt.

```typescript
// src/core/brain/claude.ts
import Anthropic from '@anthropic-ai/sdk';
import type { BrainAdapter, ChatOptions, ChatResponse, Message } from './adapter';

export class ClaudeBrain implements BrainAdapter {
  private client: Anthropic;
  private model: string;

  constructor({ model = 'claude-sonnet-4-6' }: { model?: string } = {}) {
    this.client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
    this.model = model;
  }

  async chat(messages: Message[], opts: ChatOptions = {}): Promise<ChatResponse> {
    const system = messages.find((m) => m.role === 'system')?.content;
    const convo = messages.filter((m) => m.role !== 'system');

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: opts.maxTokens ?? 8096,
      system: system
        ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
        : undefined,
      messages: convo.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
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
      toolCalls: toolBlocks.map((b) => {
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
    const system = messages.find((m) => m.role === 'system')?.content;
    const convo = messages.filter((m) => m.role !== 'system');

    const stream = await this.client.messages.stream({
      model: this.model,
      max_tokens: opts.maxTokens ?? 8096,
      system: system
        ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
        : undefined,
      messages: convo.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    });

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
```

---

## GPT-4o adapter

```typescript
// src/core/brain/openai.ts
import OpenAI from 'openai';
import type { BrainAdapter, ChatOptions, ChatResponse, Message } from './adapter';

export class OpenAIBrain implements BrainAdapter {
  private client: OpenAI;
  private model: string;

  constructor({ model = 'gpt-4o' }: { model?: string } = {}) {
    this.client = new OpenAI(); // reads OPENAI_API_KEY from env
    this.model = model;
  }

  async chat(messages: Message[], opts: ChatOptions = {}): Promise<ChatResponse> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: opts.maxTokens ?? 8096,
      messages: messages.map((m) => ({ role: m.role, content: m.content })) as OpenAI.Chat.ChatCompletionMessageParam[],
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
      messages: messages.map((m) => ({ role: m.role, content: m.content })) as OpenAI.Chat.ChatCompletionMessageParam[],
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield delta;
    }
  }
}
```

---

## Gemini adapter

```typescript
// src/core/brain/gemini.ts
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { BrainAdapter, ChatOptions, ChatResponse, Message } from './adapter';

export class GeminiBrain implements BrainAdapter {
  private genAI: GoogleGenerativeAI;
  private model: string;

  constructor({ model = 'gemini-1.5-pro' }: { model?: string } = {}) {
    this.genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
    this.model = model;
  }

  async chat(messages: Message[], opts: ChatOptions = {}): Promise<ChatResponse> {
    const genModel = this.genAI.getGenerativeModel({ model: this.model });
    const history = messages
      .filter((m) => m.role !== 'system')
      .slice(0, -1)
      .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));

    const last = messages.at(-1)!;
    const chat = genModel.startChat({ history });
    const result = await chat.sendMessage(last.content);

    return { content: result.response.text() };
  }

  async *stream(messages: Message[], opts: ChatOptions = {}): AsyncGenerator<string> {
    const genModel = this.genAI.getGenerativeModel({ model: this.model });
    const history = messages
      .filter((m) => m.role !== 'system')
      .slice(0, -1)
      .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));

    const last = messages.at(-1)!;
    const chat = genModel.startChat({ history });
    const result = await chat.sendMessageStream(last.content);

    for await (const chunk of result.stream) {
      yield chunk.text();
    }
  }
}
```

---

## Ollama adapter (local)

```typescript
// src/core/brain/ollama.ts
import type { BrainAdapter, ChatOptions, ChatResponse, Message } from './adapter';

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

  async chat(messages: Message[], opts: ChatOptions = {}): Promise<ChatResponse> {
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

  async *stream(messages: Message[], opts: ChatOptions = {}): AsyncGenerator<string> {
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
      const json = JSON.parse(line) as { message: { content: string }; done: boolean };
      if (json.message?.content) yield json.message.content;
    }
  }
}
```

---

## Swapping brains at runtime

Pass the new adapter to `OpenClaw` at bootstrap. No other files change.

```typescript
// To use GPT-4o instead of Claude:
import { OpenAIBrain } from './core/brain/openai';
const brain = new OpenAIBrain({ model: 'gpt-4o' });
export const claw = new OpenClaw({ brain, memory });

// To use local Ollama:
import { OllamaBrain } from './core/brain/ollama';
const brain = new OllamaBrain({ model: 'llama3' });
export const claw = new OpenClaw({ brain, memory });
```

The `BrainAdapter.chat()` contract is intentionally stateless — all conversation
history is passed in as `messages[]` on every call, so swapping adapters mid-session
is always safe.
