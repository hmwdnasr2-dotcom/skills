---
name: aria
description: >
  Build ARIA (Autonomous Relationship & Intelligence Assistant) — a proactive
  conversational AI system with OpenClaw orchestration, pluggable BrainAdapter
  (Claude Sonnet default, swappable to GPT-4o / Gemini / Ollama), 3-layer memory
  (working / Supabase short-term / pgvector long-term), command-log UI aesthetic,
  and AgentBridgeConnector for delegating work to n8n, LangChain, CrewAI, or
  Perplexity agents. Use this skill whenever the user wants to: build a new ARIA
  instance from scratch; add or swap a brain provider; implement or extend memory
  layers; wire up an agent bridge; customise proactive surfacing logic (morning
  briefings, follow-up nudges); or style the command-log UI.
license: Complete terms in LICENSE.txt
---

# ARIA — Autonomous Relationship & Intelligence Assistant

ARIA is an opinionated, full-stack architecture for building proactive conversational
AI. Its four design pillars are:

1. **OpenClaw** — orchestration backbone; owns all pipelines, tool routing, and
   the memory lifecycle.
2. **BrainAdapter** — swappable interface; Claude Sonnet is the default, but any
   provider (GPT-4o, Gemini, Ollama) slots in without touching logic.
3. **3-layer memory** — working (in-context), short-term (Supabase rows), long-term
   (pgvector embeddings).
4. **AgentBridgeConnector** — lets ARIA delegate work to other AI agents (n8n,
   LangChain, CrewAI, Perplexity, custom HTTP) and surface results back in-conversation.

ARIA also has an explicit **anti-Telegram-bot design philosophy**:
- No bubble chat UI — render a command-log aesthetic instead.
- No sidebar navigation — everything lives inside the conversation.
- The agent surfaces tasks *proactively* (morning briefings, follow-up nudges)
  without being asked.

---

## Architecture

```
User input
    │
    ▼
┌─────────────────────────────────────────────┐
│               OpenClaw Core                  │
│                                              │
│  Pipeline router  ──►  BrainAdapter          │
│       │               (Claude / GPT / ...)   │
│       │                                      │
│  ┌────▼──────────────────────────────────┐   │
│  │          3-Layer Memory               │   │
│  │  Working (ctx) │ Short (Supabase)     │   │
│  │                │ Long  (pgvector)     │   │
│  └───────────────────────────────────────┘   │
│                                              │
│  AgentBridgeConnector                        │
│  (n8n · LangChain · CrewAI · Perplexity)     │
└─────────────────────────────────────────────┘
    │
    ▼
Command-Log UI  (no bubble chat, no sidebar)
```

---

## Project layout

```
aria/
├── src/
│   ├── core/
│   │   ├── openclaw.ts          # Bootstrap & pipeline registry
│   │   ├── brain/
│   │   │   ├── adapter.ts       # BrainAdapter interface
│   │   │   ├── claude.ts        # Default: Claude Sonnet via Anthropic SDK
│   │   │   ├── openai.ts        # GPT-4o adapter
│   │   │   ├── gemini.ts        # Gemini adapter
│   │   │   └── ollama.ts        # Local Ollama adapter
│   │   ├── memory/
│   │   │   ├── working.ts       # In-context sliding window
│   │   │   ├── shortTerm.ts     # Supabase-backed recent interactions
│   │   │   └── longTerm.ts      # pgvector semantic store
│   │   └── bridge/
│   │       └── connector.ts     # AgentBridgeConnector
│   ├── proactive/
│   │   ├── scheduler.ts         # Cron-driven briefing dispatch
│   │   └── nudger.ts            # Follow-up nudge logic
│   └── ui/
│       └── CommandLog.tsx       # Command-log React component
├── supabase/
│   └── migrations/              # Memory tables + pgvector extension
├── .env.example
└── package.json
```

---

## Quick start

### 1. Install dependencies

```bash
npm install openclaw @anthropic-ai/sdk @supabase/supabase-js
# pgvector is a Postgres extension; enable it in your Supabase project
```

### 2. Bootstrap OpenClaw with a brain and memory stack

```typescript
import { OpenClaw } from 'openclaw';
import { ClaudeBrain } from './core/brain/claude';
import { buildMemoryStack } from './core/memory';

const brain = new ClaudeBrain({ model: 'claude-sonnet-4-6' });
const memory = buildMemoryStack(); // working + shortTerm + longTerm

export const claw = new OpenClaw({ brain, memory });
```

### 3. Register pipelines

```typescript
claw.pipeline('chat', async (ctx) => {
  await ctx.memory.load(ctx.userId);
  const reply = await ctx.brain.chat(ctx.messages);
  await ctx.memory.save(ctx.userId, ctx.messages, reply);
  return reply;
});

claw.pipeline('morning-briefing', async (ctx) => {
  // See references/ui-patterns.md → Proactive Surfacing
});
```

### 4. Wire up AgentBridgeConnector

```typescript
import { AgentBridgeConnector } from './core/bridge/connector';
import { N8nAdapter } from './core/bridge/adapters/n8n';

const bridge = new AgentBridgeConnector();
bridge.register('research', new N8nAdapter({ webhookUrl: process.env.N8N_RESEARCH_URL }));

claw.use(bridge); // tools become available to the brain automatically
```

### 5. Render the UI

```tsx
import { CommandLog } from './ui/CommandLog';
// Mount it as your entire page — no sidebars, no nav chrome
<CommandLog userId={userId} claw={claw} />
```

---

## Reference files

Read the relevant file(s) before implementing each subsystem:

| Subsystem | File |
|---|---|
| OpenClaw pipelines, tool routing, lifecycle hooks | `references/openclaw.md` |
| BrainAdapter interface + all 4 provider implementations | `references/brain-adapter.md` |
| 3-layer memory: working / Supabase / pgvector | `references/memory-layers.md` |
| AgentBridgeConnector: protocol + built-in adapters | `references/agent-bridge.md` |
| Command-log UI + proactive surfacing patterns | `references/ui-patterns.md` |

---

## Key constraints

- **Never instantiate a brain inside a per-request path.** Create the adapter once
  at startup and reuse it; provider SDKs are expensive to initialise.
- **Never store raw API keys in the Supabase memory tables.** Use Supabase Vault or
  environment variables; memory rows are user-readable in some configurations.
- **Keep OpenClaw as the single owner of the memory write path.** Do not write to
  Supabase or pgvector directly from pipelines — use `ctx.memory.save()` so the
  lifecycle hooks (deduplication, TTL) run correctly.
- **BrainAdapter.chat() must be stateless.** All state lives in the memory stack,
  not inside the adapter. This is what makes brain swapping safe.
