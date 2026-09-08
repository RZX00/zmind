-- Canvas event timeline for fine-grained playback

create table if not exists public.canvas_events (
  id uuid primary key default gen_random_uuid(),
  canvas_id text not null references public.canvases(id) on delete cascade,
  account_id uuid null references auth.users(id) on delete set null,
  user_id uuid null references auth.users(id) on delete set null,
  batch_id uuid null,
  seq integer not null default 0,
  op_type text null,
  op jsonb not null,
  doc_after jsonb null,
  is_checkpoint boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_canvas_events_canvas_time on public.canvas_events(canvas_id, created_at asc);
create index if not exists idx_canvas_events_batch on public.canvas_events(batch_id, seq asc);

comment on table public.canvas_events is 'Per-operation timeline for canvases (public playback supported when canvas is public and timeline enabled).';
comment on column public.canvas_events.doc_after is 'Full Canvas Document after applying the operation (used for playback; may be null for non-checkpoint events).';

