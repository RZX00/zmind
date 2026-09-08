import ManageTeams from '@/components/basejump/manage-teams';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export default async function PersonalAccountTeamsPage() {
  return (
    <div>
      <ManageTeams />
    </div>
  );
}
