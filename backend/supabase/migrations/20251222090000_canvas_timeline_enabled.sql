-- Add per-canvas timeline recording toggle (default off)

alter table if exists public.canvases
  add column if not exists timeline_enabled boolean not null default false;

create index if not exists idx_canvases_timeline_enabled on public.canvases(timeline_enabled);
