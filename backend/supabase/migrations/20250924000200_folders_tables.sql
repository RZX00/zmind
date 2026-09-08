-- Folders table for Canvas organization

create table if not exists public.folders (
  id text primary key,
  account_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  parent_id text null references public.folders(id) on delete set null,
  is_expanded boolean not null default false,
  sort_order bigint null,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_folders_account on public.folders(account_id, updated_at desc) where is_deleted = false;

