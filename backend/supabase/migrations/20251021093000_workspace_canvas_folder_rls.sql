-- Align canvases/folders with Basejump accounts and enforce workspace RLS

begin;

-- 1) Update canvases.account_id FK to reference basejump.accounts
alter table if exists public.canvases
    drop constraint if exists canvases_account_id_fkey;

alter table if exists public.canvases
    add constraint canvases_account_id_fkey
        foreign key (account_id)
        references basejump.accounts(id)
        on delete cascade;

-- 2) Update folders.account_id FK similarly
alter table if exists public.folders
    drop constraint if exists folders_account_id_fkey;

alter table if exists public.folders
    add constraint folders_account_id_fkey
        foreign key (account_id)
        references basejump.accounts(id)
        on delete cascade;

-- 3) Ensure RLS is enabled
alter table if exists public.canvases enable row level security;
alter table if exists public.folders enable row level security;

-- 4) Workspace-scoped policies (skip if already present)
do $$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'canvases'
          and policyname = 'canvases_workspace_access'
    ) then
        create policy canvases_workspace_access
            on public.canvases
            for all
            using (basejump.has_role_on_account(account_id) = true)
            with check (basejump.has_role_on_account(account_id) = true);
    end if;
end
$$;

do $$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'folders'
          and policyname = 'folders_workspace_access'
    ) then
        create policy folders_workspace_access
            on public.folders
            for all
            using (basejump.has_role_on_account(account_id) = true)
            with check (basejump.has_role_on_account(account_id) = true);
    end if;
end
$$;

commit;
