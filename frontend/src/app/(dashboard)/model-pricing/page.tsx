export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

import { redirect } from 'next/navigation';

export default function ModelPricingPage() {
  redirect('/subscription');
}
