import { createClient } from '@/lib/supabase/server';
import { Alert } from '../ui/alert';
import { Card, CardContent } from '../ui/card';
import { redirect } from 'next/navigation';

type InvitationLookupResult = {
  active: boolean;
  account_name: string | null;
  slug?: string | null;
  account_id?: string | null;
  was_used?: boolean;
};

function isInvitationLookupResult(
  value: unknown,
): value is InvitationLookupResult {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    typeof record.active === 'boolean' &&
    (typeof record.account_name === 'string' || record.account_name === null) &&
    (!('slug' in record) || typeof record.slug === 'string' || record.slug === null) &&
    (!('account_id' in record) || typeof record.account_id === 'string' || record.account_id === null) &&
    (!('was_used' in record) || typeof record.was_used === 'boolean')
  );
}

type Props = {
  token: string;
};
export default async function AcceptTeamInvitation({ token }: Props) {
  const supabaseClient = await createClient();
  const [{ data: authData }, { data, error }] = await Promise.all([
    supabaseClient.auth.getUser(),
    supabaseClient.rpc('lookup_invitation', {
      lookup_invitation_token: token,
    }),
  ]);

  const returnPath = `/invitation?token=${encodeURIComponent(token)}`;

  if (!authData?.user) {
    redirect(`/auth?returnUrl=${encodeURIComponent(returnPath)}`);
  }

  if (error || !isInvitationLookupResult(data)) {
    return (
      <Card className="bg-card border-subtle dark:border-white/10">
        <CardContent className="p-8 text-center flex flex-col gap-y-8">
          <Alert variant="destructive">
            {error?.message
              ? error.message
              : 'This invitation is invalid or has expired. Please contact the account owner for a new link.'}
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const invitation = data;
  const accountName = invitation.account_name ?? 'this account';

  if (invitation.active) {
    const { data: acceptData, error: acceptError } = await supabaseClient.rpc(
      'accept_invitation',
      {
        lookup_invitation_token: token,
      },
    );

    if (!acceptError && acceptData?.slug) {
      redirect(`/team/${acceptData.slug}`);
    }

    if (acceptError) {
      const message = acceptError.message ?? 'Unable to accept this invitation.';
      if (message.toLowerCase().includes('already a member')) {
        // already a member; redirect to team if we have slug, else dashboard
        if (invitation.slug) {
          redirect(`/team/${invitation.slug}`);
        }
        redirect('/dashboard');
      }
      return (
        <Card className="bg-card border-subtle dark:border-white/10">
          <CardContent className="p-8 text-center flex flex-col gap-y-8">
            <Alert variant="destructive">{message}</Alert>
          </CardContent>
        </Card>
      );
    }

    // should have redirected above; fallback
    redirect('/dashboard');
  }

  // Inactive invitation: if user is already a member of this account, send to team.
  if (invitation.slug) {
    redirect(`/team/${invitation.slug}`);
  }

  return (
    <Card className="bg-card border-subtle dark:border-white/10">
      <CardContent className="p-8 text-center flex flex-col gap-y-8">
        <div>
          <p>You've been invited to join</p>
          <h1 className="text-xl font-bold">{accountName}</h1>
        </div>
        <Alert variant="destructive">
          This invitation has been deactivated. Please contact the account owner
          for a new invitation.
        </Alert>
      </CardContent>
    </Card>
  );
}
