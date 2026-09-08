-- Create canvas_invites table for external collaboration
create table if not exists public.canvas_invites (
  id uuid primary key default uuid_generate_v4(),
  canvas_id text not null,
  workspace_id uuid not null,
  inviter_user_id uuid not null,
  code_hash text not null,
  expires_at timestamptz,
  max_uses integer,
  used_count integer not null default 0,
  allowed_email_domain text,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

-- Drop policies early to allow column type change if they already exist
drop policy if exists "canvas_invites_select_owner" on public.canvas_invites;
drop policy if exists "canvas_invites_insert_owner" on public.canvas_invites;
drop policy if exists "canvas_invites_update_owner" on public.canvas_invites;
drop policy if exists "canvas_invites_delete_owner" on public.canvas_invites;

-- If an earlier migration created workspace_id as text, coerce to uuid
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'canvas_invites'
      and column_name = 'workspace_id'
      and data_type = 'text'
  ) then
    alter table public.canvas_invites
      alter column workspace_id type uuid using workspace_id::uuid;
  end if;
end $$;

-- Indexes
create index if not exists idx_canvas_invites_canvas_id on public.canvas_invites(canvas_id);
create index if not exists idx_canvas_invites_workspace_id on public.canvas_invites(workspace_id);
create index if not exists idx_canvas_invites_status on public.canvas_invites(status);
create index if not exists idx_canvas_invites_expires_at on public.canvas_invites(expires_at);

-- RLS
alter table public.canvas_invites enable row level security;

create policy "canvas_invites_select_owner" on public.canvas_invites
  for select using (
    auth.uid() = inviter_user_id
    or auth.uid() in (
      select user_id from basejump.account_user where account_id = public.canvas_invites.workspace_id
    )
  );

create policy "canvas_invites_insert_owner" on public.canvas_invites
  for insert with check (
    auth.uid() = inviter_user_id
    or auth.uid() in (
      select user_id from basejump.account_user where account_id = public.canvas_invites.workspace_id
    )
  );

create policy "canvas_invites_update_owner" on public.canvas_invites
  for update using (
    auth.uid() = inviter_user_id
    or auth.uid() in (
      select user_id from basejump.account_user where account_id = public.canvas_invites.workspace_id
    )
  );

create policy "canvas_invites_delete_owner" on public.canvas_invites
  for delete using (
    auth.uid() = inviter_user_id
    or auth.uid() in (
      select user_id from basejump.account_user where account_id = public.canvas_invites.workspace_id
    )
  );
