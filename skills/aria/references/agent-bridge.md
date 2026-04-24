# AgentBridgeConnector

The `AgentBridgeConnector` is what makes ARIA genuinely multi-agent. It lets ARIA
delegate work to external AI agents or automation pipelines and surface the results
back into the conversation seamlessly.

Supported out of the box: **n8n**, **LangChain**, **CrewAI**, **Perplexity**, and
any HTTP endpoint that follows the bridge protocol.

---

## How it works

1. Register named adapters with the connector at startup.
2. Call `claw.use(bridge)` to auto-register each adapter as a tool the brain can call.
3. When the brain emits a tool call targeting a bridge adapter, OpenClaw dispatches
   it through the connector, waits for the result, and injects it back into the
   message stream — no special handling needed in pipelines.

```
Brain emits tool_call: { name: "research", input: { query: "..." } }
         │
         ▼
AgentBridgeConnector.dispatch("research", input)
         │
         ▼
N8nAdapter.call(input) ──► n8n webhook ──► n8n workflow runs ──► returns result
         │
         ▼
OpenClaw appends tool result and re-enters brain
```

---

## Interface

```typescript
// src/core/bridge/connector.ts

export interface BridgeAdapter {
  /** Human-readable name shown to the brain as a tool. */
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema for tool parameters

  /** Execute the delegation. Returns a string result. */
  call(input: Record<string, unknown>): Promise<string>;
}

export class AgentBridgeConnector {
  private adapters = new Map<string, BridgeAdapter>();

  register(name: string, adapter: BridgeAdapter) {
    this.adapters.set(name, adapter);
  }

  async dispatch(name: string, input: Record<string, unknown>): Promise<string> {
    const adapter = this.adapters.get(name);
    if (!adapter) throw new Error(`No bridge adapter registered for: ${name}`);
    return adapter.call(input);
  }

  /** Returns tool definitions for all registered adapters (passed to BrainAdapter). */
  toToolDefinitions() {
    return Array.from(this.adapters.values()).map((a) => ({
      name: a.name,
      description: a.description,
      parameters: a.inputSchema,
    }));
  }
}
```

---

## n8n adapter

Triggers an n8n webhook workflow and returns its response payload.

```typescript
// src/core/bridge/adapters/n8n.ts
import type { BridgeAdapter } from '../connector';

export class N8nAdapter implements BridgeAdapter {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;

  constructor(private config: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    webhookUrl: string;
    secret?: string; // optional Bearer token
  }) {
    this.name = config.name;
    this.description = config.description;
    this.inputSchema = config.inputSchema;
  }

  async call(input: Record<string, unknown>): Promise<string> {
    const res = await fetch(this.config.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.secret ? { Authorization: `Bearer ${this.config.secret}` } : {}),
      },
      body: JSON.stringify(input),
    });

    if (!res.ok) throw new Error(`n8n webhook error: ${res.status} ${res.statusText}`);

    const data = await res.json();
    return typeof data === 'string' ? data : JSON.stringify(data);
  }
}
```

**Registration example:**
```typescript
bridge.register('research', new N8nAdapter({
  name: 'research',
  description: 'Delegate a web research task to an n8n workflow. Returns a summary.',
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'Research question' } },
    required: ['query'],
  },
  webhookUrl: process.env.N8N_RESEARCH_WEBHOOK_URL!,
}));
```

---

## LangChain adapter

Calls a running LangChain agent server (e.g. LangServe) via HTTP.

```typescript
// src/core/bridge/adapters/langchain.ts
import type { BridgeAdapter } from '../connector';

export class LangChainAdapter implements BridgeAdapter {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;

  constructor(private config: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    serverUrl: string;   // e.g. http://localhost:8000/chain/invoke
    apiKey?: string;
  }) {
    this.name = config.name;
    this.description = config.description;
    this.inputSchema = config.inputSchema;
  }

  async call(input: Record<string, unknown>): Promise<string> {
    const res = await fetch(`${this.config.serverUrl}/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.apiKey ? { 'X-API-Key': this.config.apiKey } : {}),
      },
      body: JSON.stringify({ input }),
    });

    if (!res.ok) throw new Error(`LangChain agent error: ${res.status}`);

    const data = await res.json() as { output: unknown };
    return typeof data.output === 'string' ? data.output : JSON.stringify(data.output);
  }
}
```

---

## CrewAI adapter

Kicks off a CrewAI task and polls for completion (CrewAI runs async by default).

```typescript
// src/core/bridge/adapters/crewai.ts
import type { BridgeAdapter } from '../connector';

export class CrewAIAdapter implements BridgeAdapter {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;

  constructor(private config: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    serverUrl: string;       // e.g. http://localhost:3001
    crewName: string;        // which crew to kick off
    pollIntervalMs?: number;
    timeoutMs?: number;
  }) {
    this.name = config.name;
    this.description = config.description;
    this.inputSchema = config.inputSchema;
  }

  async call(input: Record<string, unknown>): Promise<string> {
    // Kick off the crew
    const kickRes = await fetch(`${this.config.serverUrl}/kickoff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ crew: this.config.crewName, inputs: input }),
    });
    if (!kickRes.ok) throw new Error(`CrewAI kickoff failed: ${kickRes.status}`);
    const { taskId } = await kickRes.json() as { taskId: string };

    // Poll for result
    const interval = this.config.pollIntervalMs ?? 2000;
    const timeout = this.config.timeoutMs ?? 120_000;
    const start = Date.now();

    while (Date.now() - start < timeout) {
      await sleep(interval);
      const statusRes = await fetch(`${this.config.serverUrl}/status/${taskId}`);
      const status = await statusRes.json() as { state: string; result?: string };
      if (status.state === 'completed') return status.result ?? '';
      if (status.state === 'failed') throw new Error(`CrewAI task ${taskId} failed`);
    }

    throw new Error(`CrewAI task ${taskId} timed out`);
  }
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
```

---

## Perplexity adapter

Uses Perplexity's sonar model for grounded web search — returns a cited summary.

```typescript
// src/core/bridge/adapters/perplexity.ts
import type { BridgeAdapter } from '../connector';

export class PerplexityAdapter implements BridgeAdapter {
  name = 'web_search';
  description = 'Search the web for current information. Returns a cited summary.';
  inputSchema = {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
    },
    required: ['query'],
  };

  async call({ query }: { query: string }): Promise<string> {
    const res = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [{ role: 'user', content: query }],
      }),
    });

    if (!res.ok) throw new Error(`Perplexity API error: ${res.status}`);
    const data = await res.json() as { choices: Array<{ message: { content: string } }> };
    return data.choices[0].message.content;
  }
}
```

---

## Generic HTTP adapter

For any REST endpoint that accepts POST + JSON and returns a string or JSON response.

```typescript
// src/core/bridge/adapters/http.ts
import type { BridgeAdapter } from '../connector';

export class HttpBridgeAdapter implements BridgeAdapter {
  constructor(private config: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    url: string;
    headers?: Record<string, string>;
    /** Extract result from response JSON. Defaults to the full response as string. */
    resultPath?: string; // e.g. "data.result"
  }) {
    this.name = config.name;
    this.description = config.description;
    this.inputSchema = config.inputSchema;
  }

  name: string;
  description: string;
  inputSchema: Record<string, unknown>;

  async call(input: Record<string, unknown>): Promise<string> {
    const res = await fetch(this.config.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.config.headers },
      body: JSON.stringify(input),
    });

    if (!res.ok) throw new Error(`HTTP bridge error: ${res.status}`);
    const data = await res.json();

    if (this.config.resultPath) {
      const value = this.config.resultPath.split('.').reduce((o: unknown, k) => (o as Record<string, unknown>)?.[k], data);
      return typeof value === 'string' ? value : JSON.stringify(value);
    }

    return typeof data === 'string' ? data : JSON.stringify(data);
  }
}
```

---

## Full wiring example

```typescript
// src/core/index.ts
import { OpenClaw } from 'openclaw';
import { ClaudeBrain } from './brain/claude';
import { buildMemoryStack } from './memory';
import { AgentBridgeConnector } from './bridge/connector';
import { N8nAdapter } from './bridge/adapters/n8n';
import { PerplexityAdapter } from './bridge/adapters/perplexity';
import { CrewAIAdapter } from './bridge/adapters/crewai';

const brain = new ClaudeBrain();
const memory = buildMemoryStack();
const bridge = new AgentBridgeConnector();

bridge.register('research', new N8nAdapter({
  name: 'research',
  description: 'Run a deep research workflow via n8n.',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  webhookUrl: process.env.N8N_RESEARCH_URL!,
}));

bridge.register('web_search', new PerplexityAdapter());

bridge.register('data_analysis', new CrewAIAdapter({
  name: 'data_analysis',
  description: 'Delegate data analysis to a CrewAI team.',
  inputSchema: { type: 'object', properties: { dataset_url: { type: 'string' }, question: { type: 'string' } }, required: ['dataset_url', 'question'] },
  serverUrl: process.env.CREWAI_SERVER_URL!,
  crewName: 'data-analysts',
}));

export const claw = new OpenClaw({ brain, memory });
claw.use(bridge); // registers all adapters as brain-callable tools
```
