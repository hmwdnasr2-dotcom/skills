import { Router } from 'express';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentBridgeConnector, HttpBridgeAdapter, N8nAdapter } from '@aria/core';
import { claw } from '../core/index.js';

export const agentsRouter = Router();

const STORE = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../.agents.json');

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AgentRecord {
  id:           string;
  name:         string;
  icon:         string;
  color:        string;
  description:  string;
  // Persona agents (built-in modes)
  mode?:        string;
  // External HTTP agents
  agentType?:   'http' | 'n8n' | 'crewai';
  webhookUrl?:  string;
  apiKey?:      string;
  inputFields?: Array<{ name: string; description: string; type: string }>;
  isBuiltIn:    boolean;
  userId?:      string;
  createdAt:    string;
}

// ── Built-in functional agents (domain-specialised) ───────────────────────────

export const BUILT_IN_AGENTS: AgentRecord[] = [
  {
    id:          'chief-of-staff',
    name:        'Chief of Staff',
    icon:        'hub',
    color:       'from-indigo-500 to-blue-500',
    description: 'Full ARIA — manages your tasks, inbox, ideas, projects, and anything else you throw at it.',
    mode:        'aria',
    isBuiltIn:   true,
    createdAt:   '2025-01-01T00:00:00Z',
  },
  {
    id:          'email-manager',
    name:        'Email Manager',
    icon:        'mail',
    color:       'from-red-500 to-pink-500',
    description: 'Reads your inbox, triages emails by urgency, drafts and sends replies. Ask it "what do I need to reply to today?"',
    mode:        'email',
    isBuiltIn:   true,
    createdAt:   '2025-01-01T00:00:00Z',
  },
  {
    id:          'researcher',
    name:        'Researcher',
    icon:        'travel_explore',
    color:       'from-cyan-500 to-teal-500',
    description: 'Searches before answering. Synthesises multiple sources. Rates confidence. Use for market research, fact-checking, or exploring topics.',
    mode:        'researcher',
    isBuiltIn:   true,
    createdAt:   '2025-01-01T00:00:00Z',
  },
  {
    id:          'document-studio',
    name:        'Document Studio',
    icon:        'description',
    color:       'from-green-500 to-emerald-500',
    description: 'Analyses uploaded files (PDF, Excel, CSV, Word), extracts key insights, and creates formatted reports. Attach a file to get started.',
    mode:        'document',
    isBuiltIn:   true,
    createdAt:   '2025-01-01T00:00:00Z',
  },
  {
    id:          'strategist',
    name:        'Strategist',
    icon:        'psychology',
    color:       'from-violet-500 to-purple-500',
    description: 'First-principles thinking, second-order effects, pre-mortems. Always ends with a clear decision — never just a list of options.',
    mode:        'strategist',
    isBuiltIn:   true,
    createdAt:   '2025-01-01T00:00:00Z',
  },
  {
    id:          'developer',
    name:        'Developer',
    icon:        'code',
    color:       'from-orange-500 to-amber-500',
    description: 'Senior engineer mode. Working code, architecture decisions, security review. Searches for latest APIs before answering.',
    mode:        'developer',
    isBuiltIn:   true,
    createdAt:   '2025-01-01T00:00:00Z',
  },
  {
    id:          'coach',
    name:        'Coach',
    icon:        'fitness_center',
    color:       'from-rose-500 to-red-500',
    description: 'Direct and sharp. Asks the uncomfortable question. Names the real obstacle. Ends every response with one action to take today.',
    mode:        'coach',
    isBuiltIn:   true,
    createdAt:   '2025-01-01T00:00:00Z',
  },
];

// ── External agent catalog (pre-built templates) ──────────────────────────────

export const AGENT_CATALOG = [
  {
    id:          'n8n-research',
    name:        'n8n Research',
    icon:        'account_tree',
    color:       'from-slate-500 to-slate-600',
    description: 'Delegate research tasks to an n8n workflow. The workflow fetches sources, summarises, and returns results to ARIA.',
    agentType:   'n8n',
    configFields: [
      { key: 'webhookUrl', label: 'n8n Webhook URL', placeholder: 'https://your-n8n.com/webhook/...', type: 'url' },
    ],
    envHint: 'N8N_RESEARCH_WEBHOOK_URL',
  },
  {
    id:          'http-webhook',
    name:        'Custom Webhook',
    icon:        'webhook',
    color:       'from-slate-500 to-slate-600',
    description: 'Connect any HTTP endpoint as an ARIA tool. ARIA can call it with inputs you define, and use the response.',
    agentType:   'http',
    configFields: [
      { key: 'webhookUrl', label: 'Endpoint URL', placeholder: 'https://your-api.com/endpoint', type: 'url' },
      { key: 'apiKey',     label: 'API Key (optional)', placeholder: 'Bearer token or API key', type: 'text' },
    ],
  },
  {
    id:          'zapier',
    name:        'Zapier',
    icon:        'bolt',
    color:       'from-orange-500 to-yellow-500',
    description: 'Trigger any Zapier automation from ARIA. Create a Zapier Webhook trigger and paste the URL here.',
    agentType:   'http',
    configFields: [
      { key: 'webhookUrl', label: 'Zapier Webhook URL', placeholder: 'https://hooks.zapier.com/hooks/catch/...', type: 'url' },
    ],
  },
  {
    id:          'make',
    name:        'Make (Integromat)',
    icon:        'settings_ethernet',
    color:       'from-purple-500 to-violet-500',
    description: 'Trigger any Make scenario from ARIA. Use a Make Webhook module as your trigger.',
    agentType:   'http',
    configFields: [
      { key: 'webhookUrl', label: 'Make Webhook URL', placeholder: 'https://hook.eu1.make.com/...', type: 'url' },
    ],
  },
];

// ── Store helpers ─────────────────────────────────────────────────────────────

function loadCustomAgents(): AgentRecord[] {
  try { return JSON.parse(readFileSync(STORE, 'utf8')); }
  catch { return []; }
}

function saveCustomAgents(list: AgentRecord[]): void {
  writeFileSync(STORE, JSON.stringify(list, null, 2));
}

// ── Register external agent as a live ARIA tool ───────────────────────────────

function registerExternalAgent(agent: AgentRecord): void {
  if (!agent.webhookUrl) return;
  try {
    const bridge = new AgentBridgeConnector();
    const toolName = `ext_${agent.id.replace(/[^a-z0-9]/gi, '_')}`;

    if (agent.agentType === 'n8n') {
      bridge.register(toolName, new N8nAdapter({
        name:        toolName,
        description: agent.description,
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string', description: 'Task or query to send to this agent.' } },
          required:   ['query'],
        },
        webhookUrl: agent.webhookUrl,
      }));
    } else {
      bridge.register(toolName, new HttpBridgeAdapter({
        name:        toolName,
        description: agent.description,
        inputSchema: {
          type: 'object',
          properties: { input: { type: 'string', description: 'Input to send to this agent.' } },
          required:   ['input'],
        },
        url:     agent.webhookUrl,
        headers: agent.apiKey ? { 'Authorization': `Bearer ${agent.apiKey}` } : {},
      }));
    }
    claw.use(bridge);
    console.log(`[agents] External agent registered as tool: ${toolName}`);
  } catch (err) {
    console.error(`[agents] Failed to register external agent "${agent.name}":`, (err as Error).message);
  }
}

// Boot: register persisted external agents
for (const a of loadCustomAgents()) {
  if (a.agentType && a.webhookUrl) registerExternalAgent(a);
}

// ── GET /api/aria/agents ──────────────────────────────────────────────────────

agentsRouter.get('/', (_req, res) => {
  const custom = loadCustomAgents();
  res.json({ builtin: BUILT_IN_AGENTS, custom, catalog: AGENT_CATALOG });
});

// ── POST /api/aria/agents — create custom/external agent ─────────────────────

agentsRouter.post('/', (req, res) => {
  const {
    name, icon = 'smart_toy', color = 'from-slate-500 to-slate-600',
    description, agentType, webhookUrl, apiKey,
    userId = 'user-1',
  } = req.body as Record<string, string | undefined>;

  if (!name?.trim()) { res.status(400).json({ error: 'name required' }); return; }

  const id = `custom-${Date.now()}`;
  const record: AgentRecord = {
    id, name: name.trim(), icon, color,
    description: description?.trim() ?? '',
    agentType: agentType as AgentRecord['agentType'],
    webhookUrl: webhookUrl?.trim(),
    apiKey:     apiKey?.trim(),
    isBuiltIn:  false,
    userId,
    createdAt:  new Date().toISOString(),
  };

  const list = loadCustomAgents();
  list.push(record);
  saveCustomAgents(list);

  // Register as live ARIA tool immediately
  if (record.agentType && record.webhookUrl) registerExternalAgent(record);

  res.json({ ok: true, agent: record });
});

// ── DELETE /api/aria/agents/:id ───────────────────────────────────────────────

agentsRouter.delete('/:id', (req, res) => {
  const list    = loadCustomAgents();
  const updated = list.filter(a => a.id !== req.params.id);
  saveCustomAgents(updated);
  res.json({ ok: true });
});
