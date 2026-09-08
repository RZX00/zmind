-- Canvas public sharing: add is_public and RLS policies to allow read-only public access
-- Timestamp: 2025-10-08

-- 1) Add is_public column to canvases if not exists
alter table if exists public.canvases
  add column if not exists is_public boolean not null default false;

create index if not exists idx_canvases_is_public on public.canvases(is_public);

-- 2) RLS policies for public read access
-- Ensure RLS is enabled (no-op if already enabled)
alter table if exists public.canvases enable row level security;
alter table if exists public.threads enable row level security;
alter table if exists public.messages enable row level security;

-- Allow public SELECT on canvases when is_public = true
drop policy if exists "Public canvases are viewable" on public.canvases;
create policy "Public canvases are viewable"
  on public.canvases for select
  using (is_public = true);

-- Allow selecting threads that are bound to a public canvas
drop policy if exists "View threads for public canvases" on public.threads;
create policy "View threads for public canvases"
  on public.threads for select
  using (
    canvas_id is not null and exists (
      select 1 from public.canvases c
      where c.id = public.threads.canvas_id and c.is_public = true
    )
  );

-- Allow selecting messages if their thread belongs to a public canvas
drop policy if exists "View messages for public canvases" on public.messages;
create policy "View messages for public canvases"
  on public.messages for select
  using (
    exists (
      select 1
      from public.threads t
      join public.canvases c on c.id = t.canvas_id
      where t.thread_id = public.messages.thread_id
        and c.is_public = true
    )
  );

-- Note: We intentionally do NOT open write access publicly.
-- Existing owner/member policies continue to govern non-public access.

