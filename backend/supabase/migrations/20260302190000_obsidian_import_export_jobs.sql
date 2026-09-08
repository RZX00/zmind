-- Obsidian compatibility jobs (import / export)

create table if not exists public.obsidian_import_jobs (
  id text primary key,
  account_id uuid not null,
  created_by uuid not null,
  source_type text not null check (source_type in ('zip', 'directory')),
  status text not null check (status in ('pending', 'running', 'completed', 'failed', 'partially_completed')),
  progress integer not null default 0,
  stats jsonb not null default '{}'::jsonb,
  uploaded_payload jsonb not null default '{}'::jsonb,
  report jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_obsidian_import_jobs_account_created
  on public.obsidian_import_jobs(account_id, created_at desc);

create table if not exists public.obsidian_export_jobs (
  id text primary key,
  account_id uuid not null,
  created_by uuid not null,
  scope_type text not null check (scope_type in ('workspace', 'folder')),
  scope_id text,
  status text not null check (status in ('pending', 'running', 'completed', 'failed')),
  progress integer not null default 0,
  stats jsonb not null default '{}'::jsonb,
  report jsonb not null default '{}'::jsonb,
  package_base64 text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_obsidian_export_jobs_account_created
  on public.obsidian_export_jobs(account_id, created_at desc);

