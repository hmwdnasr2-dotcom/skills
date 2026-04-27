import { route } from './router.js';
import { processFiles } from './fileHandler.js';
import { buildContext } from './contextBuilder.js';
import { braveSearch } from '../services/braveSearch.js';
import { extractInsight, saveInsight } from './memory.js';
import { claw } from './index.js';
import type { Message } from '@aria/core';

export interface WorkflowResult {
  answer:  string;
  intent:  string;
  saved:   boolean;
}

export async function runWorkflow(
  userId:   string,
  query:    string,
  fileIds?: string[],
  autoSave = false,
): Promise<WorkflowResult> {
  // 1. Route — classify intent, decide tools
  const plan = route(query, fileIds);
  console.log(`[workflow] intent=${plan.intent} search=${plan.useSearch} files=${plan.useFiles}`);

  // 2. Parallel pre-fetch: files + search (only what the plan requires)
  const [docs, searchResults] = await Promise.all([
    plan.useFiles && fileIds ? processFiles(fileIds) : Promise.resolve([]),
    plan.useSearch           ? braveSearch(query).catch((e) => {
      console.warn('[workflow] search failed:', (e as Error).message);
      return [];
    }) : Promise.resolve([]),
  ]);

  // 3. Build context — intent hint + search results + file content
  const messages = buildContext(query, plan, docs, searchResults);

  // 4. Run through OpenClaw (keeps memory, tools, system prompt intact)
  const answer = await claw.run('chat', {
    userId,
    messages: messages as unknown as Message[],
  });

  // 5. Optionally auto-save insight to ideas vault
  let saved = false;
  if (autoSave && typeof answer === 'string') {
    const insight = extractInsight(answer, query);
    if (insight) {
      insight.user_id = userId;
      await saveInsight(insight).catch((e) =>
        console.warn('[workflow] auto-save failed:', (e as Error).message)
      );
      saved = true;
    }
  }

  return { answer: String(answer), intent: plan.intent, saved };
}
