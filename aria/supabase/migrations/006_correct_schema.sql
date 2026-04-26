-- ─── Migration 006: Correct schema to match connector expectations ────────────
--
-- Run this in the Supabase SQL Editor.
-- Safe to run multiple times (all statements use IF NOT EXISTS / IF EXISTS guards).
-- This corrects mismatches between migrations 003-005 and the actual connectors.
--

-- ─── Projects ─────────────────────────────────────────────────────────────────

create table if not exists aria_projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     text not null,
  name        text not null,
  description text,
  goal        text,
  outcome     text,
  priority    text not null default 'medium'
    check (priority in ('low', 'medium', 'high', 'urgent')),
  status      text not null default 'active'
    check (status in ('active', 'paused', 'completed')),
  end_date    date,
  updated_at  timestamptz,
  created_at  timestamptz default now()
);

-- Add columns to existing table if it was created by migration 003/004
alter table aria_projects add column if not exists description text;
alter table aria_projects add column if not exists outcome     text;
alter table aria_projects add column if not exists priority    text not null default 'medium';
alter table aria_projects add column if not exists end_date    date;
alter table aria_projects add column if not exists updated_at  timestamptz;
-- goal and status already added by 004 (if it ran)
alter table aria_projects add column if not exists goal   text;
alter table aria_projects add column if not exists status text not null default 'active';

create index if not exists aria_projects_user_id on aria_projects(user_id);
alter table aria_projects disable row level security;

-- ─── Tasks ────────────────────────────────────────────────────────────────────

create table if not exists aria_tasks (
  id           uuid primary key default gen_random_uuid(),
  user_id      text not null,
  title        text not null,
  project_id   uuid references aria_projects(id) on delete set null,
  description  text,
  priority     text not null default 'medium'
    check (priority in ('low', 'medium', 'high', 'urgent')),
  status       text not null default 'todo'
    check (status in ('todo', 'in_progress', 'completed', 'cancelled')),
  due_date     date,
  completed_at timestamptz,
  updated_at   timestamptz,
  created_at   timestamptz default now()
);

-- Add columns to existing table
alter table aria_tasks add column if not exists description  text;
alter table aria_tasks add column if not exists updated_at   timestamptz;
alter table aria_tasks add column if not exists priority     text not null default 'medium';
alter table aria_tasks add column if not exists due_date     date;
alter table aria_tasks add column if not exists completed_at timestamptz;

-- Widen the status check constraint to allow in_progress/completed/cancelled.
-- PostgreSQL won't let us ADD IF NOT EXISTS a check, so we drop-and-recreate.
do $$ begin
  alter table aria_tasks drop constraint if exists aria_tasks_status_check;
exception when others then null;
end $$;
alter table aria_tasks add constraint aria_tasks_status_check
  check (status in ('todo', 'in_progress', 'completed', 'cancelled'));

create index if not exists aria_tasks_user_id on aria_tasks(user_id);
create index if not exists aria_tasks_status  on aria_tasks(user_id, status);
alter table aria_tasks disable row level security;

-- ─── Follow-ups ───────────────────────────────────────────────────────────────

create table if not exists aria_follow_ups (
  id           uuid primary key default gen_random_uuid(),
  user_id      text not null,
  subject      text not null,
  with_person  text,
  due_date     date,
  status       text not null default 'pending'
    check (status in ('pending', 'done', 'overdue')),
  completed_at timestamptz,
  created_at   timestamptz default now()
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

-- ─── Daily Logs ───────────────────────────────────────────────────────────────

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

-- ─── Memory (required for core memory stack) ──────────────────────────────────

create table if not exists aria_memory (
  id         uuid primary key default gen_random_uuid(),
  user_id    text not null,
  content    text not null,
  created_at timestamptz default now()
);

create index if not exists aria_memory_user_id on aria_memory(user_id);
alter table aria_memory disable row level security;
