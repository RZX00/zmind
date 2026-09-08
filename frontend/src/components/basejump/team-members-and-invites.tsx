import { createClient } from '@/lib/supabase/server';
import TeamMembersAndInvitesClient from './team-members-and-invites-client';

type Props = {
  accountId: string;
};

export default async function TeamMembersAndInvites({ accountId }: Props) {
  const supabaseClient = await createClient();

  const [{ data: members }, { data: invitations }, { data: auth }] = await Promise.all([
    supabaseClient.rpc('get_account_members', { account_id: accountId }),
    supabaseClient.rpc('get_account_invitations', { account_id: accountId }),
    supabaseClient.auth.getUser(),
  ]);

  const currentUserId = auth?.user?.id;
  const isPrimaryOwner = Boolean(
    members?.find((m: any) => m.user_id === currentUserId)?.is_primary_owner,
  );

  return (
    <TeamMembersAndInvitesClient
      accountId={accountId}
      members={members || []}
      invitations={invitations || []}
      isPrimaryOwner={isPrimaryOwner}
      currentUserId={currentUserId || null}
    />
  );
}

