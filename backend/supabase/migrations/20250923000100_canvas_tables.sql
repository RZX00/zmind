-- Canvas tables for Zmind

create table if not exists public.canvases (
  id text primary key,
  account_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid null references public.projects(project_id) on delete set null,
  title text not null,
  doc jsonb not null,
  version text not null default '1.0.0',
  is_deleted boolean not null default false,
  deleted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_canvases_account_updated on public.canvases(account_id, updated_at desc);
-- Ensure required soft-delete columns exist on already-existing installations
alter table if exists public.canvases
  add column if not exists is_deleted boolean not null default false;
alter table if exists public.canvases
  add column if not exists deleted_at timestamptz null;
create index if not exists idx_canvases_deleted_at on public.canvases(is_deleted, deleted_at);
create index if not exists idx_canvases_doc_gin on public.canvases using gin(doc);

-- Optional versions table for history
create table if not exists public.canvas_versions (
  id uuid primary key default gen_random_uuid(),
  canvas_id text not null references public.canvases(id) on delete cascade,
  version_doc jsonb not null,
  is_auto_save boolean not null default false,
  description text null,
  created_at timestamptz not null default now()
);

create index if not exists idx_canvas_versions_canvas_id on public.canvas_versions(canvas_id, created_at desc);

comment on table public.canvases is 'Canvas documents stored as JSONB';
comment on column public.canvases.doc is 'Complete Canvas Document (nodes, connections, metadata, timestamps, version)';

--
-- Threads binding to canvases (1-1 binding) and soft-delete window support
--

-- Ensure threads table has a canvas_id column referencing canvases
alter table if exists public.threads
  add column if not exists canvas_id text null references public.canvases(id) on delete cascade;

-- One canvas maps to at most one thread
create unique index if not exists ux_threads_canvas_id on public.threads(canvas_id) where canvas_id is not null;

-- Optional soft-delete flags for threads (kept simple; UI hides trashed by canvas)
alter table if exists public.threads
  add column if not exists is_deleted boolean not null default false,
  add column if not exists deleted_at timestamptz null;

--
-- Purge helper: permanently remove canvases soft-deleted older than N days
-- (will cascade-remove bound thread/messages/agent_runs if FKs are set; otherwise delete manually)
--
create or replace function public.purge_deleted_canvases(days integer default 15)
returns integer
language plpgsql
as $$
declare
  v_cutoff timestamptz := now() - make_interval(days => days);
  v_count integer := 0;
begin
  -- Manually delete dependent rows to be safe across environments
  with doomed as (
    select id from public.canvases where is_deleted = true and deleted_at is not null and deleted_at < v_cutoff
  ), tdel as (
    select thread_id from public.threads where canvas_id in (select id from doomed)
  )
  delete from public.messages where thread_id in (select thread_id from tdel);

  with doomed as (
    select id from public.canvases where is_deleted = true and deleted_at is not null and deleted_at < v_cutoff
  ), tdel as (
    select thread_id from public.threads where canvas_id in (select id from doomed)
  )
  delete from public.agent_runs where thread_id in (select thread_id from tdel);

  -- delete threads
  with doomed as (
    select id from public.canvases where is_deleted = true and deleted_at is not null and deleted_at < v_cutoff
  )
  delete from public.threads where canvas_id in (select id from doomed);

  -- finally delete canvases
  with doomed as (
    select id from public.canvases where is_deleted = true and deleted_at is not null and deleted_at < v_cutoff
  )
  delete from public.canvases c using doomed d where c.id = d.id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  return v_count;
end;
$$;

comment on function public.purge_deleted_canvases is 'Hard-delete canvases soft-deleted beyond retention window and related thread/messages/agent_runs.';
