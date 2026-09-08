import { TriggersPage } from '@/components/triggers/triggers-page';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export default function TriggersRoute() {
  return <TriggersPage />;
}
