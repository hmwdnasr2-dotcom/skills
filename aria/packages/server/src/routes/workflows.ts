import { Router } from 'express';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  try { return JSON.parse(readFileSync(STORE, 'utf8')); }
  catch { return []; }
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
