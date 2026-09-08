// Admin dashboard pages depend on authenticated, highly dynamic client state.
// Disable static generation to avoid SSR importing client-only modules during prerender.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import AdminBillingClient from './admin-billing-client';

export default function AdminBillingPage() {
  return <AdminBillingClient />;
}
