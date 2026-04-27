-- Reminders table for ARIA timed notifications
create table if not exists aria_reminders (
  id         uuid        primary key default gen_random_uuid(),
  user_id    text        not null,
  message    text        not null,
  remind_at  timestamptz not null,
  sent       boolean     not null default false,
  created_at timestamptz not null default now()
);

create index if not exists aria_reminders_due_idx
  on aria_reminders (sent, remind_at)
  where sent = false;
