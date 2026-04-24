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
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const working = new WorkingMemory({ maxMessages: 20 });
  const shortTerm = new ShortTermMemory({ supabase, maxRows: 50 });
  const longTerm = new LongTermMemory({ supabase });

  return {
    working,
    shortTerm,
    longTerm,

    async load(userId: string) {
      const recent = await shortTerm.load(userId);
      working.seed(recent);
    },

    async save(userId: string, messages: Message[], reply: ChatResponse) {
      await shortTerm.save(userId, messages, reply.content);
      if (reply.content.length > 200) {
        await longTerm.upsert(userId, reply.content);
      }
    },

    async recall(userId: string, query: string, topK = 5) {
      return longTerm.search(userId, query, topK);
    },
  };
}
