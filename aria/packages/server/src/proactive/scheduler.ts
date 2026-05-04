import cron from 'node-cron';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { claw } from '../core/index.js';
import { connectedUserIds, pushToCommandLog } from './push.js';
import { sendTelegram, telegramEnabled } from '../services/telegram.js';
import { getDueReminders, markReminderSent } from '../connectors/reminders.js';
import { sendReport } from '../services/reportScheduler.js';
import { fetchNewEmails, imapEnabled } from '../connectors/imap.js';
import { executeWorkflow } from './workflow-engine.js';
import type { WorkflowRecord } from '../routes/workflows.js';

// ── Dynamic cron workflow registry ────────────────────────────────────────────

const activeCronJobs = new Map<string, cron.ScheduledTask>();

export function registerDynamicWorkflow(workflow: WorkflowRecord): void {
  if (workflow.trigger.type !== 'schedule') return; // email/manual handled by watcher
  const expr = workflow.trigger.cronExpr ?? '';
  if (!cron.validate(expr)) {
    console.warn(`[scheduler] Invalid cron for "${workflow.name}": ${expr}`);
    return;
  }
  const job = cron.schedule(expr, async () => {
    try {
      await executeWorkflow(workflow, {});
    } catch (err) {
      console.error(`[scheduler] Workflow "${workflow.name}" failed:`, (err as Error).message);
    }
  });
  activeCronJobs.set(workflow.id, job);
  console.log(`[scheduler] Cron workflow registered: "${workflow.name}" (${expr})`);
}

export function unregisterDynamicWorkflow(workflowId: string): void {
  const job = activeCronJobs.get(workflowId);
  if (job) { job.stop(); activeCronJobs.delete(workflowId); }
}

export async function loadPersistedWorkflows(): Promise<void> {
  try {
    const { loadWorkflows } = await import('../routes/workflows.js');
    for (const w of loadWorkflows()) {
      if (w.enabled && w.trigger.type === 'schedule') registerDynamicWorkflow(w);
    }
  } catch { /* no workflows file yet */ }
}

// ── Email watcher state ───────────────────────────────────────────────────────

const STATE_FILE = resolve(process.cwd(), '.workflow-state.json');

function loadEmailState(): { lastUid: number } {
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); }
  catch { return { lastUid: 0 }; }
}

function saveEmailState(state: { lastUid: number }): void {
  try { writeFileSync(STATE_FILE, JSON.stringify(state)); } catch { /* best-effort */ }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function reportUserId(): string {
  return process.env.TELEGRAM_USER_ID ?? process.env.ARIA_DEFAULT_USER ?? 'user-1';
}

function supabaseReady(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
}

// ── Morning briefing ───────────────────────────────────────────────────────────

const BRIEFING_PROMPT = (userId: string, memBlock: string) =>
  `You are ARIA delivering the morning briefing for user "${userId}".
Today is ${new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.

Use your tools NOW before writing the briefing:
1. Call list_tasks with user_id="${userId}" and status="todo" to get open tasks.

Then produce the briefing in this exact format (omit any section with nothing to show):

▸ OVERDUE   — tasks that appear past their implied deadline
▸ TODAY     — top 3 open tasks by priority
▸ WATCHING  — tasks or threads waiting on a reply from someone else
▸ SUGGEST   — one sharp recommendation based on what you see

Rules: under 150 words, no padding, no greetings. Lead with what needs action.

Prior context from memory:
${memBlock || 'None.'}`;

// ── Scheduler ─────────────────────────────────────────────────────────────────

export function startScheduler() {

  // Morning briefing — 07:00 daily
  cron.schedule('0 7 * * *', async () => {
    const userIds = connectedUserIds();
    for (const userId of userIds) {
      try {
        const memories = await claw.getMemory().recall(userId, 'tasks commitments deadlines follow-ups', 10);
        const memBlock  = memories.map((m) => m.content).join('\n---\n');
        const briefing  = await claw.run('morning-briefing', {
          userId,
          messages: [{ role: 'user', content: BRIEFING_PROMPT(userId, memBlock) }],
        });
        await pushToCommandLog(userId, briefing);
        if (telegramEnabled()) await sendTelegram(`🌅 *ARIA Morning Briefing*\n\n${briefing}`);
      } catch (err) {
        console.error(`[scheduler] Briefing failed for ${userId}:`, err);
      }
    }
  });
  console.log('[scheduler] Morning briefing cron registered (07:00 daily)');

  // Reminders — every minute
  cron.schedule('* * * * *', async () => {
    if (!supabaseReady()) return;
    try {
      const due = await getDueReminders();
      for (const reminder of due) {
        if (telegramEnabled()) await sendTelegram(`⏰ *Reminder*\n\n${reminder.message}`);
        await pushToCommandLog(reminder.user_id, `⏰ Reminder: ${reminder.message}`);
        await markReminderSent(reminder.id);
        console.log(`[scheduler] Reminder fired: "${reminder.message}" for ${reminder.user_id}`);
      }
    } catch (err) {
      console.error('[scheduler] Reminder check failed:', (err as Error).message);
    }
  });
  console.log('[scheduler] Reminder cron registered (every minute)');

  // Email watcher — every 2 minutes (polls IMAP for new emails, fires email_received workflows)
  cron.schedule('*/2 * * * *', async () => {
    if (!imapEnabled()) return;

    let emailWorkflows: WorkflowRecord[] = [];
    try {
      const { loadWorkflows } = await import('../routes/workflows.js');
      emailWorkflows = loadWorkflows().filter(w => w.enabled && w.trigger.type === 'email_received');
    } catch { return; }

    if (!emailWorkflows.length) return;

    try {
      const state = loadEmailState();
      const { emails, maxUid } = await fetchNewEmails(state.lastUid);
      if (emails.length) {
        saveEmailState({ lastUid: maxUid });
        console.log(`[scheduler] Email watcher: ${emails.length} new email(s)`);
        for (const email of emails) {
          for (const wf of emailWorkflows) {
            const { fromFilter, subjectFilter } = wf.trigger;
            if (fromFilter && !email.from.toLowerCase().includes(fromFilter.toLowerCase())) continue;
            if (subjectFilter && !email.subject.toLowerCase().includes(subjectFilter.toLowerCase())) continue;
            await executeWorkflow(wf, {
              from:    email.from,
              subject: email.subject,
              snippet: email.snippet,
            }).catch(err => console.error(`[scheduler] Email workflow "${wf.name}" failed:`, err));
          }
        }
      } else if (maxUid > state.lastUid) {
        saveEmailState({ lastUid: maxUid });
      }
    } catch (err) {
      console.error('[scheduler] Email watcher error:', (err as Error).message);
    }
  });
  console.log('[scheduler] Email watcher cron registered (every 2 min)');

  if (!supabaseReady()) {
    console.log('[scheduler] Report crons skipped — Supabase not configured');
    loadPersistedWorkflows().catch(err => console.error('[scheduler] Failed to load workflows:', err));
    return;
  }

  // Daily report — 20:00 every day
  cron.schedule('0 20 * * *', async () => {
    try { await sendReport(reportUserId(), 'daily'); }
    catch (err) { console.error('[scheduler] Daily report failed:', (err as Error).message); }
  });

  // Weekly report — Sunday 09:00
  cron.schedule('0 9 * * 0', async () => {
    try { await sendReport(reportUserId(), 'weekly'); }
    catch (err) { console.error('[scheduler] Weekly report failed:', (err as Error).message); }
  });

  // Monthly report — 1st of month 09:00
  cron.schedule('0 9 1 * *', async () => {
    try { await sendReport(reportUserId(), 'monthly'); }
    catch (err) { console.error('[scheduler] Monthly report failed:', (err as Error).message); }
  });

  // Quarterly report — 1st of Jan, Apr, Jul, Oct at 09:00
  cron.schedule('0 9 1 1,4,7,10 *', async () => {
    try { await sendReport(reportUserId(), 'quarterly'); }
    catch (err) { console.error('[scheduler] Quarterly report failed:', (err as Error).message); }
  });

  // Yearly report — 1st Jan 10:00
  cron.schedule('0 10 1 1 *', async () => {
    try { await sendReport(reportUserId(), 'yearly'); }
    catch (err) { console.error('[scheduler] Yearly report failed:', (err as Error).message); }
  });

  console.log('[scheduler] Report crons registered (daily 20:00, weekly Sun 09:00, monthly/quarterly/yearly 1st)');

  // Load user-created schedule workflows from persistent store
  loadPersistedWorkflows().catch(err => console.error('[scheduler] Failed to load workflows:', err));
}
