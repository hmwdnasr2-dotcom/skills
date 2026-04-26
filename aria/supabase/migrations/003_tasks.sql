-- Projects
create table if not exists aria_projects (
  id         uuid primary key default gen_random_uuid(),
  user_id    text not null,
  name       text not null,
  created_at timestamptz default now()
);

-- Tasks
create table if not exists aria_tasks (
  id         uuid primary key default gen_random_uuid(),
  user_id    text not null,
  title      text not null,
  project_id uuid references aria_projects(id) on delete set null,
  status     text not null default 'todo' check (status in ('todo', 'done')),
  created_at timestamptz default now()
);

-- Indexes for per-user queries
create index if not exists aria_tasks_user_id    on aria_tasks(user_id);
create index if not exists aria_projects_user_id on aria_projects(user_id);

-- RLS off for a personal assistant (single-tenant)
alter table aria_tasks    disable row level security;
alter table aria_projects disable row level security;
