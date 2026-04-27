import { createClient } from '@supabase/supabase-js';
import { claw } from '../core/index.js';
import { sendTelegram, telegramEnabled } from './telegram.js';
import { sendEmail, emailEnabled } from './mailer.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export type ReportPeriod = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

// ── Supabase ───────────────────────────────────────────────────────────────────

function db() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
}

function periodRange(period: ReportPeriod): { from: Date; to: Date; label: string } {
  const to   = new Date();
  const from = new Date();
  switch (period) {
    case 'hourly':    from.setHours  (from.getHours()       - 1); break;
    case 'daily':     from.setDate   (from.getDate()        - 1); break;
    case 'weekly':    from.setDate   (from.getDate()        - 7); break;
    case 'monthly':   from.setMonth  (from.getMonth()       - 1); break;
    case 'quarterly': from.setMonth  (from.getMonth()       - 3); break;
    case 'yearly':    from.setFullYear(from.getFullYear()   - 1); break;
  }
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return { from, to, label: `${fmt(from)} – ${fmt(to)}` };
}

// ── Data fetcher ───────────────────────────────────────────────────────────────

async function fetchReportData(userId: string, from: Date, to: Date) {
  const sb   = db();
  const gte  = from.toISOString();
  const lte  = to.toISOString();
  const now  = new Date().toISOString();

  const [completedRes, addedRes, overdueRes, projectsRes] = await Promise.all([
    sb.from('aria_tasks')
      .select('title, completed_at')
      .eq('user_id', userId)
      .eq('status', 'done')
      .gte('completed_at', gte)
      .lte('completed_at', lte),
    sb.from('aria_tasks')
      .select('title, status, priority')
      .eq('user_id', userId)
      .gte('created_at', gte)
      .lte('created_at', lte),
    sb.from('aria_tasks')
      .select('title, due_date')
      .eq('user_id', userId)
      .neq('status', 'done')
      .lt('due_date', now)
      .not('due_date', 'is', null),
    sb.from('aria_projects')
      .select('name, status, goal')
      .eq('user_id', userId)
      .eq('status', 'active'),
  ]);

  return {
    completed: completedRes.data ?? [],
    added:     addedRes.data     ?? [],
    overdue:   overdueRes.data   ?? [],
    projects:  projectsRes.data  ?? [],
  };
}

// ── Report generator ───────────────────────────────────────────────────────────

export async function generateReport(userId: string, period: ReportPeriod): Promise<string> {
  const { from, to, label } = periodRange(period);
  const data                = await fetchReportData(userId, from, to);

  const dataBlock = `
PERIOD: ${period.toUpperCase()} — ${label}

COMPLETED (${data.completed.length}):
${data.completed.map(t => `• ${t.title}`).join('\n') || '• None'}

TASKS ADDED (${data.added.length}):
${data.added.map(t => `• ${t.title} [${t.status ?? 'todo'}, ${t.priority ?? 'medium'}]`).join('\n') || '• None'}

OVERDUE (${data.overdue.length}):
${data.overdue.map(t => `• ${t.title} (due: ${String(t.due_date).slice(0, 10)})`).join('\n') || '• None'}

ACTIVE PROJECTS (${data.projects.length}):
${data.projects.map(p => `• ${p.name}${p.goal ? ` — ${p.goal}` : ''}`).join('\n') || '• None'}
`;

  const periodLabels: Record<ReportPeriod, string> = {
    hourly:    'hourly activity summary',
    daily:     'end-of-day report',
    weekly:    'weekly review',
    monthly:   'monthly achievements and patterns report',
    quarterly: 'quarterly business review',
    yearly:    'annual review and year in numbers',
  };

  const reply = await claw.run('morning-briefing', {
    userId,
    messages: [{
      role: 'user',
      content:
        `Write a ${periodLabels[period]} for the user. Use the data below. ` +
        `Be specific about numbers and names. Surface genuine insights — patterns, ` +
        `streaks, blockers. End with one sharp recommendation. Keep it under 300 words.\n\n${dataBlock}`,
    }],
  });

  return String(reply ?? 'No data available for this period.');
}

// ── Delivery ───────────────────────────────────────────────────────────────────

const EMOJI: Record<ReportPeriod, string> = {
  hourly:    '⏱',
  daily:     '📅',
  weekly:    '📊',
  monthly:   '🗓',
  quarterly: '📈',
  yearly:    '🏆',
};

export async function sendReport(userId: string, period: ReportPeriod): Promise<string> {
  const report  = await generateReport(userId, period);
  const title   = `ARIA ${period.charAt(0).toUpperCase() + period.slice(1)} Report`;
  const msgText = `${EMOJI[period]} *${title}*\n\n${report}`;

  if (telegramEnabled()) {
    const chunk = msgText.length > 4000 ? msgText.slice(0, 3950) + '\n\n_(truncated)_' : msgText;
    await sendTelegram(chunk);
  }

  if (emailEnabled()) {
    await sendEmail({
      subject: title,
      text:    report,
      html:    `<pre style="font-family:sans-serif;white-space:pre-wrap">${report}</pre>`,
    });
  }

  console.log(`[report] ${period} report sent for ${userId}`);
  return report;
}
