import { buildMessages } from '../services/aiWorkflow.js';
import type { BrainMessage } from '../services/aiWorkflow.js';
import type { ParsedDocument } from '../services/fileParser.js';
import type { ExecutionPlan } from './router.js';

export function buildContext(
  message: string,
  plan: ExecutionPlan,
  docs: ParsedDocument[],
): BrainMessage[] {
  const prefixed = plan.systemHint
    ? `[${plan.systemHint}]\n\n${message}`
    : message;

  return docs.length > 0
    ? buildMessages(prefixed, docs)
    : [{ role: 'user', content: prefixed }];
}
