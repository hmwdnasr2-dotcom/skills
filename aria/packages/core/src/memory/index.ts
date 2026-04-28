import { createClient } from '@supabase/supabase-js';
import type { ChatResponse, Message } from '../brain/adapter.js';
import { LongTermMemory } from './longTerm.js';
import { ShortTermMemory } from './shortTerm.js';
import { WorkingMemory } from './working.js';

export type { WorkingMemory, ShortTermMemory, LongTermMemory };

export interface MemoryStack {
  working: WorkingMemory;
  shortTerm: ShortTermMemory;
  longTerm: LongTermMemory;
  load(userId: string): Promise<void>;
  save(userId: string, messages: Message[], reply: ChatResponse): Promise<void>;
  recall(
    userId: string,
    query: string,
    topK?: number,
  ): Promise<Array<{ content: string; similarity: number }>>;
}

export function buildMemoryStack(): MemoryStack {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  const hasSupabase = Boolean(url && key);

  if (!hasSupabase) {
    console.warn('[memory] SUPABASE_URL / SUPABASE_ANON_KEY not set — running with working memory only (no persistence)');
  }

  const supabase = hasSupabase
    ? createClient(url!, key!)
    : null;

  const hasOpenAI = Boolean(process.env.OPENAI_API_KEY);

  const working = new WorkingMemory({ maxMessages: 20 });
  const shortTerm = supabase ? new ShortTermMemory({ supabase, maxRows: 50 }) : null;
  const longTerm  = supabase && hasOpenAI ? new LongTermMemory({ supabase }) : null;

  if (supabase && !hasOpenAI) {
    console.warn('[memory] OPENAI_API_KEY not set — long-term vector memory disabled');
  }

  return {
    working,
    shortTerm: shortTerm as unknown as ShortTermMemory,
    longTerm:  longTerm  as unknown as LongTermMemory,

    async load(userId: string) {
      if (!shortTerm) return;
      const recent = await shortTerm.load(userId);
      working.seed(recent);
    },

    async save(userId: string, messages: Message[], reply: ChatResponse) {
      if (!shortTerm) return;
      await shortTerm.save(userId, messages, reply.content);
      if (longTerm && reply.content.length > 200) {
        await longTerm.upsert(userId, reply.content);
      }
    },

    async recall(userId: string, query: string, topK = 5) {
      if (!longTerm) return [];
      return longTerm.search(userId, query, topK);
    },
  };
}
