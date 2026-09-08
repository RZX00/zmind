'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { PlugZap } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { ComposioConnectionsSection } from '@/components/integrations/composio-connections-section';
import { ComposioRegistry } from '@/components/agents/composio/composio-registry';
import { Button } from '@/components/ui/button';
import { useWorkspace } from '@/contexts/workspace-context';
import { buildTeamScopedPath } from '@/lib/workspace-path';

const IntegrationsPane: React.FC = () => {
  const t = useTranslations('openclawIntegration.settingsPane');
  const { teamSlug } = useWorkspace();
  const openclawPath = buildTeamScopedPath('/integrations/openclaw', teamSlug);

  return (
    <div className="flex h-full flex-col overflow-y-auto text-foreground">
      <div className="mb-4 rounded-2xl border border-border bg-background/60 p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium">
          <PlugZap className="h-4 w-4" />
          {t('title')}
        </div>
        <p className="mb-3 text-xs text-muted-foreground">{t('description')}</p>
        <Button asChild size="sm" variant="outline">
          <Link href={openclawPath}>{t('cta')}</Link>
        </Button>
      </div>

      <div className="shrink-0">
        <ComposioConnectionsSection />
      </div>

      <div className="mt-4 flex-1 min-h-0 border-t border-border pt-4">
        <h4 className="mb-2 text-xs font-semibold text-muted-foreground">App marketplace</h4>
        <div className="mt-2 h-full overflow-hidden rounded-md border border-border bg-background/60">
          <ComposioRegistry mode="profile-only" />
        </div>
      </div>
    </div>
  );
};

export default IntegrationsPane;
