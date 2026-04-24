import {
  AgentBridgeConnector,
  ClaudeBrain,
  GeminiBrain,
  GroqBrain,
  N8nAdapter,
  OllamaBrain,
  OpenAIBrain,
  OpenClaw,
  PerplexityAdapter,
  buildMemoryStack,
} from '@aria/core';

// ─── Bootstrap brain based on env ──────────────────────────────────────────────

function buildBrain() {
  const provider = process.env.ARIA_BRAIN ?? 'claude';
  const model    = process.env.ARIA_MODEL;
  switch (provider) {
    case 'claude': return new ClaudeBrain(model ? { model } : {});
    case 'openai': return new OpenAIBrain(model ? { model } : {});
    case 'groq':   return new GroqBrain(model ? { model } : {});
    case 'ollama': return new OllamaBrain(model ? { model } : {});
    default:       return new GeminiBrain({ model: model ?? 'gemini-2.0-flash' });
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

const brain = buildBrain();
const memory = buildMemoryStack();
const bridge = new AgentBridgeConnector();

// ─── Bridge adapters ───────────────────────────────────────────────────────────

if (process.env.N8N_RESEARCH_WEBHOOK_URL) {
  bridge.register(
    'research',
    new N8nAdapter({
      name: 'research',
      description: 'Delegate a web research task to an n8n workflow. Returns a summary.',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Research question' } },
        required: ['query'],
      },
      webhookUrl: process.env.N8N_RESEARCH_WEBHOOK_URL,
    }),
  );
}

if (process.env.PERPLEXITY_API_KEY) {
  bridge.register('web_search', new PerplexityAdapter());
}

// ─── OpenClaw instance ────────────────────────────────────────────────────────

export const claw = new OpenClaw({ brain, memory });
claw.use(bridge);

// ─── Pipelines ────────────────────────────────────────────────────────────────

claw.pipeline('chat', async (ctx) => {
  await ctx.memory.load(ctx.userId);
  const history = ctx.memory.working.get();
  const allMessages = [...history, ...ctx.messages];

  const reply = await ctx.brain.chat(allMessages);
  await ctx.memory.save(ctx.userId, ctx.messages, reply);
  return reply.content;
});

claw.pipeline('morning-briefing', async (ctx) => {
  const reply = await ctx.brain.chat(ctx.messages);
  return reply.content;
});

claw.pipeline('nudge-check', async (ctx) => {
  const reply = await ctx.brain.chat(ctx.messages, { maxTokens: 256 });
  return reply.content;
});
