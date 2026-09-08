-- Separate public access (is_public) from discoverability (is_listed)
-- so that unlisted public canvases won't appear in the Explore page.

-- 1) Add listing columns to canvases
alter table if exists public.canvases
  add column if not exists is_listed boolean not null default false,
  add column if not exists listed_at timestamp with time zone null;

-- 2) Recreate lightweight public view for Explore: only list listed + public canvases
drop view if exists public.public_canvases_v1 cascade;
create or replace view public.public_canvases_v1 as
  select
    c.id,
    c.title,
    c.preview_url,
    c.is_public,
    c.is_listed,
    c.public_shows_timeline,
    c.author_user_id,
    c.author_display_name,
    c.author_avatar_url,
    c.created_at,
    c.updated_at,
    c.listed_at
  from public.canvases c
  where coalesce(c.is_deleted, false) = false
    and coalesce(c.is_public, false) = true
    and coalesce(c.is_listed, false) = true
  order by coalesce(c.listed_at, c.updated_at) desc nulls last;

