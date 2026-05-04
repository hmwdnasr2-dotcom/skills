import { claw } from '../core/index.js';
import { sendTelegram, telegramEnabled } from '../services/telegram.js';
import { pushToCommandLog } from './push.js';
import type { WorkflowRecord, WorkflowAction } from '../routes/workflows.js';
// NOTE: patchWorkflow is imported dynamically below to break the circular dep:
//   scheduler → workflow-engine → routes/workflows → scheduler

interface TriggerContext {
  from?:    string;
  subject?: string;
  snippet?: string;
}

function renderTemplate(template: string, ctx: TriggerContext): string {
  return template
    .replace(/\{from\}/g,    ctx.from    ?? '')
    .replace(/\{subject\}/g, ctx.subject ?? '')
    .replace(/\{snippet\}/g, ctx.snippet ?? '');
}

async function executeAction(action: WorkflowAction, wf: WorkflowRecord, ctx: TriggerContext): Promise<void> {
  switch (action.type) {
    case 'telegram_notify': {
      if (!telegramEnabled()) break;
      const text = action.template
        ? renderTemplate(action.template, ctx)
        : `🔔 *${wf.name}*\n${ctx.subject ? `Subject: ${ctx.subject}\nFrom: ${ctx.from}` : 'Triggered'}`;
      await sendTelegram(text);
      break;
    }
    case 'aria_prompt': {
      const prompt = action.prompt
        ? renderTemplate(action.prompt, ctx)
        : `Workflow "${wf.name}" fired. ${ctx.subject ? `New email from ${ctx.from}: "${ctx.subject}"` : 'Act accordingly.'}`;
      const result = await claw.run('chat', {
        userId:   wf.userId,
        messages: [{ role: 'user', content: prompt }],
      });
      // Push result to browser chat (SSE) so it appears as an ARIA message
      await pushToCommandLog(wf.userId, `🤖 **${wf.name}**\n\n${result}`, 'notification');
      if (telegramEnabled()) await sendTelegram(`🤖 *${wf.name}*\n\n${result}`);
      break;
    }
  }
}

export async function executeWorkflow(wf: WorkflowRecord, ctx: TriggerContext = {}): Promise<void> {
  if (!wf.enabled) return;
  const errors: string[] = [];
  for (const action of wf.actions) {
    try {
      await executeAction(action, wf, ctx);
    } catch (err) {
      errors.push((err as Error).message);
    }
  }
  try {
    const { patchWorkflow } = await import('../routes/workflows.js');
    patchWorkflow(wf.id, {
      lastRunAt:     new Date().toISOString(),
      lastRunStatus: errors.length ? 'error' : 'ok',
      lastRunResult: errors.length ? errors.join('; ') : 'OK',
    });
  } catch { /* best-effort — don't let a patch failure mask real errors */ }

  if (errors.length) {
    console.error(`[workflow] "${wf.name}" finished with errors:`, errors);
  } else {
    console.log(`[workflow] "${wf.name}" executed OK`);
  }
}
