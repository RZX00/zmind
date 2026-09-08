-- Align invitation lookup permissions with login-gated flow.
-- Allow authenticated users to view valid (24h) invitations while keeping owners full visibility.

drop policy if exists "Invitations viewable by account owners" on basejump.invitations;
drop policy if exists "Invitations viewable by valid token holders" on basejump.invitations;

create policy "Invitations viewable by valid token holders" on basejump.invitations
    for select
    to authenticated
    using (
        created_at > (now() - interval '24 hours')
    );

create policy "Invitations viewable by account owners" on basejump.invitations
    for select
    to authenticated
    using (
        basejump.has_role_on_account(account_id, 'owner') = true
    );
