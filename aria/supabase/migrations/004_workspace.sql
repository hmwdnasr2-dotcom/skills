-- ─── Enhance existing tables ─────────────────────────────────────────────────

alter table aria_tasks
  add column if not exists due_date      date,
  add column if not exists priority      text not null default 'medium'
    check (priority in ('low', 'medium', 'high', 'urgent')),
  add column if not exists completed_at  timestamptz;

alter table aria_projects
  add column if not exists goal      text,
  add column if not exists deadline  date,
  add column if not exists status    text not null default 'active'
    check (status in ('active', 'completed', 'on-hold', 'cancelled'));

-- ─── Follow-ups ───────────────────────────────────────────────────────────────

create table if not exists aria_follow_ups (
  id           uuid primary key default gen_random_uuid(),
  user_id      text not null,
  subject      text not null,
  with_person  text,
  due_date     date,
  status       text not null default 'pending'
    check (status in ('pending', 'done', 'overdue')),
  created_at   timestamptz default now(),
  completed_at timestamptz
);

create index if not exists aria_follow_ups_user_id on aria_follow_ups(user_id);
create index if not exists aria_follow_ups_status  on aria_follow_ups(user_id, status);

alter table aria_follow_ups disable row level security;

-- ─── Achievements ─────────────────────────────────────────────────────────────

create table if not exists aria_achievements (
  id          uuid primary key default gen_random_uuid(),
  user_id     text not null,
  title       text not null,
  description text,
  category    text not null default 'general'
    check (category in ('work', 'personal', 'learning', 'health', 'general')),
  logged_at   timestamptz default now()
);

create index if not exists aria_achievements_user_id on aria_achievements(user_id);

alter table aria_achievements disable row level security;

-- ─── Daily logs ───────────────────────────────────────────────────────────────

create table if not exists aria_daily_logs (
  id         uuid primary key default gen_random_uuid(),
  user_id    text not null,
  date       date not null default current_date,
  summary    text not null,
  mood       text,
  created_at timestamptz default now(),
  unique (user_id, date)
);

create index if not exists aria_daily_logs_user_id on aria_daily_logs(user_id);

alter table aria_daily_logs disable row level security;
