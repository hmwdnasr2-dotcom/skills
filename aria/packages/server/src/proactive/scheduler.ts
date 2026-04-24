import cron from 'node-cron';
import { claw } from '../core/index.js';
import { connectedUserIds, pushToCommandLog } from './push.js';

const BRIEFING_SYSTEM_PROMPT = `You are ARIA — a proactive personal assistant.
Generate a concise morning briefing for the user.
Format it as a command-log list with ▸ bullets.
Draw only from the memory context provided — do not invent items.
Be direct. 3-5 items maximum. Include any overdue items first.`;

export function startScheduler() {
  // Morning briefing at 07:00 every day
  cron.schedule('0 7 * * *', async () => {
    const userIds = connectedUserIds();
    for (const userId of userIds) {
      try {
        const memories = await claw.getMemory().recall(userId, 'tasks commitments deadlines', 10);
        const memBlock = memories.map((m) => m.content).join('\n---\n');

        const briefing = await claw.run('morning-briefing', {
          userId,
          messages: [
            { role: 'system', content: BRIEFING_SYSTEM_PROMPT },
            {
              role: 'user',
              content: `Memory context:\n${memBlock || 'No prior context.'}\n\nGenerate morning briefing.`,
            },
          ],
        });

        await pushToCommandLog(userId, briefing);
      } catch (err) {
        console.error(`Briefing failed for ${userId}:`, err);
      }
    }
  });

  console.log('[scheduler] Morning briefing cron registered (07:00 daily)');
}
