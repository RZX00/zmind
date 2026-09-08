-- Restrict canvas share/list fields updates to owners
-- Timestamp: 2026-02-01

begin;

alter table if exists public.canvases enable row level security;

-- Replace broad workspace policy with explicit command policies
-- (keep public SELECT policy from canvas_public_share migration)
drop policy if exists "canvases_workspace_access" on public.canvases;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'canvases'
      and policyname = 'canvases_workspace_select'
  ) then
    create policy "canvases_workspace_select"
      on public.canvases
      for select
      using (basejump.has_role_on_account(account_id) = true);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'canvases'
      and policyname = 'canvases_workspace_insert'
  ) then
    create policy "canvases_workspace_insert"
      on public.canvases
      for insert
      with check (basejump.has_role_on_account(account_id) = true);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'canvases'
      and policyname = 'canvases_workspace_update'
  ) then
    create policy "canvases_workspace_update"
      on public.canvases
      for update
      using (basejump.has_role_on_account(account_id) = true)
      with check (
        basejump.has_role_on_account(account_id) = true
        and (
          basejump.has_role_on_account(account_id, 'owner') = true
          or (
            is_public = (select c.is_public from public.canvases c where c.id = id)
            and coalesce(public_shows_timeline, false) = coalesce((select c.public_shows_timeline from public.canvases c where c.id = id), false)
            and coalesce(timeline_enabled, false) = coalesce((select c.timeline_enabled from public.canvases c where c.id = id), false)
            and coalesce(is_listed, false) = coalesce((select c.is_listed from public.canvases c where c.id = id), false)
            and coalesce(listed_at, 'epoch'::timestamptz) = coalesce((select c.listed_at from public.canvases c where c.id = id), 'epoch'::timestamptz)
            and coalesce(author_user_id, '') = coalesce((select c.author_user_id from public.canvases c where c.id = id), '')
            and coalesce(author_display_name, '') = coalesce((select c.author_display_name from public.canvases c where c.id = id), '')
            and coalesce(author_avatar_url, '') = coalesce((select c.author_avatar_url from public.canvases c where c.id = id), '')
          )
        )
      );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'canvases'
      and policyname = 'canvases_workspace_delete'
  ) then
    create policy "canvases_workspace_delete"
      on public.canvases
      for delete
      using (basejump.has_role_on_account(account_id) = true);
  end if;
end
$$;

commit;
