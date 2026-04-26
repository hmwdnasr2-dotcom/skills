-- Enable pgvector extension (must be done once per Supabase project)
create extension if not exists vector;

-- Short-term memory: recent conversation turns per user
create table if not exists aria_short_term_memory (
  id         uuid primary key default gen_random_uuid(),
  user_id    text not null,
  role       text not null check (role in ('user', 'assistant', 'tool')),
  content    text not null,
  created_at timestamptz not null default now()
);

create index if not exists aria_short_term_memory_user_created
  on aria_short_term_memory (user_id, created_at desc);

-- Long-term memory: semantic embeddings via pgvector
-- Dimensions: 1536 for text-embedding-3-small (OpenAI)
-- Adjust if you switch embedding models
create table if not exists aria_long_term_memory (
  id         uuid primary key default gen_random_uuid(),
  user_id    text not null,
  content    text not null,
  embedding  vector(1536),
  metadata   jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- IVFFlat index for approximate nearest-neighbour cosine search
-- lists=100 is appropriate for tables up to ~1M rows; increase for larger datasets
create index if not exists aria_long_term_memory_embedding
  on aria_long_term_memory
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

create index if not exists aria_long_term_memory_user_id
  on aria_long_term_memory (user_id);
