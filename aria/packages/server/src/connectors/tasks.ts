import { createClient } from '@supabase/supabase-js';
import type { BridgeAdapter } from '@aria/core';

function db() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
}

function fmt(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function buildProjectAdapters(): BridgeAdapter[] {
  return [

    // ── Projects ──────────────────────────────────────────────────────────────

    {
      name: 'create_project',
      description:
        'Create a new project. Call when user says "create project X", ' +
        '"new project: X, goal: Y, deadline: Z", "start project X".',
      inputSchema: {
        type: 'object',
        properties: {
          user_id:     { type: 'string' },
          name:        { type: 'string', description: 'Project name' },
          goal:        { type: 'string', description: 'What success looks like (optional)' },
          description: { type: 'string', description: 'More context (optional)' },
          priority:    { type: 'string', enum: ['low', 'medium', 'high', 'urgent'], description: 'Default: medium' },
          end_date:    { type: 'string', description: 'ISO deadline date e.g. "2026-06-30" (optional)' },
        },
        required: ['user_id', 'name'],
      },
      async call(input) {
        const { user_id, name, goal, description, priority = 'medium', end_date } =
          input as { user_id: string; name: string; goal?: string; description?: string; priority?: string; end_date?: string };
        const sb = db();

        const { error } = await sb.from('aria_projects').insert({
          user_id, name, priority,
          goal:        goal        ?? null,
          description: description ?? null,
          end_date:    end_date    ?? null,
          status: 'active',
        });
        if (error) throw new Error(error.message);

        const parts = [`Project created: "${name}"`];
        if (goal)     parts.push(`Goal: ${goal}`);
        if (end_date) parts.push(`Deadline: ${fmt(end_date)}`);
        return parts.join(' — ');
      },
    },

    {
      name: 'list_projects',
      description:
        'List projects. Call when user asks "show active projects", ' +
        '"what projects am I working on", "show all projects", etc.',
      inputSchema: {
        type: 'object',
        properties: {
          user_id: { type: 'string' },
          status:  { type: 'string', enum: ['active', 'paused', 'completed', 'all'], description: 'Default: active' },
        },
        required: ['user_id'],
      },
      async call(input) {
        const { user_id, status = 'active' } = input as { user_id: string; status?: string };
        const sb = db();

        let q = sb
          .from('aria_projects')
          .select('name, goal, status, priority, end_date')
          .eq('user_id', user_id)
          .order('end_date', { ascending: true, nullsFirst: false });

        if (status !== 'all') q = q.eq('status', status);

        const { data, error } = await q;
        if (error) throw new Error(error.message);
        if (!data?.length) return 'No projects found.';

        const now = new Date();
        return data.map((p) => {
          const delayed = p.end_date && new Date(p.end_date) < now && p.status === 'active';
          const parts   = [`• [${p.priority}] ${p.name}`];
          if (p.goal)     parts.push(`→ ${p.goal}`);
          if (p.end_date) parts.push(delayed ? `⚠ overdue ${fmt(p.end_date)}` : `by ${fmt(p.end_date)}`);
          return `${parts.join(' ')} [${p.status}]`;
        }).join('\n');
      },
    },

    {
      name: 'update_project',
      description: 'Change a project\'s status or record its outcome when completed.',
      inputSchema: {
        type: 'object',
        properties: {
          user_id: { type: 'string' },
          name:    { type: 'string', description: 'Project name or partial match' },
          status:  { type: 'string', enum: ['active', 'paused', 'completed'] },
          outcome: { type: 'string', description: 'What was achieved (for completed projects)' },
        },
        required: ['user_id', 'name'],
      },
      async call(input) {
        const { user_id, name, status, outcome } =
          input as { user_id: string; name: string; status?: string; outcome?: string };
        const sb = db();

        const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (status)  updates.status  = status;
        if (outcome) updates.outcome = outcome;

        const { error } = await sb
          .from('aria_projects')
          .update(updates)
          .eq('user_id', user_id)
          .ilike('name', `%${name}%`);

        if (error) throw new Error(error.message);

        const parts = [`Project "${name}" updated`];
        if (status)  parts.push(`status → ${status}`);
        if (outcome) parts.push(`outcome recorded`);
        return parts.join(', ') + '.';
      },
    },

    // ── Tasks ─────────────────────────────────────────────────────────────────

    {
      name: 'add_task',
      description:
        'Add a task. Call when user says "add task X", "remind me to X", ' +
        '"add X to project Y, due Friday, priority high".',
      inputSchema: {
        type: 'object',
        properties: {
          user_id:      { type: 'string' },
          title:        { type: 'string', description: 'Task title' },
          project_name: { type: 'string', description: 'Project name partial match (optional)' },
          description:  { type: 'string', description: 'Extra detail (optional)' },
          priority:     { type: 'string', enum: ['low', 'medium', 'high', 'urgent'], description: 'Default: medium' },
          due_date:     { type: 'string', description: 'ISO date e.g. "2026-05-01" (optional)' },
        },
        required: ['user_id', 'title'],
      },
      async call(input) {
        const { user_id, title, project_name, description, priority = 'medium', due_date } =
          input as { user_id: string; title: string; project_name?: string; description?: string; priority?: string; due_date?: string };
        const sb = db();

        let project_id: string | null = null;
        if (project_name) {
          const { data } = await sb
            .from('aria_projects')
            .select('id')
            .eq('user_id', user_id)
            .ilike('name', `%${project_name}%`)
            .maybeSingle();
          project_id = data?.id ?? null;
        }

        const { error } = await sb.from('aria_tasks').insert({
          user_id, title, project_id, priority,
          description: description ?? null,
          due_date:    due_date    ?? null,
          status: 'todo',
        });
        if (error) throw new Error(error.message);

        const parts = [`Task added: "${title}"`];
        if (project_name)       parts.push(`project: ${project_name}`);
        if (due_date)           parts.push(`due ${fmt(due_date)}`);
        if (priority !== 'medium') parts.push(priority);
        return parts.join(' — ');
      },
    },

    {
      name: 'list_tasks',
      description:
        'Return tasks. Call when user asks "what are my tasks", "show overdue tasks", ' +
        '"what\'s in progress", "show tasks for project X".',
      inputSchema: {
        type: 'object',
        properties: {
          user_id:      { type: 'string' },
          status:       { type: 'string', enum: ['todo', 'in_progress', 'completed', 'cancelled', 'all'], description: 'Default: todo' },
          project_name: { type: 'string', description: 'Filter by project name (optional)' },
          overdue_only: { type: 'boolean', description: 'Show only tasks past their due date' },
        },
        required: ['user_id'],
      },
      async call(input) {
        const { user_id, status = 'todo', project_name, overdue_only } =
          input as { user_id: string; status?: string; project_name?: string; overdue_only?: boolean };
        const sb = db();

        let q = sb
          .from('aria_tasks')
          .select('title, status, priority, due_date, aria_projects(name)')
          .eq('user_id', user_id)
          .order('due_date', { ascending: true, nullsFirst: false });

        if (overdue_only) {
          q = q
            .in('status', ['todo', 'in_progress'])
            .lt('due_date', new Date().toISOString().slice(0, 10));
        } else if (status !== 'all') {
          q = q.eq('status', status);
        }

        if (project_name) {
          const { data: proj } = await sb
            .from('aria_projects')
            .select('id')
            .eq('user_id', user_id)
            .ilike('name', `%${project_name}%`)
            .maybeSingle();
          if (proj?.id) q = q.eq('project_id', proj.id);
        }

        const { data, error } = await q;
        if (error) throw new Error(error.message);
        if (!data?.length) return 'No tasks found.';

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        return data.map((t) => {
          const due      = t.due_date ? fmt(t.due_date) : null;
          const isOverdue = t.due_date && new Date(t.due_date) < today &&
            t.status !== 'completed' && t.status !== 'cancelled';
          const proj = (t.aria_projects as { name?: string } | null)?.name;
          const parts = [`• [${t.priority}] ${t.title}`];
          if (proj) parts.push(`(${proj})`);
          if (due)  parts.push(isOverdue ? `⚠ overdue ${due}` : `due ${due}`);
          return `${parts.join(' ')} [${t.status}]`;
        }).join('\n');
      },
    },

    {
      name: 'complete_task',
      description: 'Mark a task as completed. Call when user says "done with X", "finished X", "completed X".',
      inputSchema: {
        type: 'object',
        properties: {
          user_id: { type: 'string' },
          title:   { type: 'string', description: 'Task title or partial match' },
        },
        required: ['user_id', 'title'],
      },
      async call(input) {
        const { user_id, title } = input as { user_id: string; title: string };
        const sb = db();
        const now = new Date().toISOString();

        const { error } = await sb
          .from('aria_tasks')
          .update({ status: 'completed', completed_at: now, updated_at: now })
          .eq('user_id', user_id)
          .neq('status', 'completed')
          .neq('status', 'cancelled')
          .ilike('title', `%${title}%`);

        if (error) throw new Error(error.message);
        return `Task completed: "${title}"`;
      },
    },

    {
      name: 'update_task_status',
      description: 'Change a task\'s status to in_progress, todo, or cancelled.',
      inputSchema: {
        type: 'object',
        properties: {
          user_id: { type: 'string' },
          title:   { type: 'string', description: 'Task title or partial match' },
          status:  { type: 'string', enum: ['todo', 'in_progress', 'cancelled'] },
        },
        required: ['user_id', 'title', 'status'],
      },
      async call(input) {
        const { user_id, title, status } = input as { user_id: string; title: string; status: string };
        const sb = db();

        const { error } = await sb
          .from('aria_tasks')
          .update({ status, updated_at: new Date().toISOString() })
          .eq('user_id', user_id)
          .ilike('title', `%${title}%`);

        if (error) throw new Error(error.message);
        return `Task "${title}" → ${status}.`;
      },
    },

  ];
}
