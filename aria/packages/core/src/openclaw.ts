import { EventEmitter } from 'node:events';
import type { BrainAdapter, Message, ToolDefinition } from './brain/adapter.js';
import type { AgentBridgeConnector } from './bridge/connector.js';
import type { MemoryStack } from './memory/index.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PipelineContext {
  userId: string;
  messages: Message[];
  memory: MemoryStack;
  brain: BrainAdapter;
  tools: ToolRegistry;
  meta: Record<string, unknown>;
  run(pipeline: string, overrides?: Partial<PipelineContext>): Promise<string>;
}

export type PipelineHandler = (ctx: PipelineContext) => Promise<string>;
export type ToolHandler = (input: Record<string, unknown>) => Promise<unknown>;

export interface Middleware {
  before?: (ctx: PipelineContext) => Promise<void>;
  after?: (ctx: PipelineContext, result: string) => Promise<void>;
}

export interface OpenClawOptions {
  brain: BrainAdapter;
  memory: MemoryStack;
  middleware?: Middleware[];
  maxToolIterations?: number;
  timeout?: number;
}

export interface PipelineOptions {
  middleware?: Middleware[];
}

export class PipelineError extends Error {
  constructor(
    public readonly pipeline: string,
    public readonly userId: string,
    public readonly cause: unknown,
  ) {
    super(`Pipeline "${pipeline}" failed for user "${userId}"`);
    this.name = 'PipelineError';
  }
}

// ─── ToolRegistry ─────────────────────────────────────────────────────────────

export class ToolRegistry {
  private handlers = new Map<string, ToolHandler>();
  private definitions: ToolDefinition[] = [];

  register(name: string, handler: ToolHandler, definition: ToolDefinition) {
    this.handlers.set(name, handler);
    this.definitions.push(definition);
  }

  async dispatch(name: string, input: Record<string, unknown>): Promise<unknown> {
    const handler = this.handlers.get(name);
    if (!handler) throw new Error(`No tool handler registered for: ${name}`);
    return handler(input);
  }

  getDefinitions(): ToolDefinition[] {
    return [...this.definitions];
  }

  has(name: string): boolean {
    return this.handlers.has(name);
  }
}

// ─── OpenClaw ─────────────────────────────────────────────────────────────────

export class OpenClaw {
  private pipelines = new Map<string, { handler: PipelineHandler; opts: PipelineOptions }>();
  private tools = new ToolRegistry();
  private globalMiddleware: Middleware[];
  private emitter = new EventEmitter();
  private brain: BrainAdapter;
  private memory: MemoryStack;
  private maxToolIterations: number;
  private timeoutMs: number;

  constructor(options: OpenClawOptions) {
    this.brain = options.brain;
    this.memory = options.memory;
    this.globalMiddleware = options.middleware ?? [];
    this.maxToolIterations = options.maxToolIterations ?? 10;
    this.timeoutMs = options.timeout ?? 60_000;
  }

  pipeline(name: string, handler: PipelineHandler, opts: PipelineOptions = {}) {
    this.pipelines.set(name, { handler, opts });
  }

  tool(
    name: string,
    handler: ToolHandler,
    definition: Omit<ToolDefinition, 'name'> & { name?: string },
  ) {
    this.tools.register(name, handler, { name, ...definition } as ToolDefinition);
  }

  use(bridge: AgentBridgeConnector) {
    for (const def of bridge.toToolDefinitions()) {
      this.tools.register(
        def.name,
        (input) => bridge.dispatch(def.name, input),
        def,
      );
    }
  }

  on(event: string, handler: (...args: unknown[]) => void) {
    this.emitter.on(event, handler);
  }

  async run(
    pipelineName: string,
    input: { userId: string; messages: Message[]; meta?: Record<string, unknown> },
  ): Promise<string> {
    const entry = this.pipelines.get(pipelineName);
    if (!entry) throw new Error(`No pipeline registered: "${pipelineName}"`);

    const middleware = [...this.globalMiddleware, ...(entry.opts.middleware ?? [])];

    const ctx = this.buildContext(input, pipelineName);

    for (const m of middleware) await m.before?.(ctx);

    let result: string;
    try {
      result = await Promise.race([
        entry.handler(ctx),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Pipeline "${pipelineName}" timed out`)), this.timeoutMs),
        ),
      ]);
    } catch (err) {
      throw new PipelineError(pipelineName, input.userId, err);
    }

    for (const m of middleware) await m.after?.(ctx, result);
    return result;
  }

  async *stream(
    pipelineName: string,
    input: { userId: string; message: string; meta?: Record<string, unknown> },
  ): AsyncGenerator<string> {
    const messages: Message[] = [{ role: 'user', content: input.message }];
    await this.memory.load(input.userId);
    const history = this.memory.working.get();

    const allMessages = [...history, ...messages];

    let iteration = 0;
    let currentMessages = allMessages;

    while (iteration < this.maxToolIterations) {
      const toolDefs = this.tools.getDefinitions();
      let accumulated = '';

      for await (const token of this.brain.stream(currentMessages, { tools: toolDefs })) {
        accumulated += token;
        yield token;
      }

      // If a full response with no tool call, we are done
      const toolCallMatch = /\[\[TOOL:([^\]]+)\]\]/.exec(accumulated);
      if (!toolCallMatch) break;

      // Streaming tool-call handling is provider-specific; for now break after first full reply
      break;
      iteration++;
    }
  }

  /** Expose brain for direct use in pipeline handlers. */
  getBrain(): BrainAdapter {
    return this.brain;
  }

  /** Expose memory stack for direct access in special cases. */
  getMemory(): MemoryStack {
    return this.memory;
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private buildContext(
    input: { userId: string; messages: Message[]; meta?: Record<string, unknown> },
    currentPipeline: string,
  ): PipelineContext {
    const self = this;

    const ctx: PipelineContext = {
      userId: input.userId,
      messages: [...input.messages],
      memory: this.memory,
      brain: this.brain,
      tools: this.tools,
      meta: input.meta ?? {},

      async run(pipeline: string, overrides: Partial<PipelineContext> = {}) {
        return self.run(pipeline, {
          userId: overrides.userId ?? input.userId,
          messages: overrides.messages ?? ctx.messages,
          meta: { ...ctx.meta, ...overrides.meta },
        });
      },
    };

    // Wire tool-call loop into brain.chat via a proxy
    ctx.brain = this.buildBrainProxy(ctx);

    return ctx;
  }

  private buildBrainProxy(ctx: PipelineContext): BrainAdapter {
    const self = this;
    const underlying = this.brain;

    return {
      async chat(messages, opts = {}) {
        const toolDefs = [
          ...(opts.tools ?? []),
          ...self.tools.getDefinitions(),
        ];

        let currentMessages = messages;
        let iterations = 0;

        while (iterations < self.maxToolIterations) {
          const response = await underlying.chat(currentMessages, { ...opts, tools: toolDefs });

          if (!response.toolCalls?.length) return response;

          // Dispatch each tool call and collect results
          const toolResults: Message[] = [];
          for (const tc of response.toolCalls) {
            self.emitter.emit('tool:before', { name: tc.name, input: tc.input });
            let resultContent: string;
            try {
              const raw = await ctx.tools.dispatch(tc.name, tc.input);
              resultContent = typeof raw === 'string' ? raw : JSON.stringify(raw);
            } catch (err) {
              resultContent = `Error: ${(err as Error).message}`;
            }
            self.emitter.emit('tool:after', { name: tc.name, result: resultContent });

            toolResults.push({
              role: 'tool',
              content: resultContent,
              toolCallId: tc.id,
            });
          }

          currentMessages = [
            ...currentMessages,
            { role: 'assistant', content: response.content, _rawContent: response._rawContent },
            ...toolResults,
          ];
          iterations++;
        }

        throw new Error('Max tool iterations reached');
      },

      stream: underlying.stream.bind(underlying),
    };
  }
}
