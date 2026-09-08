"use client";

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import TeamMemberOptions from './team-member-options';
import DeleteTeamInvitationButton from './delete-team-invitation-button';
import NewInvitationForm from './new-invitation-form';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { User, Clock, Plus, Search } from 'lucide-react';

type Props = {
  accountId: string;
  members: any[];
  invitations: any[];
  currentUserId: string | null;
  isPrimaryOwner: boolean;
};

type StatusFilter = 'all' | 'active' | 'pending' | 'owner';

export default function TeamMembersAndInvitesClient({
  accountId,
  members,
  invitations,
  currentUserId,
  isPrimaryOwner,
}: Props) {
  const t = useTranslations('teamSettings');
  const locale = useLocale();
  const timeLocale = locale === 'zh' ? zhCN : undefined;
  const [query, setQuery] = useState('');
  const [filter] = useState<StatusFilter>('all');
  const [showNewInvite, setShowNewInvite] = useState(false);

  const counts = useMemo(() => {
    return {
      members: members?.length ?? 0,
      invites: invitations?.length ?? 0,
    };
  }, [members, invitations]);

  const merged = useMemo(() => {
    const normalizedMembers = (members || []).map((m) => ({
      kind: 'member' as const,
      id: m.user_id as string,
      name: m.name as string,
      email: m.email as string,
      role: m.is_primary_owner ? 'primary_owner' : (m.account_role as string),
      createdAt: m.created_at as string | undefined,
      raw: m,
    }));
    const normalizedInvites = (invitations || []).map((inv) => ({
      kind: 'invite' as const,
      id: inv.invitation_id as string,
      name: '',
      email: '',
      role: inv.account_role as string,
      inviteType: inv.invitation_type as string,
      createdAt: inv.created_at as string,
      raw: inv,
    }));

    return [...normalizedMembers, ...normalizedInvites];
  }, [members, invitations]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return merged.filter((item) => {
      // status filter
      if (filter === 'active' && item.kind !== 'member') return false;
      if (filter === 'pending' && item.kind !== 'invite') return false;
      if (filter === 'owner' && !(item.kind === 'member' && (item.role === 'owner' || item.role === 'primary_owner'))) return false;

      // query filter on name/email
      if (!q) return true;
      const hay = `${item.name || ''} ${item.email || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [merged, query, filter]);

  const roleLabels = {
    owner: t('roles.owner'),
    member: t('roles.member'),
    primary_owner: t('roles.primaryOwner'),
  };
  const inviteTypeLabels = {
    '24_hour': t('invites.type24h'),
    one_time: t('invites.typeOneTime'),
  };
  const formatRoleLabel = (role: string) =>
    roleLabels[role as keyof typeof roleLabels] || role;
  const formatInviteType = (type: string) =>
    inviteTypeLabels[type as keyof typeof inviteTypeLabels] || type;

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="rounded-[var(--canvas-panel-radius)] border border-border/60 bg-background/70 px-3 py-2 shadow-[0_2px_10px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap items-center gap-3 min-w-0">
          <div className="flex items-center gap-2 text-sm">
            <Badge variant="outline" className="text-foreground/80 border-subtle dark:border-white/10">
              {t('members.membersCount', { count: counts.members })}
            </Badge>
            <Badge variant="outline" className="text-foreground/80 border-subtle dark:border-white/10">
              {t('members.pendingCount', { count: counts.invites })}
            </Badge>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2 w-full sm:w-auto min-w-0">
            <div className="relative w-full sm:w-64 min-w-0">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-foreground/50" />
              <Input
                placeholder={t('members.searchPlaceholder')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-8 h-9 rounded-md min-w-0"
              />
            </div>
            <Button size="sm" className="rounded-md" onClick={() => setShowNewInvite((s) => !s)}>
              <Plus className="size-4" /> {t('members.newInvite')}
            </Button>
          </div>
        </div>
      </div>

      {/* Unified list */}
      <div className="rounded-[var(--canvas-panel-radius)] border border-border/60 bg-background/80 overflow-hidden [&>div:not(:first-child)]:border-t [&>div:not(:first-child)]:border-border/60">
        {filtered.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">{t('members.noResults')}</div>
        ) : (
          filtered.map((item) => {
            if (item.kind === 'member') {
              const roleLabel = formatRoleLabel(item.role);
              return (
                <div key={`m-${item.id}`} className="flex items-center gap-3 p-3 hover:bg-muted/30 transition-colors">
                  <div className="size-8 rounded-full border border-border/60 bg-muted/40 text-muted-foreground flex items-center justify-center">
                    <User className="size-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                      <span className="font-medium text-card-title truncate">{item.name || item.email}</span>
                      <Badge
                        variant={item.role === 'owner' || item.role === 'primary_owner' ? 'default' : 'outline'}
                        className={item.role === 'owner' || item.role === 'primary_owner' ? 'bg-primary hover:bg-primary/90' : 'text-foreground/70 border-subtle dark:border-white/10'}
                      >
                        {roleLabel}
                      </Badge>
                    </div>
                    {item.email && (
                      <div className="text-xs text-foreground/70 truncate">{item.email}</div>
                    )}
                  </div>
                  {/* Actions */}
                  {/* hide options for primary owner */}
                  {!(item.role === 'primary_owner') && (
                    <TeamMemberOptions
                      teamMember={item.raw}
                      accountId={accountId}
                      isPrimaryOwner={isPrimaryOwner}
                    />
                  )}
                </div>
              );
            }
            // invite row
            const inviteTypeLabel = formatInviteType(item.inviteType);
            const inviteRoleLabel = formatRoleLabel(item.role);
            const relativeTime = formatDistanceToNow(new Date(item.createdAt), {
              addSuffix: true,
              locale: timeLocale,
            });
            return (
              <div key={`i-${item.id}`} className="flex items-center gap-3 p-3 hover:bg-muted/30 transition-colors">
                <div className="size-8 rounded-full border border-border/60 bg-muted/40 text-muted-foreground flex items-center justify-center">
                  <Clock className="size-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    <span className="font-medium text-card-title">{t('members.pendingInvite')}</span>
                    <Badge variant="outline" className="text-foreground/70 border-subtle dark:border-white/10">{inviteTypeLabel}</Badge>
                    <Badge variant="outline" className="text-foreground/70 border-subtle dark:border-white/10">{inviteRoleLabel}</Badge>
                  </div>
                  <div className="text-xs text-foreground/70">
                    {t('members.created', { time: relativeTime })}
                  </div>
                </div>
                <DeleteTeamInvitationButton invitationId={item.id} />
              </div>
            );
          })
        )}
      </div>

      {/* Inline new invite */}
      {showNewInvite && (
        <div className="rounded-[var(--canvas-panel-radius)] border border-border/60 bg-background/80 p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="font-medium text-card-title">{t('members.newInvite')}</div>
            <Button variant="ghost" size="sm" onClick={() => setShowNewInvite(false)}>{t('members.close')}</Button>
          </div>
          <Separator className="my-2" />
          <NewInvitationForm accountId={accountId} />
        </div>
      )}
    </div>
  );
}
