import { createClient } from '@supabase/supabase-js';

function db() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
}

export interface InsightRecord {
  user_id:  string;
  title:    string;
  content:  string;
  category: string;
  tags:     string[];
}

export function extractInsight(answer: string, query: string): InsightRecord | null {
  const trimmed = answer.trim();
  if (trimmed.length < 80) return null; // too short to be worth saving

  // First sentence or first 120 chars as title
  const title = (trimmed.match(/^[^.!?\n]{10,120}/)?.[0] ?? trimmed.slice(0, 100)).trim();

  // Categorise by query keywords
  const q = query.toLowerCase();
  const category =
    /market|sales|revenue|profit|growth|finance/i.test(q) ? 'business' :
    /code|build|architect|implement|deploy|tech/i.test(q)  ? 'technical' :
    /excel|pdf|report|spreadsheet|data|analyse/i.test(q)   ? 'general'   :
    /idea|concept|vision|strategy/i.test(q)                ? 'business'  : 'general';

  const tags = ['workflow', 'auto-saved'];
  if (/file|document|excel|pdf/i.test(q)) tags.push('document-analysis');
  if (/search|research|latest/i.test(q))  tags.push('research');

  return { user_id: '', title, content: trimmed.slice(0, 1000), category, tags };
}

export async function saveInsight(insight: InsightRecord): Promise<void> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) return;

  const { error } = await db().from('aria_ideas').insert({
    user_id:  insight.user_id,
    title:    insight.title,
    content:  insight.content,
    category: insight.category,
    tags:     insight.tags,
  });

  if (error) throw new Error(`[memory] saveInsight failed: ${error.message}`);
}
