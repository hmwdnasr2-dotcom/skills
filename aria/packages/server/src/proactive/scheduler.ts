import cron from 'node-cron';
import { claw } from '../core/index.js';
import { connectedUserIds, pushToCommandLog } from './push.js';
import { sendTelegram, telegramEnabled } from '../services/telegram.js';
import { getDueReminders, markReminderSent } from '../connectors/reminders.js';

const BRIEFING_PROMPT = (userId: string, memBlock: string) =>
  `You are ARIA delivering the morning briefing for user "${userId}".
Today is ${new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.

Use your tools NOW before writing the briefing:
1. Call list_tasks with user_id="${userId}" and status="todo" to get open tasks.
2. Call gmail_list with query="is:unread" and maxResults=5 to get unread email (if Gmail is connected).

Then produce the briefing in this exact format (omit any section with nothing to show):

▸ OVERDUE   — tasks that appear past their implied deadline
▸ TODAY     — top 3 open tasks by priority
▸ INBOX     — unread emails that are time-sensitive or need action
▸ WATCHING  — tasks or threads waiting on a reply from someone else
▸ SUGGEST   — one sharp recommendation based on what you see

Rules: under 150 words, no padding, no greetings. Lead with what needs action.

Prior context from memory:
${memBlock || 'None.'}`;

export function startScheduler() {
  cron.schedule('0 7 * * *', async () => {
    const userIds = connectedUserIds();
    for (const userId of userIds) {
      try {
        const memories = await claw.getMemory().recall(userId, 'tasks commitments deadlines follow-ups', 10);
        const memBlock = memories.map((m) => m.content).join('\n---\n');

        const briefing = await claw.run('morning-briefing', {
          userId,
          messages: [{ role: 'user', content: BRIEFING_PROMPT(userId, memBlock) }],
        });

        await pushToCommandLog(userId, briefing);
        if (telegramEnabled()) {
          await sendTelegram(`🌅 *ARIA Morning Briefing*\n\n${briefing}`);
        }
      } catch (err) {
        console.error(`[scheduler] Briefing failed for ${userId}:`, err);
      }
    }
  });

  console.log('[scheduler] Morning briefing cron registered (07:00 daily)');

  // ── Reminder fire (every minute) ───────────────────────────────────────────
  cron.schedule('* * * * *', async () => {
    try {
      const due = await getDueReminders();
      for (const reminder of due) {
        const text = `⏰ *Reminder*\n\n${reminder.message}`;
        if (telegramEnabled()) {
          await sendTelegram(text);
        }
        await pushToCommandLog(reminder.user_id, `⏰ Reminder: ${reminder.message}`);
        await markReminderSent(reminder.id);
        console.log(`[scheduler] Reminder fired: "${reminder.message}" for ${reminder.user_id}`);
      }
    } catch (err) {
      console.error('[scheduler] Reminder check failed:', (err as Error).message);
    }
  });

  console.log('[scheduler] Reminder cron registered (every minute)');
}
