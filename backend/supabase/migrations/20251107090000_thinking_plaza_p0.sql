-- P0: Thinking Plaza support (public explore page)
-- Adds preview_url and public_shows_timeline to canvases, author fields,
-- creates a lightweight public view, and tightens messages RLS to honor
-- the per-canvas timeline visibility toggle.

-- 1) Columns for public explore and author display
alter table if exists public.canvases
  add column if not exists preview_url text,
  add column if not exists public_shows_timeline boolean not null default false,
  add column if not exists author_user_id text,
  add column if not exists author_display_name text,
  add column if not exists author_avatar_url text;

-- 2) Lightweight public view for anonymous listing
drop view if exists public.public_canvases_v1 cascade;
create or replace view public.public_canvases_v1 as
  select
    c.id,
    c.title,
    c.preview_url,
    c.is_public,
    c.public_shows_timeline,
    c.author_user_id,
    c.author_display_name,
    c.author_avatar_url,
    c.created_at,
    c.updated_at
  from public.canvases c
  where coalesce(c.is_deleted, false) = false
    and coalesce(c.is_public, false) = true
  order by c.updated_at desc nulls last;

-- 3) RLS: messages only public when canvas is public AND timeline is enabled
-- Recreate the policy from 20251008090000_canvas_public_share.sql with the extra condition
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
        and coalesce(c.public_shows_timeline, false) = true
    )
  );

-- Note: canvases table already has public SELECT policy gated by is_public=true
-- from 20251008090000_canvas_public_share.sql

