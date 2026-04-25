-- 005_structured_data.sql
-- Full rebuild: drop legacy tables and recreate with complete schema.
-- Cascade handles FK dependency (aria_tasks → aria_projects).

drop table if exists aria_reports      cascade;
drop table if exists aria_contacts     cascade;
drop table if exists aria_daily_logs   cascade;
drop table if exists aria_achievements cascade;
drop table if exists aria_follow_ups   cascade;
drop table if exists aria_tasks        cascade;
drop table if exists aria_projects     cascade;

-- ─── Projects ─────────────────────────────────────────────────────────────────

create table aria_projects (
  id          uuid        primary key default gen_random_uuid(),
  user_id     text        not null,
  name        text        not null,
  description text,
  status      text        not null default 'active'
              check (status in ('active', 'paused', 'completed')),
  priority    text        not null default 'medium'
              check (priority in ('low', 'medium', 'high', 'urgent')),
  start_date  date,
  end_date    date,
  goal        text,
  outcome     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index aria_projects_user_id on aria_projects(user_id);
create index aria_projects_status  on aria_projects(user_id, status);
alter table aria_projects disable row level security;

-- ─── Tasks ────────────────────────────────────────────────────────────────────

create table aria_tasks (
  id           uuid        primary key default gen_random_uuid(),
  user_id      text        not null,
  title        text        not null,
  description  text,
  project_id   uuid        references aria_projects(id) on delete set null,
  status       text        not null default 'todo'
               check (status in ('todo', 'in_progress', 'completed', 'cancelled')),
  priority     text        not null default 'medium'
               check (priority in ('low', 'medium', 'high', 'urgent')),
  due_date     date,
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index aria_tasks_user_id on aria_tasks(user_id);
create index aria_tasks_status  on aria_tasks(user_id, status);
create index aria_tasks_project on aria_tasks(project_id);
create index aria_tasks_due     on aria_tasks(user_id, due_date) where due_date is not null;
alter table aria_tasks disable row level security;

-- ─── Follow-ups ───────────────────────────────────────────────────────────────

create table aria_follow_ups (
  id            uuid        primary key default gen_random_uuid(),
  user_id       text        not null,
  contact_name  text        not null,
  contact_email text,
  context       text        not null,
  status        text        not null default 'pending'
                check (status in ('pending', 'done', 'overdue')),
  due_date      date,
  resolved_at   timestamptz,
  created_at    timestamptz not null default now()
);

create index aria_follow_ups_user_id on aria_follow_ups(user_id);
create index aria_follow_ups_status  on aria_follow_ups(user_id, status);
alter table aria_follow_ups disable row level security;

-- ─── Achievements ─────────────────────────────────────────────────────────────

create table aria_achievements (
  id            uuid        primary key default gen_random_uuid(),
  user_id       text        not null,
  title         text        not null,
  description   text,
  impact        text,
  project_id    uuid        references aria_projects(id) on delete set null,
  category      text        not null default 'professional'
                check (category in ('personal', 'professional', 'financial', 'health')),
  date_achieved date        not null default current_date,
  created_at    timestamptz not null default now()
);

create index aria_achievements_user_id on aria_achievements(user_id);
create index aria_achievements_project on aria_achievements(project_id) where project_id is not null;
alter table aria_achievements disable row level security;

-- ─── Daily logs ───────────────────────────────────────────────────────────────

create table aria_daily_logs (
  id                  uuid        primary key default gen_random_uuid(),
  user_id             text        not null,
  date                date        not null default current_date,
  summary             text        not null,
  tasks_completed     int         not null default 0,
  follow_ups_resolved int         not null default 0,
  notes               text,
  created_at          timestamptz not null default now(),
  unique (user_id, date)
);

create index aria_daily_logs_user_id on aria_daily_logs(user_id);
alter table aria_daily_logs disable row level security;

-- ─── Contacts ─────────────────────────────────────────────────────────────────

create table aria_contacts (
  id           uuid        primary key default gen_random_uuid(),
  user_id      text        not null,
  name         text        not null,
  email        text,
  company      text,
  role         text,
  relationship text        not null default 'team'
               check (relationship in ('client', 'partner', 'team', 'vendor')),
  notes        text,
  created_at   timestamptz not null default now()
);

create index aria_contacts_user_id on aria_contacts(user_id);
alter table aria_contacts disable row level security;

-- ─── Reports ──────────────────────────────────────────────────────────────────

create table aria_reports (
  id           uuid        primary key default gen_random_uuid(),
  user_id      text        not null,
  type         text        not null
               check (type in ('weekly', 'monthly', 'quarterly', 'yearly')),
  period_start date        not null,
  period_end   date        not null,
  content      jsonb       not null,
  generated_at timestamptz not null default now()
);

create index aria_reports_user_id on aria_reports(user_id);
alter table aria_reports disable row level security;
