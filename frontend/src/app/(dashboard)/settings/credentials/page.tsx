'use client';

import React, { useEffect } from 'react';
import { 
  Zap
} from 'lucide-react';
import { ComposioConnectionsSection } from '@/components/integrations/composio-connections-section';
import { PageHeader } from '@/components/ui/page-header';
import { ENABLE_INTEGRATIONS } from '@/lib/flags';

export default function AppProfilesPage() {

  return (
    <div className="dashboard-page">
      <div className="dashboard-container space-y-8">
        <PageHeader icon={Zap}>
          <span className="text-primary">App Credentials</span>
        </PageHeader>
        {ENABLE_INTEGRATIONS ? (
          <ComposioConnectionsSection />
        ) : null}
      </div>
    </div>
  );
} 
