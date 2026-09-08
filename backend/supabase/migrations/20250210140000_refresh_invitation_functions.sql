-- Ensure invitation functions keep rows for redirect and return slug even after use.
-- Safe to run repeatedly; does not touch triggers/tables beyond adding used_at column if needed.

alter table if exists basejump.invitations
    add column if not exists used_at timestamptz default null;

create or replace function public.accept_invitation(lookup_invitation_token text)
    returns jsonb
    language plpgsql
    security definer set search_path = public, basejump
as
$$
declare
    lookup_account_id       uuid;
    new_member_role         basejump.account_role;
    lookup_account_slug     text;
begin
    select i.account_id, i.account_role, a.slug
    into lookup_account_id, new_member_role, lookup_account_slug
    from basejump.invitations i
             join basejump.accounts a on a.id = i.account_id
    where i.token = lookup_invitation_token
      and i.created_at > now() - interval '24 hours';

    if lookup_account_id IS NULL then
        raise exception 'Invitation not found';
    end if;

    begin
        insert into basejump.account_user (account_id, user_id, account_role)
        values (lookup_account_id, auth.uid(), new_member_role);

        update basejump.invitations
        set used_at = now()
        where token = lookup_invitation_token
          and invitation_type = 'one_time';
    exception
        when unique_violation then
            -- already a member; keep going so slug is returned
            null;
    end;

    return json_build_object(
            'account_id', lookup_account_id,
            'account_role', new_member_role,
            'slug', lookup_account_slug
           );
end;
$$;

create or replace function public.lookup_invitation(lookup_invitation_token text)
    returns json
    language plpgsql
    security definer set search_path = public, basejump
as
$$
declare
    name              text;
    invitation_active boolean;
    account_slug      text;
    account_id_val    uuid;
    was_used          boolean;
begin
    select i.account_name,
           case when i.id IS NOT NULL and i.used_at is null then true else false end as active,
           a.slug,
           i.account_id,
           i.used_at is not null as was_used_flag
    into name, invitation_active, account_slug, account_id_val, was_used
    from basejump.invitations i
             join basejump.accounts a on a.id = i.account_id
    where i.token = lookup_invitation_token
      and i.created_at > now() - interval '24 hours'
    limit 1;

    return json_build_object(
            'active', coalesce(invitation_active, false),
            'account_name', name,
            'slug', account_slug,
            'account_id', account_id_val,
            'was_used', coalesce(was_used, false)
           );
end;
$$;
