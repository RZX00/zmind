-- Backfill: make previously public canvases listed too, so they appear on Explore
update public.canvases
set is_listed = true,
    listed_at = coalesce(listed_at, updated_at, now())
where is_public = true
  and coalesce(is_listed, false) = false;

