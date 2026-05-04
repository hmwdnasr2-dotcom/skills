import { Router } from 'express';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { claw } from '../core/index.js';
import { registerDynamicWorkflow, unregisterDynamicWorkflow } from '../proactive/scheduler.js';

export const workflowsRouter = Router();

const STORE = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../.workflows.json');

// ── Data model ────────────────────────────────────────────────────────────────

export interface WorkflowTrigger {
  type: 'schedule' | 'email_received' | 'manual';
  cronExpr?:     string;  // schedule
  fromFilter?:   string;  // email_received: match sender address/domain
  subjectFilter?: string; // email_received: keyword in subject
}

export interface WorkflowAction {
  type: 'telegram_notify' | 'aria_prompt';
  template?: string; // telegram_notify: text with {from} {subject} {snippet}
  prompt?:   string; // aria_prompt: message sent to ARIA
}

export interface WorkflowRecord {
  id:          string;
  name:        string;
  description: string;
  icon:        string;
  trigger:     WorkflowTrigger;
  actions:     WorkflowAction[];
  userId:      string;
  enabled:     boolean;
  createdAt:   string;
  lastRunAt?:  string;
  lastRunStatus?: 'ok' | 'error';
  lastRunResult?: string;
}

export function loadWorkflows(): WorkflowRecord[] {
  try {
    const raw = JSON.parse(readFileSync(STORE, 'utf8')) as Record<string, unknown>[];
    // Migrate old template-based format (cronExpr/prompt at top level) to new format
    return raw.map((w) => {
      if (w['trigger']) return w as unknown as WorkflowRecord;
      return {
        id:          w['id'],
        name:        w['name'] ?? 'Migrated workflow',
        description: w['description'] ?? '',
        icon:        w['icon'] ?? 'schedule',
        trigger:     { type: 'schedule', cronExpr: w['cronExpr'] as string ?? '0 9 * * *' },
        actions:     [{ type: 'aria_prompt', prompt: w['prompt'] as string ?? '' }],
        userId:      w['userId'] ?? 'user-1',
        enabled:     w['enabled'] ?? true,
        createdAt:   w['createdAt'] ?? new Date().toISOString(),
      } as WorkflowRecord;
    });
  } catch { return []; }
}

export function saveWorkflows(list: WorkflowRecord[]): void {
  writeFileSync(STORE, JSON.stringify(list, null, 2));
}

export function patchWorkflow(id: string, patch: Partial<WorkflowRecord>): void {
  const list = loadWorkflows();
  const idx  = list.findIndex(w => w.id === id);
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...patch };
    saveWorkflows(list);
  }
}

// ── GET /api/aria/workflows ───────────────────────────────────────────────────

workflowsRouter.get('/', (req, res) => {
  const userId = (req.query.userId as string) || 'user-1';
  const list   = loadWorkflows().filter(w => w.userId === userId);
  res.json({ workflows: list });
});

// ── POST /api/aria/workflows — create workflow ────────────────────────────────

workflowsRouter.post('/', async (req, res) => {
  const {
    name, description, icon = 'device_hub',
    trigger, actions,
    userId = 'user-1',
  } = req.body as {
    name?: string;
    description?: string;
    icon?: string;
    trigger?: WorkflowTrigger;
    actions?: WorkflowAction[];
    userId?: string;
  };

  if (!name?.trim() || !trigger || !actions?.length) {
    res.status(400).json({ error: 'name, trigger, and at least one action required' }); return;
  }

  if (trigger.type === 'schedule' && !trigger.cronExpr) {
    res.status(400).json({ error: 'cronExpr required for schedule trigger' }); return;
  }

  const record: WorkflowRecord = {
    id:          `wf-${Date.now()}`,
    name:        name.trim(),
    description: description?.trim() ?? '',
    icon,
    trigger,
    actions,
    userId,
    enabled:     true,
    createdAt:   new Date().toISOString(),
  };

  const list = loadWorkflows();
  list.push(record);
  saveWorkflows(list);

  if (trigger.type === 'schedule') registerDynamicWorkflow(record);

  res.json({ ok: true, workflow: record });
});

// ── PATCH /api/aria/workflows/:id — toggle enabled ───────────────────────────

workflowsRouter.patch('/:id', (req, res) => {
  const { enabled } = req.body as { enabled?: boolean };
  const list = loadWorkflows();
  const idx  = list.findIndex(w => w.id === req.params.id);
  if (idx < 0) { res.status(404).json({ error: 'Not found' }); return; }

  list[idx].enabled = enabled ?? !list[idx].enabled;
  saveWorkflows(list);

  if (list[idx].trigger.type === 'schedule') {
    if (list[idx].enabled) registerDynamicWorkflow(list[idx]);
    else unregisterDynamicWorkflow(req.params.id);
  }

  res.json({ ok: true, workflow: list[idx] });
});

// ── POST /api/aria/workflows/:id/run — manual trigger ────────────────────────

// ── POST /api/aria/workflows/parse — AI parses plain-language description ─────

workflowsRouter.post('/parse', async (req, res) => {
  const { description, userId = 'user-1' } = req.body as { description?: string; userId?: string };
  if (!description?.trim()) { res.status(400).json({ error: 'description required' }); return; }

  const systemPrompt = `You convert workflow descriptions into structured JSON. Reply ONLY with raw valid JSON — no markdown, no explanation, no code fences.

Output format:
{
  "name": "short friendly name",
  "humanDescription": "one plain-English sentence describing when this fires and what it does",
  "trigger": {
    "type": "schedule" | "email_received" | "manual",
    "cronExpr": "cron expression",     // only for schedule triggers
    "fromFilter": "sender@co.com",     // only for email_received, optional
    "subjectFilter": "keyword"         // only for email_received, optional
  },
  "actions": [
    { "type": "aria_prompt", "prompt": "instructions for ARIA including any email addresses or destinations" }
  ]
}

Rules:
- Always use aria_prompt as the action — it is the most capable action type.
- For time-based intents (daily, every morning, at X:XXam, Monday) → trigger.type="schedule" with correct cron expression.
- For "when I get an email" intents → trigger.type="email_received".
- For manual/on-demand intents → trigger.type="manual".
- If the user wants results sent to their email address: include the exact email in the aria_prompt field, e.g. "...then send the results to user@example.com using gmail_send".
- If the user mentions Telegram/notify: append "and send me a Telegram notification" to the prompt.
- Extract the email address from the description if present and put it in the prompt.
- Write the aria_prompt as a clear imperative instruction to ARIA. Include all relevant context (what to fetch, what to send, where to send it).`;

  try {
    const result = await claw.run('json', {
      userId,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: description },
      ],
    });
    const cleaned = result.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const json = JSON.parse(cleaned);
    res.json({ ok: true, parsed: json });
  } catch (err) {
    console.error('[workflows/parse] error:', (err as Error).message);
    res.status(422).json({ error: 'Could not parse — try rephrasing', detail: (err as Error).message });
  }
});

// ── POST /api/aria/workflows/:id/run — manual trigger ────────────────────────

workflowsRouter.post('/:id/run', async (req, res) => {
  const wf = loadWorkflows().find(w => w.id === req.params.id);
  if (!wf) { res.status(404).json({ error: 'Not found' }); return; }
  try {
    const { executeWorkflow } = await import('../proactive/workflow-engine.js');
    await executeWorkflow(wf, {});
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// ── DELETE /api/aria/workflows/:id ───────────────────────────────────────────

workflowsRouter.delete('/:id', (req, res) => {
  const list    = loadWorkflows();
  const updated = list.filter(w => w.id !== req.params.id);
  saveWorkflows(updated);
  unregisterDynamicWorkflow(req.params.id);
  res.json({ ok: true });
});
