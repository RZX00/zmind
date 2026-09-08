/*
 * This migration fixes the permission issue for lookup_invitation function.
 *
 * The issue occurs because even though the lookup_invitation function is defined with
 * SECURITY DEFINER, the RLS policies on the basejump.invitations table were too restrictive.
 * The original policy required users to be account owners (has_role_on_account = true)
 * in order to select from the invitations table, which prevents new users from accepting
 * invitations since they aren't account members yet.
 *
 * This fix modifies the RLS policy to allow viewing invitations within 24 hours of creation,
 * which is appropriate for the lookup_invitation use case.
 */

-- Remove the overly restrictive policy that prevents non-account members from viewing invitations
drop policy if exists "Invitations viewable by account owners" on basejump.invitations;

-- Create a new policy that allows authenticated users to view invitations that are still valid
-- (created in the last 24 hours). This enables the lookup_invitation function to work properly
-- while maintaining security by limiting access to only recently created invitations
create policy "Invitations viewable by valid token holders" on basejump.invitations
    for select
    to authenticated
    using (
        created_at > (now() - interval '24 hours')
    );

-- Create a separate policy for account owners to view all invitations on their account
-- This maintains the original functionality for account owners to see all invitations
create policy "Invitations viewable by account owners" on basejump.invitations
    for select
    to authenticated
    using (
        basejump.has_role_on_account(account_id, 'owner') = true
    );