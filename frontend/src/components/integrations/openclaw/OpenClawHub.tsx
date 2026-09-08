'use client';

import { useEffect, useMemo, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  AlertCircle,
  CheckCircle2,
  History,
  Loader2,
  RefreshCcw,
  Shield,
  Sparkles,
  Undo2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import {
  OpenClawCapability,
  OpenClawRole,
  useOpenClawActivity,
  useOpenClawState,
  useRollbackOpenClawActivity,
  useUpdateOpenClawSettings,
} from '@/hooks/react-query/integrations/use-openclaw-integration';

const capabilityGroups: Array<{
  id: string;
  capabilities: OpenClawCapability[];
}> = [
  {
    id: 'read',
    capabilities: ['canvas.read', 'doc.read'],
  },
  {
    id: 'write',
    capabilities: [
      'canvas.create',
      'canvas.write',
      'doc.create',
      'doc.write',
      'rollback.execute',
    ],
  },
];

function formatRelativeDate(
  value: string | null | undefined,
  fmt: ReturnType<typeof useFormatter>,
) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return fmt.dateTime(date, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function OpenClawHub() {
  const t = useTranslations('openclawIntegration');
  const fmt = useFormatter();
  const stateQuery = useOpenClawState();
  const activityQuery = useOpenClawActivity(20);
  const updateSettings = useUpdateOpenClawSettings();
  const rollbackActivity = useRollbackOpenClawActivity();

  const settings = stateQuery.data?.settings;
  const hasSettings = Boolean(settings);
  const [enabled, setEnabled] = useState(false);
  const [roles, setRoles] = useState<OpenClawRole[]>(['owner']);
  const [capabilities, setCapabilities] = useState<OpenClawCapability[]>([]);
  const workspaceRole = settings?.workspace_role ?? null;
  const canManageSettings = workspaceRole === 'owner';
  const rollbackCapabilityEnabled = Boolean(
    settings?.allowed_capabilities?.includes('rollback.execute'),
  );
  const canExecuteRollback =
    hasSettings && canManageSettings && rollbackCapabilityEnabled;

  useEffect(() => {
    if (!settings) return;
    setEnabled(Boolean(settings.enabled));
    setRoles(settings.allowed_roles || ['owner']);
    setCapabilities(settings.allowed_capabilities || []);
  }, [settings]);

  const initialState = useMemo(
    () => ({
      enabled: Boolean(settings?.enabled),
      roles: JSON.stringify(settings?.allowed_roles || ['owner']),
      capabilities: JSON.stringify(settings?.allowed_capabilities || []),
    }),
    [settings],
  );

  const dirty = useMemo(() => {
    return (
      enabled !== initialState.enabled ||
      JSON.stringify(roles) !== initialState.roles ||
      JSON.stringify(capabilities) !== initialState.capabilities
    );
  }, [capabilities, enabled, initialState, roles]);

  const toggleRole = (role: OpenClawRole, checked: boolean) => {
    setRoles((current) => {
      const next = checked
        ? [...current, role]
        : current.filter((item) => item !== role);
      return next.length > 0 ? Array.from(new Set(next)) : ['owner'];
    });
  };

  const toggleCapability = (
    capability: OpenClawCapability,
    checked: boolean,
  ) => {
    setCapabilities((current) => {
      const next = checked
        ? [...current, capability]
        : current.filter((item) => item !== capability);
      return Array.from(new Set(next));
    });
  };

  const handleSave = async () => {
    try {
      await updateSettings.mutateAsync({
        enabled,
        allowed_roles: roles,
        allowed_capabilities: capabilities,
      });
      toast.success(t('toasts.saved'));
    } catch (error: any) {
      toast.error(error?.message || t('toasts.saveFailed'));
    }
  };

  const handleRollback = async (activityId: string) => {
    try {
      await rollbackActivity.mutateAsync(activityId);
      toast.success(t('toasts.rollbackSuccess'));
    } catch (error: any) {
      toast.error(error?.message || t('toasts.rollbackFailed'));
    }
  };

  const roleOptions: Array<{
    value: OpenClawRole;
    label: string;
    description: string;
  }> = [
    {
      value: 'owner',
      label: t('roles.owner.label'),
      description: t('roles.owner.description'),
    },
    {
      value: 'member',
      label: t('roles.member.label'),
      description: t('roles.member.description'),
    },
  ];

  const capabilityMeta: Record<
    OpenClawCapability,
    { label: string; description: string }
  > = {
    'canvas.read': {
      label: t('capabilities.canvasRead.label'),
      description: t('capabilities.canvasRead.description'),
    },
    'canvas.create': {
      label: t('capabilities.canvasCreate.label'),
      description: t('capabilities.canvasCreate.description'),
    },
    'canvas.write': {
      label: t('capabilities.canvasWrite.label'),
      description: t('capabilities.canvasWrite.description'),
    },
    'doc.read': {
      label: t('capabilities.docRead.label'),
      description: t('capabilities.docRead.description'),
    },
    'doc.create': {
      label: t('capabilities.docCreate.label'),
      description: t('capabilities.docCreate.description'),
    },
    'doc.write': {
      label: t('capabilities.docWrite.label'),
      description: t('capabilities.docWrite.description'),
    },
    'rollback.execute': {
      label: t('capabilities.rollbackExecute.label'),
      description: t('capabilities.rollbackExecute.description'),
    },
  };

  return (
    <div className="space-y-4">
      {stateQuery.error ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{t('errors.loadTitle')}</AlertTitle>
          <AlertDescription>
            {(stateQuery.error as Error).message || t('errors.loadDescription')}
          </AlertDescription>
        </Alert>
      ) : null}

      <Card className="border-border/70">
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <CardTitle>{t('status.title')}</CardTitle>
              <Badge variant={enabled ? 'default' : 'secondary'}>
                {enabled ? t('status.enabled') : t('status.disabled')}
              </Badge>
            </div>
            <CardDescription>{t('status.description')}</CardDescription>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-border/70 px-3 py-2">
            <div className="text-right">
              <div className="text-sm font-medium">
                {t('status.toggleLabel')}
              </div>
              <div className="text-xs text-muted-foreground">
                {t('status.toggleHint')}
              </div>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              disabled={!canManageSettings || updateSettings.isPending}
            />
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
            <div className="mb-1 flex items-center gap-2 text-sm font-medium">
              <Sparkles className="h-4 w-4 text-muted-foreground" />
              {t('status.lastVerified')}
            </div>
            <div className="text-sm text-muted-foreground">
              {formatRelativeDate(
                stateQuery.data?.settings.last_verified_at,
                fmt,
              ) || t('status.neverVerified')}
            </div>
          </div>
          <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
            <div className="mb-1 flex items-center gap-2 text-sm font-medium">
              <History className="h-4 w-4 text-muted-foreground" />
              {t('status.recentActivity')}
            </div>
            <div className="text-sm text-muted-foreground">
              {stateQuery.data?.stats.recent_activity_count ?? 0}
            </div>
          </div>
          <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
            <div className="mb-1 flex items-center gap-2 text-sm font-medium">
              <Undo2 className="h-4 w-4 text-muted-foreground" />
              {t('status.pendingRollbacks')}
            </div>
            <div className="text-sm text-muted-foreground">
              {stateQuery.data?.stats.pending_rollbacks ?? 0}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1.4fr,1fr]">
        <Card className="border-border/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-4 w-4" />
              {t('access.title')}
            </CardTitle>
            <CardDescription>{t('access.description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {hasSettings && !canManageSettings ? (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>{t('access.ownerOnlyTitle')}</AlertTitle>
                <AlertDescription>
                  {t('access.ownerOnlyDescription')}
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="space-y-3">
              <div className="text-sm font-medium">
                {t('access.rolesTitle')}
              </div>
              {roleOptions.map((role) => (
                <label
                  key={role.value}
                  className="flex items-start gap-3 rounded-2xl border border-border/70 px-4 py-3"
                >
                  <Checkbox
                    checked={roles.includes(role.value)}
                    disabled={!canManageSettings || updateSettings.isPending}
                    onCheckedChange={(checked) =>
                      toggleRole(role.value, Boolean(checked))
                    }
                  />
                  <div className="space-y-1">
                    <div className="text-sm font-medium">{role.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {role.description}
                    </div>
                  </div>
                </label>
              ))}
            </div>

            <Separator />

            <div className="space-y-4">
              <div className="text-sm font-medium">
                {t('access.capabilitiesTitle')}
              </div>
              {capabilityGroups.map((group) => (
                <div key={group.id} className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t(`access.groups.${group.id}`)}
                  </div>
                  <div className="space-y-2">
                    {group.capabilities.map((capability) => (
                      <label
                        key={capability}
                        className="flex items-start gap-3 rounded-2xl border border-border/70 px-4 py-3"
                      >
                        <Checkbox
                          checked={capabilities.includes(capability)}
                          disabled={
                            !canManageSettings || updateSettings.isPending
                          }
                          onCheckedChange={(checked) =>
                            toggleCapability(capability, Boolean(checked))
                          }
                        />
                        <div className="space-y-1">
                          <div className="text-sm font-medium">
                            {capabilityMeta[capability].label}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {capabilityMeta[capability].description}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={() => void handleSave()}
                disabled={
                  !settings ||
                  !dirty ||
                  updateSettings.isPending ||
                  !canManageSettings
                }
              >
                {updateSettings.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                {dirty ? t('access.save') : t('access.saved')}
              </Button>
              <span className="text-xs text-muted-foreground">
                {t('access.helper')}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardHeader>
            <CardTitle>{t('guide.title')}</CardTitle>
            <CardDescription>{t('guide.description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {['one', 'two', 'three'].map((step) => (
              <div
                key={step}
                className="rounded-2xl border border-border/70 bg-background/70 p-4"
              >
                <div className="mb-1 text-sm font-medium">
                  {t(`guide.steps.${step}.title`)}
                </div>
                <div className="text-sm text-muted-foreground">
                  {t(`guide.steps.${step}.description`)}
                </div>
              </div>
            ))}

            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>{t('guide.tipTitle')}</AlertTitle>
              <AlertDescription>{t('guide.tipDescription')}</AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/70">
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>{t('activity.title')}</CardTitle>
            <CardDescription>{t('activity.description')}</CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void activityQuery.refetch()}
            disabled={activityQuery.isFetching}
          >
            {activityQuery.isFetching ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCcw className="mr-2 h-4 w-4" />
            )}
            {t('activity.refresh')}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {activityQuery.isLoading ? (
            <div className="rounded-2xl border border-border/70 px-4 py-6 text-sm text-muted-foreground">
              {t('activity.loading')}
            </div>
          ) : null}

          {!activityQuery.isLoading && !activityQuery.data?.items.length ? (
            <div className="rounded-2xl border border-dashed border-border/70 px-4 py-6 text-sm text-muted-foreground">
              {t('activity.empty')}
            </div>
          ) : null}

          {activityQuery.data?.items.map((item) => (
            <div
              key={item.id}
              className="flex flex-col gap-3 rounded-2xl border border-border/70 px-4 py-4 md:flex-row md:items-center md:justify-between"
            >
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-sm font-medium">
                    {item.summary || item.operation_key}
                  </div>
                  <Badge
                    variant={
                      item.status === 'rolled_back' ? 'secondary' : 'outline'
                    }
                  >
                    {t(`activity.status.${item.status}`)}
                  </Badge>
                  <Badge variant="outline">{item.operation_key}</Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatRelativeDate(item.created_at, fmt) ||
                    t('activity.unknownTime')}
                  {item.tool_name ? ` · ${item.tool_name}` : ''}
                  {item.resource_id ? ` · ${item.resource_id}` : ''}
                </div>
                {item.rollback_error ? (
                  <div className="text-xs text-rose-600 dark:text-rose-400">
                    {item.rollback_error}
                  </div>
                ) : null}
              </div>

              <div className="flex items-center gap-2">
                {item.can_rollback && canExecuteRollback ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleRollback(item.id)}
                    disabled={rollbackActivity.isPending}
                  >
                    {rollbackActivity.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Undo2 className="mr-2 h-4 w-4" />
                    )}
                    {t('activity.rollback')}
                  </Button>
                ) : item.can_rollback && hasSettings ? (
                  <div className="text-xs text-muted-foreground">
                    {canManageSettings
                      ? t('activity.rollbackDisabled')
                      : t('activity.rollbackOwnerOnly')}
                  </div>
                ) : item.rollback_status === 'completed' ? (
                  <div className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-4 w-4" />
                    {t('activity.rollbackDone')}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
