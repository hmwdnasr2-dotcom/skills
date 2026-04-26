export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  /** Raw provider content blocks — preserved for multi-turn tool-call continuations. */
  _rawContent?: unknown[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
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
  /** Raw provider content blocks — used to reconstruct assistant messages for multi-turn tool calls. */
  _rawContent?: unknown[];
  usage?: { inputTokens: number; outputTokens: number };
}

export interface BrainAdapter {
  chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse>;
  stream(messages: Message[], options?: ChatOptions): AsyncGenerator<string>;
}
