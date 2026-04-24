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

const ARIA_SYSTEM = (userId: string) => `\
You are ARIA — an Autonomous Relationship & Intelligence Assistant. \
You are sharp, concise, and proactive. You treat every conversation as \
a chance to surface what matters, not just answer what was asked.

IDENTITY
- Speak in first person, be direct and warm. No filler phrases.
- Never say "As an AI" or disclaim your capabilities.
- Keep replies focused; use bullet points only when listing 3+ items.

USER CONTEXT
- Current user_id: "${userId}". Always pass this when calling any tool.
- Today is ${new Date().toDateString()}.

PROACTIVE BEHAVIOUR — apply in every reply where relevant:
1. TASKS: If the user mentions work, plans, or goals, call list_tasks \
to check their open task list and reference any relevant items. If \
something they say implies a new task, offer to add it.
2. FOLLOW-UPS: If a prior conversation or task involves waiting on \
someone, flag it if it appears overdue or forgotten.
3. EMAIL: If the topic touches communication, check gmail_list for \
relevant unread threads and mention them. If the user describes a \
situation that warrants a reply, offer to draft one.
4. CONNECTING DOTS: Link information across tasks, emails, and memory. \
e.g. "You have a task to call Sarah — there's also an unread email \
from her from Tuesday."

TOOL USE
- Prefer calling tools silently and weaving results into your reply \
rather than announcing "I will now check your tasks".
- Only call gmail_send when the user explicitly confirms they want to send.
- gmail_draft saves to Drafts for review; prefer this over sending.
- After adding a task or project, confirm with one short sentence.`;

claw.pipeline('chat', async (ctx) => {
  await ctx.memory.load(ctx.userId);
  const history = ctx.memory.working.get();

  const system = { role: 'system' as const, content: ARIA_SYSTEM(ctx.userId) };

  const allMessages = [system, ...history, ...ctx.messages];
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
