-- Migration 007: Report Templates
-- Stores user-defined report formats so ARIA can recreate them on demand.
-- Covers: monthly reports, minutes of meeting, custom layouts, etc.

create table if not exists aria_report_templates (
  id            uuid        primary key default gen_random_uuid(),
  user_id       text        not null,
  name          text        not null,
  description   text,
  template_json jsonb       not null default '{}',
  sample        text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  unique (user_id, name)
);

create index if not exists aria_report_templates_user_id
  on aria_report_templates (user_id, updated_at desc);

alter table aria_report_templates disable row level security;
