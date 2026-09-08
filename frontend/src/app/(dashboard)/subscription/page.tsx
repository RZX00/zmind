export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

import PricingPageClient from '@/components/pricing/PricingPageClient';

export default function SubscriptionPage() {
  return <PricingPageClient />;
}

