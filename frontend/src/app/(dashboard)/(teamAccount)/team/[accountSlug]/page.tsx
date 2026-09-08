import { redirect } from 'next/navigation';

export default async function AccountRedirect({
  params,
}: {
  params: Promise<{ accountSlug: string }>;
}) {
  const { accountSlug } = await params;
  redirect(`/team/${accountSlug}/workspace`);
}
