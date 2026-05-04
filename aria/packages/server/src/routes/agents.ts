import { Router } from 'express';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const agentsRouter = Router();

const STORE = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../.agents.json');

export interface AgentRecord {
  id:          string;
  name:        string;
  icon:        string;
  color:       string;
  description: string;
  mode:        string;
  customPrompt?: string;
  isBuiltIn:   boolean;
  userId?:     string;
  createdAt:   string;
}

export const BUILT_IN_AGENTS: AgentRecord[] = [
  {
    id:          'aria',
    name:        'Chief of Staff',
    icon:        'hub',
    color:       'from-indigo-500 to-blue-500',
    description: 'Full ARIA — task management, email, research, ideas, and general intelligence in one.',
    mode:        'aria',
    isBuiltIn:   true,
    createdAt:   '2025-01-01T00:00:00Z',
  },
  {
    id:          'researcher',
    name:        'Researcher',
    icon:        'search',
    color:       'from-cyan-500 to-teal-500',
    description: 'Searches before answering. Synthesises multiple angles. Rates confidence. Great for fact-checking or exploring topics.',
    mode:        'researcher',
    isBuiltIn:   true,
    createdAt:   '2025-01-01T00:00:00Z',
  },
  {
    id:          'strategist',
    name:        'Strategist',
    icon:        'psychology',
    color:       'from-violet-500 to-purple-500',
    description: 'First-principles thinking, second-order effects, pre-mortems. Ends with a clear decision — not a list of options.',
    mode:        'strategist',
    isBuiltIn:   true,
    createdAt:   '2025-01-01T00:00:00Z',
  },
  {
    id:          'developer',
    name:        'Developer',
    icon:        'code',
    color:       'from-green-500 to-emerald-500',
    description: 'Senior engineer mode. Gives working code, explains architecture decisions, flags security issues and edge cases.',
    mode:        'developer',
    isBuiltIn:   true,
    createdAt:   '2025-01-01T00:00:00Z',
  },
  {
    id:          'coach',
    name:        'Coach',
    icon:        'fitness_center',
    color:       'from-orange-500 to-amber-500',
    description: 'Direct and sharp. Asks the uncomfortable question. Names the real obstacle. Ends every response with one action to take today.',
    mode:        'coach',
    isBuiltIn:   true,
    createdAt:   '2025-01-01T00:00:00Z',
  },
];

function loadCustomAgents(): AgentRecord[] {
  try { return JSON.parse(readFileSync(STORE, 'utf8')); }
  catch { return []; }
}

function saveCustomAgents(list: AgentRecord[]): void {
  writeFileSync(STORE, JSON.stringify(list, null, 2));
}

// GET /api/aria/agents
agentsRouter.get('/', (_req, res) => {
  const custom = loadCustomAgents();
  res.json({ builtin: BUILT_IN_AGENTS, custom });
});

// POST /api/aria/agents — create custom agent
agentsRouter.post('/', (req, res) => {
  const { name, icon = 'smart_toy', color = 'from-slate-500 to-slate-600', description, customPrompt, userId = 'user-1' } = req.body as Record<string, string | undefined>;
  if (!name?.trim() || !customPrompt?.trim()) {
    res.status(400).json({ error: 'name and customPrompt required' }); return;
  }
  const record: AgentRecord = {
    id:           `custom-${Date.now()}`,
    name:         name.trim(),
    icon,
    color,
    description:  description?.trim() ?? '',
    mode:         `custom-${Date.now()}`,
    customPrompt: customPrompt.trim(),
    isBuiltIn:    false,
    userId,
    createdAt:    new Date().toISOString(),
  };
  const list = loadCustomAgents();
  list.push(record);
  saveCustomAgents(list);
  res.json({ ok: true, agent: record });
});

// DELETE /api/aria/agents/:id
agentsRouter.delete('/:id', (req, res) => {
  const list    = loadCustomAgents();
  const updated = list.filter(a => a.id !== req.params.id);
  saveCustomAgents(updated);
  res.json({ ok: true });
});
