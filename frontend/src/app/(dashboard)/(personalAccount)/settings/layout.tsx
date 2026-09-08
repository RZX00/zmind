'use client';

import { Separator } from '@/components/ui/separator';

export default function PersonalAccountSettingsPage({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="dashboard-page space-y-6 w-full">
      <Separator className="border-subtle dark:border-white/10" />
      <div className="dashboard-container">
        <div className="mx-auto w-full lg:w-3/5 min-w-0">
          {children}
        </div>
      </div>
    </div>
  );
}
