export type Intent = 'chat' | 'research' | 'file_analysis' | 'hybrid' | 'action';

export interface ExecutionPlan {
  intent: Intent;
  useSearch: boolean;
  useFiles: boolean;
  systemHint: string;
}

const SEARCH_RX = /\b(latest|news|current|today|2025|2026|best|compare|versus|vs\b|price|stock|trending|recent|update|what is|who is|how much)\b/i;
const ACTION_RX = /\b(add task|create task|remind me|set reminder|send email|draft email|save idea|create project|add to)\b/i;

const HINTS: Record<Intent, string> = {
  research:      'Search the web before answering. Cite sources inline.',
  file_analysis: 'Analyse the attached document thoroughly. Extract key insights, data points, and action items. After analysis, ask if the user wants to save findings.',
  hybrid:        'Analyse the attached document and supplement with current web data where relevant. Cite sources.',
  action:        'Execute the requested action using the available tools. Confirm what was done.',
  chat:          '',
};

export function route(query: string, fileIds?: string[]): ExecutionPlan {
  const hasFiles   = (fileIds?.length ?? 0) > 0;
  const needSearch = SEARCH_RX.test(query);
  const isAction   = ACTION_RX.test(query);

  let intent: Intent;
  if (isAction)                   intent = 'action';
  else if (hasFiles && needSearch) intent = 'hybrid';
  else if (hasFiles)               intent = 'file_analysis';
  else if (needSearch)             intent = 'research';
  else                             intent = 'chat';

  return {
    intent,
    useSearch: needSearch || intent === 'research',
    useFiles:  hasFiles,
    systemHint: HINTS[intent],
  };
}
