import { redirect } from 'next/navigation';

export default async function TeamMembersPage({
  params,
}: {
  params: Promise<{ accountSlug: string }>;
}) {
  const { accountSlug } = await params;
  redirect(`/team/${accountSlug}/settings#members`);
}
