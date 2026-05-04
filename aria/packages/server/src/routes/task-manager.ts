import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';

export const taskManagerRouter = Router();

function db() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
}

function guard(res: import('express').Response): boolean {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    res.status(503).json({ error: 'Supabase not configured' });
    return false;
  }
  return true;
}

// ── GET /api/aria/tasks?userId=X&status=X&projectId=X ─────────────────────────

taskManagerRouter.get('/tasks', async (req, res) => {
  if (!guard(res)) return;
  const { userId = 'user-1', status, projectId } = req.query as Record<string, string>;
  const sb = db();

  let q = sb
    .from('aria_tasks')
    .select('id, title, description, status, priority, due_date, project_id, completed_at, created_at, aria_projects(id, name)')
    .eq('user_id', userId)
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (status && status !== 'all') q = q.eq('status', status);
  if (projectId) q = q.eq('project_id', projectId);

  const { data, error } = await q;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ tasks: data ?? [] });
});

// ── POST /api/aria/tasks ──────────────────────────────────────────────────────

taskManagerRouter.post('/tasks', async (req, res) => {
  if (!guard(res)) return;
  const { userId = 'user-1', title, description, priority = 'medium', due_date, project_id } =
    req.body as { userId?: string; title?: string; description?: string; priority?: string; due_date?: string; project_id?: string };

  if (!title?.trim()) { res.status(400).json({ error: 'title required' }); return; }

  const { data, error } = await db().from('aria_tasks').insert({
    user_id:     userId,
    title:       title.trim(),
    description: description?.trim() ?? null,
    priority,
    due_date:    due_date    ?? null,
    project_id:  project_id ?? null,
    status:      'todo',
  }).select('id, title, description, status, priority, due_date, project_id, created_at').single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true, task: data });
});

// ── PATCH /api/aria/tasks/:id ─────────────────────────────────────────────────

taskManagerRouter.patch('/tasks/:id', async (req, res) => {
  if (!guard(res)) return;
  const { title, description, status, priority, due_date, project_id } =
    req.body as { title?: string; description?: string; status?: string; priority?: string; due_date?: string | null; project_id?: string | null };

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (title       !== undefined) updates.title       = title;
  if (description !== undefined) updates.description = description;
  if (status      !== undefined) {
    updates.status = status;
    if (status === 'completed') updates.completed_at = new Date().toISOString();
  }
  if (priority    !== undefined) updates.priority    = priority;
  if (due_date    !== undefined) updates.due_date    = due_date;
  if (project_id  !== undefined) updates.project_id  = project_id;

  const { data, error } = await db().from('aria_tasks').update(updates).eq('id', req.params.id)
    .select('id, title, description, status, priority, due_date, project_id, completed_at').single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true, task: data });
});

// ── DELETE /api/aria/tasks/:id ────────────────────────────────────────────────

taskManagerRouter.delete('/tasks/:id', async (req, res) => {
  if (!guard(res)) return;
  const { error } = await db().from('aria_tasks').delete().eq('id', req.params.id);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true });
});

// ── GET /api/aria/tasks/projects?userId=X ────────────────────────────────────

taskManagerRouter.get('/projects', async (req, res) => {
  if (!guard(res)) return;
  const { userId = 'user-1', status } = req.query as Record<string, string>;
  const sb = db();

  let q = sb
    .from('aria_projects')
    .select('id, name, goal, description, status, priority, end_date, outcome, created_at')
    .eq('user_id', userId)
    .order('end_date', { ascending: true, nullsFirst: false });

  if (status && status !== 'all') q = q.eq('status', status);

  const { data, error } = await q;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ projects: data ?? [] });
});

// ── POST /api/aria/tasks/projects ─────────────────────────────────────────────

taskManagerRouter.post('/projects', async (req, res) => {
  if (!guard(res)) return;
  const { userId = 'user-1', name, goal, description, priority = 'medium', end_date } =
    req.body as { userId?: string; name?: string; goal?: string; description?: string; priority?: string; end_date?: string };

  if (!name?.trim()) { res.status(400).json({ error: 'name required' }); return; }

  const { data, error } = await db().from('aria_projects').insert({
    user_id:     userId,
    name:        name.trim(),
    goal:        goal?.trim()        ?? null,
    description: description?.trim() ?? null,
    priority,
    end_date:    end_date ?? null,
    status:      'active',
  }).select('id, name, goal, description, status, priority, end_date, created_at').single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true, project: data });
});

// ── PATCH /api/aria/tasks/projects/:id ───────────────────────────────────────

taskManagerRouter.patch('/projects/:id', async (req, res) => {
  if (!guard(res)) return;
  const { name, goal, description, status, priority, end_date, outcome } =
    req.body as { name?: string; goal?: string; description?: string; status?: string; priority?: string; end_date?: string | null; outcome?: string };

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (name        !== undefined) updates.name        = name;
  if (goal        !== undefined) updates.goal        = goal;
  if (description !== undefined) updates.description = description;
  if (status      !== undefined) updates.status      = status;
  if (priority    !== undefined) updates.priority    = priority;
  if (end_date    !== undefined) updates.end_date    = end_date;
  if (outcome     !== undefined) updates.outcome     = outcome;

  const { data, error } = await db().from('aria_projects').update(updates).eq('id', req.params.id)
    .select('id, name, goal, status, priority, end_date').single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true, project: data });
});
