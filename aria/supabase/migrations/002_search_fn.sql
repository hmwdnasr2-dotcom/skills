-- Semantic similarity search for long-term memory
-- Returns rows ordered by cosine similarity (highest first)
create or replace function aria_match_memories(
  query_embedding vector(1536),
  match_user_id   text,
  match_count     int default 5
)
returns table (content text, similarity float)
language sql stable
as $$
  select
    content,
    1 - (embedding <=> query_embedding) as similarity
  from aria_long_term_memory
  where user_id = match_user_id
    and embedding is not null
  order by embedding <=> query_embedding
  limit match_count;
$$;
