# 3-Layer Memory

ARIA uses three memory layers with different scope, durability, and retrieval
mechanisms. OpenClaw manages the lifecycle — always use `ctx.memory.*` in pipelines,
never write to Supabase or pgvector directly.

| Layer | Scope | Storage | Retrieval |
|---|---|---|---|
| Working | Current pipeline run | In-process array | Direct (last N messages) |
| Short-term | Recent interactions (days) | Supabase rows | Recency + user filter |
| Long-term | Lifetime knowledge | pgvector embeddings | Semantic similarity search |

---

## Supabase setup

Enable the `vector` extension in your Supabase project, then run these migrations.

```sql
-- supabase/migrations/001_memory.sql

-- Short-term: recent conversation turns
create table if not exists aria_short_term_memory (
  id          uuid primary key default gen_random_uuid(),
  user_id     text not null,
  role        text not null check (role in ('user', 'assistant', 'tool')),
  content     text not null,
  created_at  timestamptz not null default now()
);
create index on aria_short_term_memory (user_id, created_at desc);

-- Long-term: semantic memory with 1536-dim embeddings (text-embedding-3-small)
-- Adjust dimensions to match your embedding model
create extension if not exists vector;

create table if not exists aria_long_term_memory (
  id          uuid primary key default gen_random_uuid(),
  user_id     text not null,
  content     text not null,
  embedding   vector(1536),
  metadata    jsonb default '{}',
  created_at  timestamptz not null default now()
);
create index on aria_long_term_memory
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);
```

---

## MemoryStack builder

```typescript
// src/core/memory/index.ts
import { WorkingMemory } from './working';
import { ShortTermMemory } from './shortTerm';
import { LongTermMemory } from './longTerm';
import { createClient } from '@supabase/supabase-js';

export function buildMemoryStack() {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!, // use service role — not anon key
  );

  return {
    working: new WorkingMemory({ maxMessages: 20 }),
    shortTerm: new ShortTermMemory({ supabase, maxRows: 50 }),
    longTerm: new LongTermMemory({ supabase, embeddingModel: 'text-embedding-3-small' }),

    /** Load all layers and merge into the working context. */
    async load(userId: string) {
      const recent = await this.shortTerm.load(userId);
      this.working.seed(recent);
    },

    /** Save the current turn to short-term and embed notable content to long-term. */
    async save(userId: string, messages: Message[], reply: ChatResponse) {
      await this.shortTerm.save(userId, messages, reply.content);
      if (isNotable(reply.content)) {
        await this.longTerm.upsert(userId, reply.content);
      }
    },

    /** Semantic recall — use before generating briefings or to answer "do you remember". */
    async recall(userId: string, query: string, topK = 5) {
      return this.longTerm.search(userId, query, topK);
    },
  };
}

type Message = { role: string; content: string };

function isNotable(text: string): boolean {
  // Heuristic: save to long-term if the reply is substantive (>200 chars)
  return text.length > 200;
}
```

---

## Working memory

Holds the in-context sliding window. Trimmed to `maxMessages` before each brain call.

```typescript
// src/core/memory/working.ts
import type { Message } from '../brain/adapter';

export class WorkingMemory {
  private messages: Message[] = [];
  private maxMessages: number;

  constructor({ maxMessages = 20 }: { maxMessages?: number }) {
    this.maxMessages = maxMessages;
  }

  seed(messages: Message[]) {
    this.messages = messages.slice(-this.maxMessages);
  }

  append(message: Message) {
    this.messages.push(message);
    if (this.messages.length > this.maxMessages) {
      // Drop oldest non-system messages first
      const systemMessages = this.messages.filter((m) => m.role === 'system');
      const rest = this.messages.filter((m) => m.role !== 'system');
      this.messages = [...systemMessages, ...rest.slice(-this.maxMessages + systemMessages.length)];
    }
  }

  get(): Message[] {
    return [...this.messages];
  }

  clear() {
    this.messages = [];
  }
}
```

---

## Short-term memory (Supabase)

Persists the last N turns per user. Loaded at the start of every pipeline run to
seed the working context.

```typescript
// src/core/memory/shortTerm.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Message } from '../brain/adapter';

export class ShortTermMemory {
  constructor(
    private supabase: SupabaseClient,
    private maxRows: number = 50,
  ) {}

  async load(userId: string): Promise<Message[]> {
    const { data, error } = await this.supabase
      .from('aria_short_term_memory')
      .select('role, content')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(this.maxRows);

    if (error) throw error;
    return (data ?? []).reverse() as Message[];
  }

  async save(userId: string, messages: Message[], assistantReply: string) {
    const rows = [
      ...messages.map((m) => ({ user_id: userId, role: m.role, content: m.content })),
      { user_id: userId, role: 'assistant', content: assistantReply },
    ];

    const { error } = await this.supabase
      .from('aria_short_term_memory')
      .insert(rows);

    if (error) throw error;
    await this.trim(userId);
  }

  private async trim(userId: string) {
    // Delete oldest rows beyond maxRows
    const { data } = await this.supabase
      .from('aria_short_term_memory')
      .select('id')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (!data || data.length <= this.maxRows) return;

    const toDelete = data.slice(this.maxRows).map((r) => r.id);
    await this.supabase.from('aria_short_term_memory').delete().in('id', toDelete);
  }
}
```

---

## Long-term memory (pgvector)

Embeds content and stores as vectors. Similarity search drives recall and briefing
generation.

```typescript
// src/core/memory/longTerm.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import OpenAI from 'openai'; // used only for embeddings; brain can still be Claude

export class LongTermMemory {
  private openai: OpenAI;
  private embeddingModel: string;

  constructor(
    private supabase: SupabaseClient,
    { embeddingModel = 'text-embedding-3-small' }: { embeddingModel?: string } = {},
  ) {
    this.openai = new OpenAI();
    this.embeddingModel = embeddingModel;
  }

  async upsert(userId: string, content: string, metadata: Record<string, unknown> = {}) {
    const embedding = await this.embed(content);

    const { error } = await this.supabase.from('aria_long_term_memory').insert({
      user_id: userId,
      content,
      embedding,
      metadata,
    });

    if (error) throw error;
  }

  async search(userId: string, query: string, topK = 5) {
    const embedding = await this.embed(query);

    const { data, error } = await this.supabase.rpc('aria_match_memories', {
      query_embedding: embedding,
      match_user_id: userId,
      match_count: topK,
    });

    if (error) throw error;
    return (data ?? []) as Array<{ content: string; similarity: number }>;
  }

  private async embed(text: string): Promise<number[]> {
    const res = await this.openai.embeddings.create({
      model: this.embeddingModel,
      input: text,
    });
    return res.data[0].embedding;
  }
}
```

### Supabase RPC for semantic search

```sql
-- supabase/migrations/002_search_fn.sql
create or replace function aria_match_memories(
  query_embedding vector(1536),
  match_user_id   text,
  match_count     int default 5
)
returns table (content text, similarity float)
language sql stable
as $$
  select content, 1 - (embedding <=> query_embedding) as similarity
  from aria_long_term_memory
  where user_id = match_user_id
  order by embedding <=> query_embedding
  limit match_count;
$$;
```

---

## Environment variables

```bash
# .env.example
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key  # never expose this client-side
OPENAI_API_KEY=sk-...                             # only needed for embeddings
ANTHROPIC_API_KEY=sk-ant-...                      # for the default ClaudeBrain
```

---

## Memory access patterns

**Loading context before a pipeline:**
```typescript
// In a pipeline handler
await ctx.memory.load(ctx.userId);
// ctx.memory.working.get() now contains the last N messages
```

**Semantic recall for briefing generation:**
```typescript
const memories = await ctx.memory.recall(ctx.userId, 'tasks and commitments', 10);
const memoryBlock = memories.map((m) => m.content).join('\n---\n');
// Inject memoryBlock into the system prompt before calling ctx.brain.chat()
```

**Saving a turn:**
```typescript
// After getting a brain reply
await ctx.memory.save(ctx.userId, ctx.messages, reply);
// Automatically trims short-term and embeds notable content to long-term
```
