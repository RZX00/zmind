import AcceptTeamInvitation from '@/components/basejump/accept-team-invitation';
import { redirect } from 'next/navigation';

type InvitationSearchParams = {
  token?: string;
};

type AcceptInvitationPageProps = {
  searchParams: Promise<InvitationSearchParams>;
};

export default async function AcceptInvitationPage({
  searchParams,
}: AcceptInvitationPageProps) {
  const resolvedSearchParams = await searchParams;

  const token = resolvedSearchParams.token;

  if (!token) {
    redirect('/');
  }

  return (
    <div className="max-w-md mx-auto w-full my-12">
      <AcceptTeamInvitation token={token} />
    </div>
  );
}
