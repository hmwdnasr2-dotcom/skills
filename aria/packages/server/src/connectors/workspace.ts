import { createClient } from '@supabase/supabase-js';
import type { BridgeAdapter } from '@aria/core';

function db() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
  );
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

  ];
}
