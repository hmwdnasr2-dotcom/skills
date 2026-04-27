import { createClient } from '@supabase/supabase-js';
import type { BridgeAdapter } from '@aria/core';

function db() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface Reminder {
  id: string;
  user_id: string;
  message: string;
  remind_at: string;
  sent: boolean;
  created_at: string;
}

// ── Direct helpers (used by scheduler) ────────────────────────────────────────

export async function getDueReminders(): Promise<Reminder[]> {
  const sb = db();
  const { data, error } = await sb
    .from('aria_reminders')
    .select('*')
    .eq('sent', false)
    .lte('remind_at', new Date().toISOString())
    .order('remind_at', { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as Reminder[];
}

export async function markReminderSent(id: string): Promise<void> {
  const sb = db();
  await sb.from('aria_reminders').update({ sent: true }).eq('id', id);
}

// ── Tool adapters ──────────────────────────────────────────────────────────────

export function buildReminderAdapters(): BridgeAdapter[] {
  return [

    {
      name: 'set_reminder',
      description:
        'Schedule a reminder to be sent at a specific date and time via Telegram and the app. ' +
        'Call when user says "remind me to X at Y", "set a reminder for X", ' +
        '"ping me at Y to do X", "remind me in N hours/minutes". ' +
        'Convert relative times ("in 2 hours", "at 6pm") to absolute ISO 8601 datetime using today\'s date and time.',
      inputSchema: {
        type: 'object',
        properties: {
          user_id:   { type: 'string' },
          message:   { type: 'string', description: 'What to remind the user about' },
          remind_at: { type: 'string', description: 'ISO 8601 datetime e.g. "2025-04-27T18:12:00"' },
        },
        required: ['user_id', 'message', 'remind_at'],
      },
      async call(input) {
        const { user_id, message, remind_at } =
          input as { user_id: string; message: string; remind_at: string };

        const at = new Date(remind_at);
        if (isNaN(at.getTime())) throw new Error(`Invalid remind_at: "${remind_at}"`);
        if (at < new Date())      throw new Error('remind_at must be in the future');

        const sb = db();
        const { error } = await sb.from('aria_reminders').insert({ user_id, message, remind_at });
        if (error) throw new Error(error.message);

        const label = at.toLocaleString('en-GB', {
          weekday: 'short', day: 'numeric', month: 'short',
          hour: '2-digit', minute: '2-digit',
        });
        return `Reminder set: "${message}" — I'll ping you on ${label}.`;
      },
    },

    {
      name: 'list_reminders',
      description:
        'List upcoming reminders. Call when user asks "what reminders do I have", ' +
        '"show my reminders", "what\'s coming up".',
      inputSchema: {
        type: 'object',
        properties: { user_id: { type: 'string' } },
        required: ['user_id'],
      },
      async call(input) {
        const { user_id } = input as { user_id: string };
        const sb = db();
        const { data, error } = await sb
          .from('aria_reminders')
          .select('id, message, remind_at')
          .eq('user_id', user_id)
          .eq('sent', false)
          .gt('remind_at', new Date().toISOString())
          .order('remind_at', { ascending: true })
          .limit(10);

        if (error) throw new Error(error.message);
        if (!data || data.length === 0) return 'No upcoming reminders.';

        return data.map((r, i) => {
          const at = new Date(r.remind_at).toLocaleString('en-GB', {
            weekday: 'short', day: 'numeric', month: 'short',
            hour: '2-digit', minute: '2-digit',
          });
          return `${i + 1}. ${r.message} — ${at} (id: ${r.id.slice(0, 8)})`;
        }).join('\n');
      },
    },

    {
      name: 'cancel_reminder',
      description: 'Cancel a reminder by its ID. Call when user says "cancel reminder X", "delete reminder X".',
      inputSchema: {
        type: 'object',
        properties: {
          user_id:     { type: 'string' },
          reminder_id: { type: 'string', description: 'Full or partial reminder ID from list_reminders' },
        },
        required: ['user_id', 'reminder_id'],
      },
      async call(input) {
        const { user_id, reminder_id } = input as { user_id: string; reminder_id: string };
        const sb = db();

        const { data, error } = await sb
          .from('aria_reminders')
          .delete()
          .eq('user_id', user_id)
          .ilike('id', `${reminder_id}%`)
          .select('message');

        if (error) throw new Error(error.message);
        if (!data || data.length === 0) return 'No matching reminder found.';
        return `Cancelled: "${(data[0] as { message: string }).message}"`;
      },
    },
  ];
}
