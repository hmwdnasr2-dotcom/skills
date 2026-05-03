-- Migration 008: Fix missing columns from earlier migrations

-- aria_follow_ups: add subject if table was created without it
alter table aria_follow_ups add column if not exists subject text;
update aria_follow_ups set subject = 'Follow-up' where subject is null;

-- aria_daily_logs: add mood if missing
alter table aria_daily_logs add column if not exists mood text;

-- aria_tasks: ensure completed_at and updated_at exist
alter table aria_tasks add column if not exists completed_at timestamptz;
alter table aria_tasks add column if not exists updated_at   timestamptz;
