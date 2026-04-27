import { claw } from '../core/index.js';
import { pushToCommandLog } from './push.js';
import { sendTelegram, telegramEnabled } from '../services/telegram.js';

interface NudgePayload {
  needed: boolean;
  delayMs: number;
  reminder: string;
}

export async function scheduleNudgeIfNeeded(userId: string, reply: string) {
  const check = await claw.run('nudge-check', {
    userId,
    messages: [
      {
        role: 'user',
        content:
          `Analyse this assistant reply for any commitment, pending reply, deadline, or waiting-on situation.\n` +
          `If a follow-up nudge would be useful, return JSON. Otherwise return {"needed":false}.\n` +
          `JSON shape: { "needed": boolean, "delayMs": number, "reminder": string }\n` +
          `delayMs examples: 1 hour = 3600000, 24 hours = 86400000, 48 hours = 172800000.\n` +
          `reminder should be a single actionable sentence, e.g. "Chase Sarah re: proposal — no reply yet."\n\n` +
          `Reply:\n${reply}`,
      },
    ],
  });

  let parsed: NudgePayload;
  try {
    parsed = JSON.parse(check);
  } catch {
    return;
  }

  if (!parsed.needed) return;

  setTimeout(async () => {
    const reminder = `▸ Follow-up: ${parsed.reminder}`;
    await pushToCommandLog(userId, reminder);
    if (telegramEnabled()) {
      await sendTelegram(`⏰ *ARIA Reminder*\n\n${parsed.reminder}`);
    }
  }, parsed.delayMs);
}
