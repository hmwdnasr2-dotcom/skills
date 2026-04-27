create table if not exists aria_ideas (
  id          uuid primary key default gen_random_uuid(),
  user_id     text not null,
  title       text not null,
  content     text,
  category    text default 'general',
  tags        text[],
  created_at  timestamptz default now()
);

create index if not exists aria_ideas_user_created
  on aria_ideas (user_id, created_at desc);
