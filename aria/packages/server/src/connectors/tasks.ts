import { createClient } from '@supabase/supabase-js';
import type { BridgeAdapter } from '@aria/core';

function db() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
  );
}

export function buildTaskAdapters(): BridgeAdapter[] {
  return [
    {
      name: 'add_task',
      description:
        'Save a new task for the user. Call this when the user says "add task", "remind me to", or "create task".',
      inputSchema: {
        type: 'object',
        properties: {
          user_id:      { type: 'string', description: 'The current user ID' },
          title:        { type: 'string', description: 'Task title' },
          project_name: { type: 'string', description: 'Project to file the task under (optional)' },
        },
        required: ['user_id', 'title'],
      },
      async call(input) {
        const { user_id, title, project_name } = input as {
          user_id: string; title: string; project_name?: string;
        };
        const sb = db();

        let project_id: string | null = null;
        if (project_name) {
          const { data } = await sb
            .from('aria_projects')
            .select('id')
            .eq('user_id', user_id)
            .ilike('name', project_name)
            .maybeSingle();
          project_id = data?.id ?? null;
        }

        const { error } = await sb
          .from('aria_tasks')
          .insert({ user_id, title, project_id, status: 'todo' });

        if (error) throw new Error(error.message);
        return `Task saved: "${title}"`;
      },
    },

    {
      name: 'list_tasks',
      description:
        'Return the user\'s tasks. Call when they ask "what are my tasks", "show tasks", "what do I need to do", etc.',
      inputSchema: {
        type: 'object',
        properties: {
          user_id: { type: 'string' },
          status:  {
            type: 'string',
            enum: ['todo', 'done', 'all'],
            description: 'Filter by status. Defaults to "todo".',
          },
        },
        required: ['user_id'],
      },
      async call(input) {
        const { user_id, status = 'todo' } = input as { user_id: string; status?: string };
        const sb = db();

        let q = sb
          .from('aria_tasks')
          .select('title, status, created_at')
          .eq('user_id', user_id)
          .order('created_at', { ascending: true });

        if (status !== 'all') q = q.eq('status', status);

        const { data, error } = await q;
        if (error) throw new Error(error.message);
        if (!data?.length) return 'No tasks found.';
        return data.map((t) => `• [${t.status}] ${t.title}`).join('\n');
      },
    },

    {
      name: 'complete_task',
      description: 'Mark a task as done. Call when the user says "done", "complete", "finished" for a task.',
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
          .update({ status: 'done' })
          .eq('user_id', user_id)
          .eq('status', 'todo')
          .ilike('title', `%${title}%`);

        if (error) throw new Error(error.message);
        return `Marked as done: "${title}"`;
      },
    },

    {
      name: 'create_project',
      description: 'Create a new project. Call when the user says "create project" or "new project".',
      inputSchema: {
        type: 'object',
        properties: {
          user_id: { type: 'string' },
          name:    { type: 'string', description: 'Project name' },
        },
        required: ['user_id', 'name'],
      },
      async call(input) {
        const { user_id, name } = input as { user_id: string; name: string };
        const sb = db();

        const { error } = await sb
          .from('aria_projects')
          .insert({ user_id, name });

        if (error) throw new Error(error.message);
        return `Project created: "${name}"`;
      },
    },

    {
      name: 'list_projects',
      description: 'Return the user\'s projects.',
      inputSchema: {
        type: 'object',
        properties: {
          user_id: { type: 'string' },
        },
        required: ['user_id'],
      },
      async call(input) {
        const { user_id } = input as { user_id: string };
        const sb = db();

        const { data, error } = await sb
          .from('aria_projects')
          .select('name, created_at')
          .eq('user_id', user_id)
          .order('created_at', { ascending: false });

        if (error) throw new Error(error.message);
        if (!data?.length) return 'No projects found.';
        return data.map((p) => `• ${p.name}`).join('\n');
      },
    },
  ];
}
