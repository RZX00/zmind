import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { SubmitButton } from '@/components/ui/submit-button';
import TeamUrlCopyButton from '@/components/basejump/team-url-copy-button';
import { editTeamName, editTeamSlug } from '@/lib/actions/teams';
import TeamMembersAndInvites from '@/components/basejump/team-members-and-invites';
import { getTeamUrlBase } from '@/lib/team-url';
import { createClient } from '@/lib/supabase/server';
import { getTranslations } from 'next-intl/server';
import { headers } from 'next/headers';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { FolderOpen } from 'lucide-react';

export default async function TeamSettingsPage({
  params,
}: {
  params: Promise<{ accountSlug: string }>;
}) {
  const { accountSlug } = await params;
  const t = await getTranslations('teamSettings');
  const headerList = await headers();
  const supabaseClient = await createClient();
  const { data: teamAccount, error } = await supabaseClient.rpc(
    'get_account_by_slug',
    { slug: accountSlug },
  );

  if (error) {
    return <div>{t('errors.loadFailed')}</div>;
  }
  if (!teamAccount) {
    return <div>{t('errors.notFound')}</div>;
  }

  const forwardedProto =
    headerList
      .get('x-forwarded-proto')
      ?.split(',')[0]
      ?.trim() ||
    (process.env.NODE_ENV === 'development' ? 'http' : 'https');
  const forwardedHost =
    headerList
      .get('x-forwarded-host')
      ?.split(',')[0]
      ?.trim() ||
    headerList.get('host') ||
    undefined;
  const requestOrigin = forwardedHost
    ? `${forwardedProto}://${forwardedHost}`
    : undefined;
  const teamUrlBase = `${getTeamUrlBase(requestOrigin)}/`;
  const isOwner =
    teamAccount.account_role === 'owner' ||
    teamAccount.is_primary_owner === true;
  const roleLabel = teamAccount.is_primary_owner
    ? t('roles.primaryOwner')
    : teamAccount.account_role === 'owner'
      ? t('roles.owner')
      : t('roles.member');

  if (!isOwner) {
    return (
      <div className="space-y-6">
        <div id="account">
          <h3 className="text-lg font-medium text-card-title dashboard-title">
            {t('title')}
          </h3>
          <p className="text-sm text-foreground/70">{t('description')}</p>
        </div>

        <Alert className="border-border/60 bg-muted/30">
          <AlertTitle>Owner-only settings</AlertTitle>
          <AlertDescription>
            You can view this team, but only owners can change team details or
            manage members.
          </AlertDescription>
        </Alert>

        <Card className="dashboard-panel">
          <CardHeader className="pb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base text-card-title">
                {t('account.title')}
              </CardTitle>
              <CardDescription>{t('account.description')}</CardDescription>
            </div>
            <Button
              variant="outline"
              className="gap-2 rounded-md shrink-0"
              asChild
            >
              <Link href={`/team/${teamAccount.slug}/workspace`}>
                <FolderOpen className="h-4 w-4" />
                <span>{t('account.openWorkspace')}</span>
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1">
                <dt className="text-sm text-foreground/70">
                  {t('account.teamName')}
                </dt>
                <dd className="text-sm font-medium text-card-title">
                  {teamAccount.name}
                </dd>
              </div>
              <div className="space-y-1">
                <dt className="text-sm text-foreground/70">
                  {t('labels.teamRole')}
                </dt>
                <dd className="text-sm font-medium text-card-title">
                  {roleLabel}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div id="account">
        <h3 className="text-lg font-medium text-card-title dashboard-title">
          {t('title')}
        </h3>
        <p className="text-sm text-foreground/70">{t('description')}</p>
      </div>

      {/* Compact Account card: workspace + name + slug */}
      <Card className="dashboard-panel">
        <CardHeader className="pb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-base text-card-title">
              {t('account.title')}
            </CardTitle>
            <CardDescription>{t('account.description')}</CardDescription>
          </div>
          <Button
            variant="outline"
            className="gap-2 rounded-md shrink-0"
            asChild
          >
            <Link href={`/team/${teamAccount.slug}/workspace`}>
              <FolderOpen className="h-4 w-4" />
              <span>{t('account.openWorkspace')}</span>
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Team Name (compact) */}
            <form className="space-y-2 min-w-0">
              <input
                type="hidden"
                name="accountId"
                value={teamAccount.account_id}
              />
              <Label htmlFor="name" className="text-foreground/90">
                {t('account.teamName')}
              </Label>
              <div className="flex flex-wrap gap-2 min-w-0">
                <Input
                  id="name"
                  name="name"
                  defaultValue={teamAccount.name}
                  required
                  className="h-9 rounded-md flex-1 min-w-0"
                />
                <SubmitButton
                  formAction={editTeamName}
                  pendingText={t('account.saving')}
                  fullWidth={false}
                  className="h-9 px-3 rounded-md shrink-0"
                >
                  {t('account.save')}
                </SubmitButton>
              </div>
            </form>

            {/* Team Slug (compact) */}
            <form className="space-y-2 min-w-0">
              <input
                type="hidden"
                name="accountId"
                value={teamAccount.account_id}
              />
              <Label htmlFor="slug-input" className="text-foreground/90">
                {t('account.teamUrl')}
              </Label>
              <div className="flex flex-wrap gap-2 items-stretch min-w-0">
                <div className="flex items-center rounded-md border border-border bg-muted/30 px-2 text-sm text-foreground/70 shrink-0 whitespace-nowrap">
                  {teamUrlBase}
                </div>
                <Input
                  id="slug-input"
                  name="slug"
                  defaultValue={teamAccount.slug}
                  required
                  className="h-9 rounded-md flex-1 min-w-0"
                />
                <TeamUrlCopyButton inputId="slug-input" origin={requestOrigin} />
                <SubmitButton
                  formAction={editTeamSlug}
                  pendingText={t('account.saving')}
                  fullWidth={false}
                  className="h-9 px-3 rounded-md shrink-0"
                >
                  {t('account.save')}
                </SubmitButton>
              </div>
            </form>
          </div>
        </CardContent>
      </Card>

      {/* Unified directory */}
      <div id="members" />
      <Card className="dashboard-panel">
        <CardHeader>
          <CardTitle className="text-base text-card-title">
            {t('members.title')}
          </CardTitle>
          <CardDescription>{t('members.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <TeamMembersAndInvites accountId={teamAccount.account_id} />
        </CardContent>
      </Card>
    </div>
  );
}
