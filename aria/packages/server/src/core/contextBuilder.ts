import { buildMessages } from '../services/aiWorkflow.js';
import type { BrainMessage } from '../services/aiWorkflow.js';
import type { ParsedDocument } from '../services/fileParser.js';
import type { BraveResult } from '../services/braveSearch.js';
import { formatSearchResults } from '../services/braveSearch.js';
import type { ExecutionPlan } from './router.js';

export function buildContext(
  message: string,
  plan: ExecutionPlan,
  docs: ParsedDocument[],
  searchResults?: BraveResult[],
): BrainMessage[] {
  const parts: string[] = [];

  if (plan.systemHint) {
    parts.push(`[${plan.systemHint}]`);
  }

  if (searchResults && searchResults.length > 0) {
    parts.push(`[Web search results for: "${message}"]\n${formatSearchResults(searchResults)}`);
  }

  parts.push(message);

  const fullMessage = parts.join('\n\n');

  return docs.length > 0
    ? buildMessages(fullMessage, docs)
    : [{ role: 'user', content: fullMessage }];
}
