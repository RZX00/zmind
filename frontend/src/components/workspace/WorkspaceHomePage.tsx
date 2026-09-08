'use client';

import { useTranslations } from 'next-intl';
import { PlugZap } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import CanvasWorkspace from '@/canvas/components/workspace/CanvasWorkspace';
import { useWorkspace } from '@/contexts/workspace-context';
import { buildTeamScopedPath } from '@/lib/workspace-path';
import { useOpenClawState } from '@/hooks/react-query/integrations/use-openclaw-integration';

export default function WorkspaceHomePage() {
  const t = useTranslations();
  const { teamSlug } = useWorkspace();
  const openclawPath = buildTeamScopedPath('/integrations/openclaw', teamSlug);
  const openclawState = useOpenClawState();
  const bridgeEnabled = Boolean(openclawState.data?.settings.enabled);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden px-4 py-5 md:px-6">
      <div className="mx-auto w-full max-w-7xl pb-4">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t('workspace.title', { default: 'Workspace' })}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('workspace.description', {
            default: 'Create a new canvas or doc, then jump between your work without losing context.',
          })}
        </p>
        <Card className="mt-4 border-border/70 bg-card/80">
          <CardContent className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <PlugZap className="h-4 w-4 text-muted-foreground" />
                <div className="text-sm font-medium">
                  {t('workspace.openclawCard.title', {
                    default: 'Let OpenClaw work on your real canvas and docs',
                  })}
                </div>
                <Badge variant={bridgeEnabled ? 'default' : 'secondary'}>
                  {bridgeEnabled
                    ? t('workspace.openclawCard.enabled', { default: 'Enabled' })
                    : t('workspace.openclawCard.disabled', { default: 'Disabled' })}
                </Badge>
              </div>
              <div className="text-sm text-muted-foreground">
                {t('workspace.openclawCard.description', {
                  default: 'Choose who can use OpenClaw, what it can edit, and roll back risky changes from one place.',
                })}
              </div>
            </div>
            <Button asChild variant={bridgeEnabled ? 'outline' : 'default'}>
              <Link href={openclawPath}>
                {bridgeEnabled
                  ? t('workspace.openclawCard.manage', { default: 'Manage OpenClaw' })
                  : t('workspace.openclawCard.setup', { default: 'Set up OpenClaw' })}
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
      <div className="min-h-0 flex-1">
        <CanvasWorkspace
          className="h-full bg-transparent"
          hideBackground
          maxWidthClass="max-w-none"
          gridClassName="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-6 py-4"
        />
      </div>
    </div>
  );
}
