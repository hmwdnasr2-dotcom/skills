import { createClient } from '@supabase/supabase-js';
import type { BridgeAdapter } from '@aria/core';

function db() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
  );
}

function periodStart(period: string): Date {
  const now = new Date();
  switch (period) {
    case 'week':    return new Date(now.getTime() - 7 * 86_400_000);
    case 'month':   return new Date(now.getFullYear(), now.getMonth(), 1);
    case 'quarter': return new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
    case 'year':    return new Date(now.getFullYear(), 0, 1);
    default:        return new Date(now.getFullYear(), now.getMonth(), 1);
  }
}

function pct(n: number, d: number): string {
  return d === 0 ? 'n/a' : `${Math.round((n / d) * 100)}%`;
}

export function buildWorkspaceAdapters(): BridgeAdapter[] {
  return [

    // ── Follow-ups ─────────────────────────────────────────────────────────────

    {
      name: 'add_follow_up',
      description:
        'Track a follow-up. Call when the user is waiting on someone, ' +
        'or when a commitment needs to be chased later.',
      inputSchema: {
        type: 'object',
        properties: {
          user_id:     { type: 'string' },
          subject:     { type: 'string', description: 'What to follow up on' },
          with_person: { type: 'string', description: 'Who to follow up with (optional)' },
          due_date:    { type: 'string', description: 'ISO date when to follow up' },
        },
        required: ['user_id', 'subject'],
      },
      async call(input) {
        const { user_id, subject, with_person, due_date } =
          input as { user_id: string; subject: string; with_person?: string; due_date?: string };
        const sb = db();

        const { error } = await sb.from('aria_follow_ups').insert({
          user_id, subject,
          with_person: with_person ?? null,
          due_date: due_date ?? null,
          status: 'pending',
        });
        if (error) throw new Error(error.message);

        const who = with_person ? ` with ${with_person}` : '';
        return `Follow-up logged: "${subject}"${who}.`;
      },
    },

    {
      name: 'list_follow_ups',
      description: 'Return pending follow-ups. Call when user asks about things they\'re waiting on or chasing.',
      inputSchema: {
        type: 'object',
        properties: {
          user_id: { type: 'string' },
          status:  { type: 'string', enum: ['pending', 'done', 'all'], description: 'Default: pending' },
        },
        required: ['user_id'],
      },
      async call(input) {
        const { user_id, status = 'pending' } = input as { user_id: string; status?: string };
        const sb = db();

        let q = sb
          .from('aria_follow_ups')
          .select('subject, with_person, due_date, status, created_at')
          .eq('user_id', user_id)
          .order('due_date', { ascending: true, nullsFirst: false });

        if (status !== 'all') q = q.eq('status', status);

        const { data, error } = await q;
        if (error) throw new Error(error.message);
        if (!data?.length) return 'No follow-ups found.';

        const today = new Date();
        return data.map((f) => {
          const due = f.due_date
            ? new Date(f.due_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
            : null;
          const overdue = f.due_date && new Date(f.due_date) < today && f.status === 'pending';
          const who = f.with_person ? ` → ${f.with_person}` : '';
          const when = due ? (overdue ? ` ⚠ overdue ${due}` : ` by ${due}`) : '';
          return `• ${f.subject}${who}${when}`;
        }).join('\n');
      },
    },

    {
      name: 'complete_follow_up',
      description: 'Mark a follow-up as done.',
      inputSchema: {
        type: 'object',
        properties: {
          user_id: { type: 'string' },
          subject: { type: 'string', description: 'Follow-up subject or partial match' },
        },
        required: ['user_id', 'subject'],
      },
      async call(input) {
        const { user_id, subject } = input as { user_id: string; subject: string };
        const sb = db();

        const { error } = await sb
          .from('aria_follow_ups')
          .update({ status: 'done', completed_at: new Date().toISOString() })
          .eq('user_id', user_id)
          .eq('status', 'pending')
          .ilike('subject', `%${subject}%`);

        if (error) throw new Error(error.message);
        return `Follow-up closed: "${subject}".`;
      },
    },

    // ── Achievements ───────────────────────────────────────────────────────────

    {
      name: 'log_achievement',
      description:
        'Record an achievement. Call when the user says "log achievement", ' +
        '"I achieved X", "mark this as a win", or "note this down as a success".',
      inputSchema: {
        type: 'object',
        properties: {
          user_id:     { type: 'string' },
          title:       { type: 'string', description: 'Achievement headline' },
          description: { type: 'string', description: 'More detail (optional)' },
          category:    {
            type: 'string',
            enum: ['work', 'personal', 'learning', 'health', 'general'],
            description: 'Default: general',
          },
        },
        required: ['user_id', 'title'],
      },
      async call(input) {
        const { user_id, title, description, category = 'general' } =
          input as { user_id: string; title: string; description?: string; category?: string };
        const sb = db();

        const { error } = await sb.from('aria_achievements').insert({
          user_id, title,
          description: description ?? null,
          category,
        });
        if (error) throw new Error(error.message);
        return `Achievement logged [${category}]: "${title}"`;
      },
    },

    // ── Daily log ──────────────────────────────────────────────────────────────

    {
      name: 'log_daily',
      description: 'Save a daily log entry. Call when user gives an end-of-day summary or reflection.',
      inputSchema: {
        type: 'object',
        properties: {
          user_id: { type: 'string' },
          summary: { type: 'string', description: 'What happened today' },
          mood:    { type: 'string', description: 'Optional mood descriptor (good, tired, energised, etc.)' },
          date:    { type: 'string', description: 'ISO date, defaults to today' },
        },
        required: ['user_id', 'summary'],
      },
      async call(input) {
        const { user_id, summary, mood, date } =
          input as { user_id: string; summary: string; mood?: string; date?: string };
        const sb = db();

        const { error } = await sb.from('aria_daily_logs').upsert(
          { user_id, summary, mood: mood ?? null, date: date ?? new Date().toISOString().slice(0, 10) },
          { onConflict: 'user_id,date' },
        );
        if (error) throw new Error(error.message);
        return 'Daily log saved.';
      },
    },

    // ── Reporting engine ───────────────────────────────────────────────────────

    {
      name: 'generate_report',
      description:
        'Generate a structured report for a given period. ' +
        'Call when user asks "give me my weekly/monthly/quarterly/yearly report", ' +
        '"how have I been doing this month", "show my progress", etc. ' +
        'Returns raw data — write a narrative summary from it.',
      inputSchema: {
        type: 'object',
        properties: {
          user_id: { type: 'string' },
          period:  {
            type: 'string',
            enum: ['week', 'month', 'quarter', 'year'],
            description: 'Reporting period',
          },
        },
        required: ['user_id', 'period'],
      },
      async call(input) {
        const { user_id, period } = input as { user_id: string; period: string };
        const sb = db();
        const start = periodStart(period);
        const startIso = start.toISOString();
        const now = new Date();

        const [tasks, projects, achievements, followUps, logs] = await Promise.all([
          sb.from('aria_tasks')
            .select('title, status, priority, due_date, completed_at, created_at')
            .eq('user_id', user_id)
            .gte('created_at', startIso),

          sb.from('aria_projects')
            .select('name, goal, end_date, status, created_at')
            .eq('user_id', user_id),

          sb.from('aria_achievements')
            .select('title, category, logged_at')
            .eq('user_id', user_id)
            .gte('logged_at', startIso)
            .order('logged_at', { ascending: false }),

          sb.from('aria_follow_ups')
            .select('subject, with_person, status, due_date, completed_at')
            .eq('user_id', user_id)
            .gte('created_at', startIso),

          sb.from('aria_daily_logs')
            .select('date, mood, summary')
            .eq('user_id', user_id)
            .gte('date', start.toISOString().slice(0, 10))
            .order('date', { ascending: false }),
        ]);

        if (tasks.error)        throw new Error(tasks.error.message);
        if (projects.error)     throw new Error(projects.error.message);
        if (achievements.error) throw new Error(achievements.error.message);
        if (followUps.error)    throw new Error(followUps.error.message);

        const allTasks       = tasks.data ?? [];
        const completedTasks = allTasks.filter((t) => t.status === 'completed');
        const openTasks      = allTasks.filter((t) => t.status === 'todo' || t.status === 'in_progress');
        const overdueTasks   = openTasks.filter((t) => t.due_date && new Date(t.due_date) < now);

        const allFollowUps  = followUps.data ?? [];
        const doneFollowUps = allFollowUps.filter((f) => f.status === 'done');

        const allProjects       = projects.data ?? [];
        const activeProjects    = allProjects.filter((p) => p.status === 'active');
        const completedProjects = allProjects.filter((p) => p.status === 'completed');

        const report = {
          period,
          range: {
            from: start.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
            to:   now.toLocaleDateString('en-GB',   { day: 'numeric', month: 'long', year: 'numeric' }),
          },
          tasks: {
            added:           allTasks.length,
            completed:       completedTasks.length,
            open:            openTasks.length,
            overdue:         overdueTasks.length,
            completion_rate: pct(completedTasks.length, allTasks.length),
            completed_list:  completedTasks.map((t) => t.title),
            overdue_list:    overdueTasks.map((t) => ({ title: t.title, due: t.due_date })),
            by_priority: {
              urgent: allTasks.filter((t) => t.priority === 'urgent').length,
              high:   allTasks.filter((t) => t.priority === 'high').length,
              medium: allTasks.filter((t) => t.priority === 'medium').length,
              low:    allTasks.filter((t) => t.priority === 'low').length,
            },
          },
          projects: {
            active:           activeProjects.length,
            completed:        completedProjects.length,
            active_list:      activeProjects.map((p) => ({
              name: p.name, goal: p.goal, end_date: p.end_date,
            })),
            completed_list:   completedProjects.map((p) => p.name),
          },
          achievements: {
            count: achievements.data?.length ?? 0,
            list:  achievements.data?.map((a) => ({ title: a.title, category: a.category })) ?? [],
          },
          follow_ups: {
            total:           allFollowUps.length,
            completed:       doneFollowUps.length,
            pending:         allFollowUps.filter((f) => f.status === 'pending').length,
            completion_rate: pct(doneFollowUps.length, allFollowUps.length),
            pending_list:    allFollowUps
              .filter((f) => f.status === 'pending')
              .map((f) => f.with_person ? `${f.subject} (${f.with_person})` : f.subject),
          },
          daily_logs: {
            entries: logs.data?.length ?? 0,
            moods:   logs.data?.map((l) => l.mood).filter(Boolean) ?? [],
          },
        };

        return JSON.stringify(report, null, 2);
      },
    },

  ];
}
