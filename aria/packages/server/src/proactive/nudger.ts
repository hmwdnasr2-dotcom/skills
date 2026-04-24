import { claw } from '../core/index.js';
import { pushToCommandLog } from './push.js';

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
          `Does this reply contain a commitment or action item that needs a follow-up reminder?\n` +
          `Reply with JSON only, no prose: { "needed": boolean, "delayMs": number, "reminder": string }\n\n${reply}`,
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
    await pushToCommandLog(userId, `▸ Follow-up: ${parsed.reminder}`);
  }, parsed.delayMs);
}
