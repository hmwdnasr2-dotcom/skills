# OpenClaw — Orchestration Backbone

OpenClaw is the required orchestration layer for all ARIA instances. It owns:
- **Pipeline registry** — named, composable async pipelines
- **Tool routing** — maps brain tool-call requests to registered handlers
- **Memory lifecycle** — coordinates load/save across all three memory layers
- **Middleware** — before/after hooks for logging, auth, rate-limiting

---

## Installation

```bash
npm install openclaw
```

> If OpenClaw is not yet published to npm under that exact name, check the project's
> `package.json` for the correct registry URL and install path. The API described
> here reflects the design documented by the ARIA architecture.

---

## Bootstrap

```typescript
import { OpenClaw } from 'openclaw';
import { ClaudeBrain } from '../brain/claude';
import { buildMemoryStack } from '../memory';

const brain = new ClaudeBrain({ model: 'claude-sonnet-4-6' });
const memory = buildMemoryStack();

export const claw = new OpenClaw({
  brain,
  memory,
  // optional: global middleware
  middleware: [loggingMiddleware, rateLimitMiddleware],
});
```

`OpenClaw` constructor options:

| Option | Type | Default | Purpose |
|---|---|---|---|
| `brain` | `BrainAdapter` | required | The LLM provider |
| `memory` | `MemoryStack` | required | 3-layer memory instance |
| `middleware` | `Middleware[]` | `[]` | Global before/after hooks |
| `maxToolIterations` | `number` | `10` | Safety cap on tool-call loops |
| `timeout` | `number` (ms) | `60_000` | Per-pipeline execution timeout |

---

## Pipeline registry

Pipelines are named async functions that receive a `PipelineContext`. Register them
once at startup; invoke them by name at runtime.

```typescript
// Registration
claw.pipeline('chat', async (ctx: PipelineContext) => {
  await ctx.memory.load(ctx.userId);
  const reply = await ctx.brain.chat(ctx.messages);
  await ctx.memory.save(ctx.userId, ctx.messages, reply);
  return reply;
});

// Invocation
const reply = await claw.run('chat', {
  userId: 'user-123',
  messages: [{ role: 'user', content: 'Hello!' }],
});
```

### PipelineContext

```typescript
interface PipelineContext {
  userId: string;
  messages: Message[];
  memory: BoundMemoryStack;   // load/save scoped to this userId
  brain: BrainAdapter;        // the configured brain
  tools: ToolRegistry;        // registered tool handlers
  meta: Record<string, unknown>; // arbitrary pipeline metadata
}
```

### Composing pipelines

Call `ctx.run('other-pipeline', overrides)` to invoke a sub-pipeline from within a
pipeline. This shares the same `userId` and memory stack by default.

```typescript
claw.pipeline('research-and-reply', async (ctx) => {
  const research = await ctx.run('research', { query: ctx.messages.at(-1)?.content });
  ctx.messages.push({ role: 'tool', content: research });
  return ctx.run('chat');
});
```

---

## Tool routing

Register tool handlers with `claw.tool(name, handler)`. When the brain emits a
tool-call block, OpenClaw dispatches it to the matching handler, appends the result,
and continues the loop automatically — up to `maxToolIterations`.

```typescript
claw.tool('search_web', async (input: { query: string }) => {
  const results = await webSearch(input.query);
  return { results };
});

claw.tool('get_calendar', async (input: { userId: string; date: string }) => {
  return await fetchCalendar(input.userId, input.date);
});
```

To expose an `AgentBridgeConnector` as a tool, pass it to `claw.use(bridge)`, which
auto-registers each bridge adapter as a named tool.

---

## Middleware

Middleware runs before and after every pipeline execution. Use it for cross-cutting
concerns: auth checks, logging, request tracing, rate limits.

```typescript
import type { Middleware, PipelineContext } from 'openclaw';

const loggingMiddleware: Middleware = {
  before: async (ctx: PipelineContext) => {
    console.log(`[${ctx.userId}] pipeline start`);
  },
  after: async (ctx: PipelineContext, result: unknown) => {
    console.log(`[${ctx.userId}] pipeline end`, result);
  },
};

// Register globally at bootstrap, or per-pipeline:
claw.pipeline('chat', handler, { middleware: [authMiddleware] });
```

---

## Memory lifecycle hooks

OpenClaw fires these events around each `ctx.memory.load()` / `ctx.memory.save()`
call. Hook into them to add deduplication, TTL enforcement, or audit logging.

```typescript
claw.on('memory:before-save', async ({ userId, messages, reply }) => {
  // e.g., deduplicate or redact before writing
});

claw.on('memory:after-load', async ({ userId, context }) => {
  // e.g., log cache hit/miss metrics
});
```

---

## Error handling

Throw from any pipeline or tool handler to abort the run. OpenClaw wraps the error
in `PipelineError` with the pipeline name and userId attached.

```typescript
import { PipelineError } from 'openclaw';

try {
  await claw.run('chat', { userId, messages });
} catch (err) {
  if (err instanceof PipelineError) {
    console.error(err.pipeline, err.userId, err.cause);
  }
}
```

---

## Proactive pipeline dispatch

The scheduler in `src/proactive/scheduler.ts` calls `claw.run()` on a cron schedule
without a human message. Structure these pipelines to generate the briefing from
memory context alone — they must not wait for user input.

```typescript
// In scheduler.ts — runs at 07:00 every day per user
claw.pipeline('morning-briefing', async (ctx) => {
  await ctx.memory.load(ctx.userId);
  const briefing = await ctx.brain.chat([
    { role: 'system', content: BRIEFING_SYSTEM_PROMPT },
    { role: 'user', content: 'Generate morning briefing from memory context.' },
  ]);
  await pushToCommandLog(ctx.userId, briefing); // write to UI without user prompt
  await ctx.memory.save(ctx.userId, [], briefing);
  return briefing;
});
```
