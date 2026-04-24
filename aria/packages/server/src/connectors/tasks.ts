import { createClient } from '@supabase/supabase-js';
import type { BridgeAdapter } from '@aria/core';

function db() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function buildTaskAdapters(): BridgeAdapter[] {
  return [

    // ── Tasks ──────────────────────────────────────────────────────────────────

    {
      name: 'add_task',
      description:
        'Save a new task. Use when the user says "add task X", "remind me to X", ' +
        '"I need to X", or "add X to project Y". Accepts due date and priority.',
      inputSchema: {
        type: 'object',
        properties: {
          user_id:      { type: 'string' },
          title:        { type: 'string', description: 'Task title' },
          project_name: { type: 'string', description: 'Project name (optional, partial match ok)' },
          due_date:     { type: 'string', description: 'ISO date string, e.g. "2026-04-28"' },
          priority:     { type: 'string', enum: ['low', 'medium', 'high', 'urgent'], description: 'Default: medium' },
        },
        required: ['user_id', 'title'],
      },
      async call(input) {
        const { user_id, title, project_name, due_date, priority = 'medium' } =
          input as { user_id: string; title: string; project_name?: string; due_date?: string; priority?: string };
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
          user_id, title, project_id, status: 'todo', priority,
          due_date: due_date ?? null,
        });
        if (error) throw new Error(error.message);

        const parts = [`Task added: "${title}"`];
        if (due_date) parts.push(`due ${fmtDate(due_date)}`);
        if (priority !== 'medium') parts.push(priority);
        return parts.join(' — ');
      },
    },

    {
      name: 'list_tasks',
      description:
        'Return tasks. Call when the user asks "what are my tasks", "show tasks", ' +
        '"what do I need to do", "any overdue tasks", etc.',
      inputSchema: {
        type: 'object',
        properties: {
          user_id:      { type: 'string' },
          status:       { type: 'string', enum: ['todo', 'done', 'all'], description: 'Default: todo' },
          project_name: { type: 'string', description: 'Filter by project name (optional)' },
        },
        required: ['user_id'],
      },
      async call(input) {
        const { user_id, status = 'todo', project_name } =
          input as { user_id: string; status?: string; project_name?: string };
        const sb = db();

        let q = sb
          .from('aria_tasks')
          .select('title, status, priority, due_date, created_at, aria_projects(name)')
          .eq('user_id', user_id)
          .order('due_date', { ascending: true, nullsFirst: false })
          .order('created_at', { ascending: true });

        if (status !== 'all') q = q.eq('status', status);

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
        return data.map((t) => {
          const due = t.due_date ? fmtDate(t.due_date) : null;
          const overdue = t.due_date && new Date(t.due_date) < today && t.status === 'todo';
          const proj = (t.aria_projects as { name?: string } | null)?.name;
          const parts = [`• [${t.priority}] ${t.title}`];
          if (proj) parts.push(`(${proj})`);
          if (due) parts.push(overdue ? `⚠ overdue ${due}` : `due ${due}`);
          return parts.join(' ');
        }).join('\n');
      },
    },

    {
      name: 'complete_task',
      description: 'Mark a task as done. Call when user says "done", "completed", "finished" for a task.',
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

        const { error } = await sb
          .from('aria_tasks')
          .update({ status: 'done', completed_at: new Date().toISOString() })
          .eq('user_id', user_id)
          .eq('status', 'todo')
          .ilike('title', `%${title}%`);

        if (error) throw new Error(error.message);
        return `Done: "${title}"`;
      },
    },

    // ── Projects ───────────────────────────────────────────────────────────────

    {
      name: 'create_project',
      description:
        'Create a project. Call when user says "new project: X, goal: Y, deadline: Z" ' +
        'or "create project X".',
      inputSchema: {
        type: 'object',
        properties: {
          user_id:  { type: 'string' },
          name:     { type: 'string', description: 'Project name' },
          goal:     { type: 'string', description: 'What success looks like (optional)' },
          deadline: { type: 'string', description: 'ISO date for target completion (optional)' },
        },
        required: ['user_id', 'name'],
      },
      async call(input) {
        const { user_id, name, goal, deadline } =
          input as { user_id: string; name: string; goal?: string; deadline?: string };
        const sb = db();

        const { error } = await sb.from('aria_projects').insert({
          user_id, name,
          goal: goal ?? null,
          deadline: deadline ?? null,
          status: 'active',
        });
        if (error) throw new Error(error.message);

        const parts = [`Project created: "${name}"`];
        if (goal) parts.push(`Goal: ${goal}`);
        if (deadline) parts.push(`Deadline: ${fmtDate(deadline)}`);
        return parts.join(' — ');
      },
    },

    {
      name: 'update_project_status',
      description: 'Change a project\'s status to completed, on-hold, or cancelled.',
      inputSchema: {
        type: 'object',
        properties: {
          user_id: { type: 'string' },
          name:    { type: 'string' },
          status:  { type: 'string', enum: ['active', 'completed', 'on-hold', 'cancelled'] },
        },
        required: ['user_id', 'name', 'status'],
      },
      async call(input) {
        const { user_id, name, status } = input as { user_id: string; name: string; status: string };
        const sb = db();

        const { error } = await sb
          .from('aria_projects')
          .update({ status })
          .eq('user_id', user_id)
          .ilike('name', `%${name}%`);

        if (error) throw new Error(error.message);
        return `Project "${name}" marked ${status}.`;
      },
    },

    {
      name: 'list_projects',
      description: 'Return the user\'s projects with goals and deadlines.',
      inputSchema: {
        type: 'object',
        properties: {
          user_id: { type: 'string' },
          status:  { type: 'string', enum: ['active', 'completed', 'on-hold', 'cancelled', 'all'], description: 'Default: active' },
        },
        required: ['user_id'],
      },
      async call(input) {
        const { user_id, status = 'active' } = input as { user_id: string; status?: string };
        const sb = db();

        let q = sb
          .from('aria_projects')
          .select('name, goal, deadline, status, created_at')
          .eq('user_id', user_id)
          .order('deadline', { ascending: true, nullsFirst: false });

        if (status !== 'all') q = q.eq('status', status);

        const { data, error } = await q;
        if (error) throw new Error(error.message);
        if (!data?.length) return 'No projects found.';

        return data.map((p) => {
          const parts = [`• [${p.status}] ${p.name}`];
          if (p.goal) parts.push(`→ ${p.goal}`);
          if (p.deadline) parts.push(`by ${fmtDate(p.deadline)}`);
          return parts.join(' ');
        }).join('\n');
      },
    },

  ];
}
