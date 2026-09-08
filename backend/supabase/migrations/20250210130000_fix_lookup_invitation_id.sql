-- Fix ambiguous column reference in lookup_invitation by qualifying invitation id
-- and ensure used_at exists for active/used logic.
alter table if exists basejump.invitations
    add column if not exists used_at timestamptz default null;

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
