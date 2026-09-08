'use client';

import * as React from 'react';
import { useRouter, Link } from '@/i18n/routing';
import {
  BadgeCheck,
  Bell,
  ChevronDown,
  ChevronsUpDown,
  ChevronRight,
  Command,
  LogOut,
  Plus,
  Settings,
  User,
  AudioWaveform,
  Globe,
  BookOpen,
  KeyRound,
  Plug,
  Zap,
  Sparkle,
  Shield,
  DollarSign,
  Sparkles,
  Users,
  BarChart3,
  FileText,
  Brain,
  Database,
  Keyboard,
} from 'lucide-react';
import dynamic from 'next/dynamic';
const NewTeamForm = dynamic(() => import('@/components/basejump/new-team-form'), { ssr: false });

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuPortal,
} from '@/components/ui/dropdown-menu';
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { createClient } from '@/lib/supabase/client';
import {useLocale, useTranslations} from 'next-intl';
import {usePathname} from '@/i18n/routing';
import {persistLocalePreference, localizePathname, AppLocale} from '@/i18n/locales';
import {useRouter as useNextRouter} from 'next/navigation';
import { isLocalMode } from '@/lib/config';
import { clearUserLocalStorage } from '@/lib/utils/clear-local-storage';
import { BillingModal } from '@/components/billing/billing-modal';
import { ENABLE_INTEGRATIONS } from '@/lib/flags';
import { useSettingsStore } from '@/canvas/stores/settings.store';
import { useWorkspace } from '@/contexts/workspace-context';
import { buildTeamScopedPath, buildWorkspacePath } from '@/lib/workspace-path';
import { useSubscriptionContext } from '@/contexts/SubscriptionContext';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ThemeMenuSub } from '@/components/theme/theme-switcher';

const normalizePlanName = (value?: string | null) => {
  if (!value) return 'Free';
  const key = value.toLowerCase();
  if (key.includes('plus') || key === 'tier_2_20') return 'Plus';
  if (key.includes('pro') || key === 'tier_6_50') return 'Pro';
  if (
    key.includes('max') ||
    key.includes('ultra') ||
    ['tier_12_100', 'tier_25_200', 'tier_50_400', 'tier_125_800', 'tier_200_1000'].includes(key)
  ) {
    return 'MAX';
  }
  if (key.includes('free') || key === 'none') return 'Free';
  if (key.includes('enterprise')) return 'Enterprise';
  if (key.includes('business')) return 'Business';
  if (key.includes('scale')) return 'Scale';
  if (key.includes('max')) return 'MAX';
  return value;
};

export function NavUserWithTeams({
  user,
}: {
  user: {
    name: string;
    email: string;
    avatar: string;
    isAdmin?: boolean;
    planName?: string;
    planIcon?: string;
  };
}) {
  const router = useRouter();
  const baseRouter = useNextRouter();
  const { isMobile, state } = useSidebar();
  const { account: workspaceAccount, accounts = [], teamSlug } = useWorkspace();
  const [showNewTeamDialog, setShowNewTeamDialog] = React.useState(false);
  // Pricing now uses a full page; keep billing modal only for explicit billing flows
  const [showBillingModal, setShowBillingModal] = React.useState(false);
  const { subscriptionData, creditBalance } = useSubscriptionContext();
  const t = useTranslations();
  const locale = useLocale();
  const pathname = usePathname();
  const settingsPath = buildTeamScopedPath('/settings', teamSlug);
  const tutorialsPath = '/tutorials';
  const switchLocale = (target: AppLocale) => {
    const search = typeof window !== 'undefined' ? window.location.search : '';
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    const currentPathname =
      typeof window !== 'undefined' ? window.location.pathname : pathname;
    persistLocalePreference(target);
    const nextPath = localizePathname(currentPathname, target);
    baseRouter.replace(`${nextPath}${search}${hash}`);
  };

  // Prepare personal account and team accounts
  const personalAccount = React.useMemo(
    () => accounts?.find((account) => account.personal_account),
    [accounts],
  );
  const teamAccounts = React.useMemo(
    () => accounts?.filter((account) => !account.personal_account),
    [accounts],
  );
  const condensedTwoAccounts = !!personalAccount && (teamAccounts?.length === 1);

  const [localAccount, setLocalAccount] = React.useState(
    () => workspaceAccount || personalAccount || accounts?.[0] || null,
  );

  const activeAccount = React.useMemo(() => {
    if (workspaceAccount) return workspaceAccount;
    if (localAccount) return localAccount;
    return personalAccount || accounts?.[0] || null;
  }, [workspaceAccount, localAccount, personalAccount, accounts]);

  React.useEffect(() => {
    if (workspaceAccount) {
      setLocalAccount(workspaceAccount);
    }
  }, [workspaceAccount]);

  React.useEffect(() => {
    if (!workspaceAccount && !localAccount && accounts?.length) {
      setLocalAccount(accounts[0]);
    }
  }, [accounts, workspaceAccount, localAccount]);

  // Handle team selection
  const handleTeamSelect = (team) => {
    setLocalAccount(team);

    // Build target URL
    let targetUrl = '/dashboard';
    if (!team.personal_account) {
      targetUrl = team.slug ? buildWorkspacePath(team.slug) : '/settings/teams';
    }

    // Open in a new tab/window instead of navigating in-place
    if (typeof window !== 'undefined') {
      try {
        window.open(targetUrl, '_blank', 'noopener,noreferrer');
      } catch {
        // Fallback: navigate in-place if pop-up blocked
        router.push(targetUrl);
      }
    } else {
      // Non-browser fallback
      router.push(targetUrl);
    }
  };

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    // Clear local storage after sign out
    clearUserLocalStorage();
    router.push('/auth');
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((part) => part.charAt(0))
      .join('')
      .toUpperCase()
      .substring(0, 2);
  };

  const formatRole = (role?: string | null) => {
    if (!role) return 'Member';
    return role
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  };

  const isPersonalAccount = activeAccount ? Boolean(activeAccount.personal_account) : true;
  // Prefer the active account's name when available (keeps sidebar in sync with personal account renames)
  const primaryLabel = activeAccount?.name || user.name;
  const secondaryLabel = isPersonalAccount ? user.email : formatRole(activeAccount?.role);
  // Always use initials for avatar per product spec
  const avatarImageSrc = '';
  const avatarFallback = getInitials(primaryLabel || 'User');
  const isCollapsed = state === 'collapsed';
  const planLabel = normalizePlanName(
    subscriptionData?.display_plan_name || subscriptionData?.plan_name || subscriptionData?.tier?.name,
  );
  const planKey = planLabel.toLowerCase();
  const isUnlimitedPlan = subscriptionData?.tier?.name === 'tier_25_200' || planKey === 'max';
  const creditPoints = Math.round((creditBalance?.balance ?? 0) * 100);
  const creditDisplay = isUnlimitedPlan
    ? t('billing.unlimited', { default: 'Unlimited' })
    : String(creditPoints);
  const tierCredits =
    subscriptionData?.credits?.tier_credits ??
    subscriptionData?.tier?.credits ??
    creditBalance?.balance ??
    0;
  const tierPoints = Math.round(tierCredits * 100);
  const tierDisplay = isUnlimitedPlan ? null : String(tierPoints);
  const progressValue = isUnlimitedPlan
    ? 100
    : (tierPoints > 0 ? Math.min((creditPoints / tierPoints) * 100, 100) : 0);
  const isMember = planKey !== 'free';
  const isPlusPlan = planKey === 'plus';
  const actionLabel = isMember
    ? t('sidebar.manage', { default: 'Manage' })
    : t('sidebar.upgrade', { default: 'Upgrade' });
  const subscriptionPath = buildTeamScopedPath('/subscription', teamSlug);

  const handleAccountSettingsClick = () => {
    if (teamSlug) {
      router.push(settingsPath, { locale: locale as any });
      return;
    }
    useSettingsStore.getState().open('account');
  };

  return (
    <Dialog open={showNewTeamDialog} onOpenChange={setShowNewTeamDialog}>
        <SidebarMenu>
          <SidebarMenuItem>
          {!isCollapsed && (
            <div className="mb-2">
              <div className="rounded-[var(--canvas-panel-radius)] border border-border/60 bg-background/95 px-3 py-2 shadow-[0_1px_10px_rgba(14,165,233,0.12)]">
                <div className="flex items-center justify-between gap-2">
                  {isPlusPlan ? (
                    <span className="text-[12px] font-semibold tracking-[0.18em] text-foreground/80">
                      PLUS
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-[calc(var(--canvas-panel-radius)-4px)] border border-border/60 bg-background/80 px-2 py-0.5 text-[11px] font-medium text-foreground/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] dark:shadow-none">
                      <span className="h-2 w-2 rounded-full bg-gradient-to-br from-sky-200 to-emerald-300 dark:from-sky-400 dark:to-emerald-400" />
                      {planLabel}
                    </span>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    className="h-6 rounded-[calc(var(--canvas-panel-radius)-4px)] px-3 text-[11px] font-semibold bg-slate-800/90 text-white hover:bg-slate-800/80 dark:bg-white/85 dark:text-slate-900 dark:hover:bg-white"
                    onClick={() => router.push(subscriptionPath, { locale: locale as any })}
                  >
                    {actionLabel}
                  </Button>
                </div>
                <div className="mt-2 flex items-center justify-start text-xs">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-foreground/80">
                    <Sparkle className="h-3 w-3 text-sky-400/60" />
                    <span>{creditDisplay}</span>
                    {tierDisplay && (
                      <>
                        <span className="text-foreground/40">/</span>
                        <span>{tierDisplay}</span>
                      </>
                    )}
                  </span>
                </div>
                <div className="mt-1.5">
                  <div className="h-1.5 w-full rounded-[calc(var(--canvas-panel-radius)-6px)] bg-slate-200/60 dark:bg-slate-800/60">
                    <div
                      className="h-full rounded-[calc(var(--canvas-panel-radius)-6px)] bg-emerald-400"
                      style={{ width: `${progressValue}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
          <div className="relative">
            {isCollapsed && (
              <div className="pointer-events-none absolute -top-9 left-1/2 z-10 -translate-x-1/2">
                <div className="flex flex-col items-center gap-0.5 text-[11px] font-semibold text-foreground/80">
                  <Sparkle className="h-3 w-3 text-sky-400/60" />
                  <span className="leading-none">{creditDisplay}</span>
                </div>
              </div>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className={cn(
                    "bg-transparent hover:bg-transparent data-[state=open]:bg-transparent border-[1.5px] border-border h-[64px] p-3 group-data-[collapsible=icon]:!p-0 group-data-[collapsible=icon]:!h-10 group-data-[collapsible=icon]:!w-10 group-data-[collapsible=icon]:border-0",
                    isCollapsed && "justify-center"
                  )}
                >
                  <Avatar className="h-10 w-10 rounded-full flex-shrink-0">
                    {avatarImageSrc ? (
                      <AvatarImage src={avatarImageSrc} alt={primaryLabel} />
                    ) : null}
                    <AvatarFallback className="rounded-full">
                      {avatarFallback}
                    </AvatarFallback>
                  </Avatar>
                  <div className={cn("flex h-10 min-w-0 flex-1 flex-col justify-between text-left leading-tight", isCollapsed && "hidden")}>
                    <span className="truncate text-sm font-medium leading-tight">{primaryLabel}</span>
                    <span className="truncate text-xs leading-tight text-muted-foreground">{secondaryLabel}</span>
                  </div>
                  <ChevronsUpDown className={cn("ml-auto size-4", isCollapsed && "hidden")} />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
                side={isMobile ? 'bottom' : 'top'}
                align="start"
                sideOffset={4}
              >
              <DropdownMenuLabel className="p-0 font-normal">
                <div
                  className="flex items-center gap-2 px-1.5 py-1.5 text-left text-sm cursor-pointer rounded-md hover:bg-accent/60"
                  onClick={handleAccountSettingsClick}
                >
                  <Avatar className="h-8 w-8 rounded-lg">
                    {avatarImageSrc ? (
                      <AvatarImage src={avatarImageSrc} alt={primaryLabel} />
                    ) : null}
                    <AvatarFallback className="rounded-lg">
                      {avatarFallback}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{primaryLabel}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {secondaryLabel}
                    </span>
                  </div>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />

              {/* Account switcher */}
              {condensedTwoAccounts ? (
                <>
                  <DropdownMenuItem
                    key={personalAccount!.account_id}
                    onClick={() => handleTeamSelect(personalAccount!)}
                    className={cn(
                      'gap-2 p-2',
                      activeAccount?.account_id === personalAccount!.account_id &&
                        'bg-sidebar-accent text-sidebar-accent-foreground',
                    )}
                  >
                    <div className="flex size-6 items-center justify-center rounded-xs border">
                      <Command className="size-4 shrink-0" />
                    </div>
                    {personalAccount!.name || 'Personal'}
                    <DropdownMenuShortcut>⌘1</DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    key={teamAccounts![0].account_id}
                    onClick={() => handleTeamSelect(teamAccounts![0])}
                    className={cn(
                      'gap-2 p-2',
                      activeAccount?.account_id === teamAccounts![0].account_id &&
                        'bg-sidebar-accent text-sidebar-accent-foreground',
                    )}
                  >
                    <div className="flex size-6 items-center justify-center rounded-xs border">
                      <AudioWaveform className="size-4 shrink-0" />
                    </div>
                    {teamAccounts![0].name}
                    <DropdownMenuShortcut>⌘2</DropdownMenuShortcut>
                  </DropdownMenuItem>
                </>
              ) : (
                <>
                  {personalAccount && (
                    <>
                    <DropdownMenuLabel className="text-muted-foreground text-xs">
                      {t('userMenu.personalAccount', {default: 'Personal Account'})}
                    </DropdownMenuLabel>
                    <DropdownMenuItem
                      key={personalAccount.account_id}
                      onClick={() => handleTeamSelect(personalAccount)}
                      className={cn(
                        'gap-2 p-2',
                        activeAccount?.account_id === personalAccount.account_id &&
                          'bg-sidebar-accent text-sidebar-accent-foreground',
                      )}
                    >
                      <div className="flex size-6 items-center justify-center rounded-xs border">
                        <Command className="size-4 shrink-0" />
                      </div>
                      {personalAccount.name}
                        <DropdownMenuShortcut>⌘1</DropdownMenuShortcut>
                      </DropdownMenuItem>
                    </>
                  )}
                  {teamAccounts?.length > 0 && (
                    <>
                      <DropdownMenuLabel className="text-muted-foreground text-xs mt-2">
                        {t('userMenu.teams', {default: 'Teams'})}
                      </DropdownMenuLabel>
                      {teamAccounts.map((team, index) => (
                        <DropdownMenuItem
                          key={team.account_id}
                          onClick={() => handleTeamSelect(team)}
                          className={cn(
                            'gap-2 p-2',
                            activeAccount?.account_id === team.account_id &&
                              'bg-sidebar-accent text-sidebar-accent-foreground',
                          )}
                        >
                          <div className="flex size-6 items-center justify-center rounded-xs border">
                            <AudioWaveform className="size-4 shrink-0" />
                          </div>
                          {team.name}
                          <DropdownMenuShortcut>⌘{index + 2}</DropdownMenuShortcut>
                        </DropdownMenuItem>
                      ))}
                    </>
              )}
            </>
          )}

          <DropdownMenuSeparator />
          <DialogTrigger asChild>
            <DropdownMenuItem 
              className="gap-2 p-2"
              onClick={() => {
                setShowNewTeamDialog(true)
              }}
            >
              <div className="bg-background flex size-6 items-center justify-center rounded-md border">
                <Plus className="size-4" />
              </div>
              <div className="text-muted-foreground font-medium">
                {t('userMenu.createTeam.title', {default: 'Create a new team'})}
              </div>
            </DropdownMenuItem>
          </DialogTrigger>
          <DropdownMenuSeparator />

              {/* User Settings Section */}
              <DropdownMenuGroup>
                {user.isAdmin && (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Shield className="h-4 w-4 mr-2" />
                      <span>{t('userMenu.admin', {default: 'Admin'})}</span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuPortal>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem asChild>
                      <Link href="/admin/billing" locale={locale as any}>
                        <DollarSign className="h-4 w-4" />
                        {t('userMenu.adminBilling', {default: 'Billing Management'})}
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href="/admin/invites" locale={locale as any}>
                        <Sparkles className="h-4 w-4" />
                        {t('userMenu.inviteCodes', {default: 'Invite Codes'})}
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href="/admin/audit" locale={locale as any}>
                        <FileText className="h-4 w-4" />
                        {t('userMenu.adminAudit', {default: 'Audit & Events'})}
                      </Link>
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                    </DropdownMenuPortal>
                  </DropdownMenuSub>
                )}
                
                <DropdownMenuItem onClick={() => router.push(subscriptionPath, {locale: locale as any})}>
                  <Zap className="h-4 w-4" />
                  {t('userMenu.plans', {default: 'Plans'})}
                </DropdownMenuItem>
                {/* Integrations entry opens settings modal on Integrations pane */}
                {ENABLE_INTEGRATIONS && (
                  <DropdownMenuItem onClick={() => useSettingsStore.getState().open('integrations')}>
                    <Plug className="h-4 w-4" />
                    {t('userMenu.integrations', {default: 'Integrations'})}
                  </DropdownMenuItem>
                )}
                {isLocalMode() && <DropdownMenuItem asChild>
                  <Link href="/settings/env-manager" locale={locale as any}>
                    <KeyRound className="h-4 w-4" />
                    {t('userMenu.localEnv', {default: 'Local .Env Manager'})}
                  </Link>
                </DropdownMenuItem>}
                <DropdownMenuItem asChild>
                  <Link href={tutorialsPath} locale={locale as any}>
                    <BookOpen className="h-4 w-4" />
                    {t('userMenu.tutorials', {default: 'Tutorials'})}
                  </Link>
                </DropdownMenuItem>
                {/* Unified Settings (open in-app modal default pane) */}
                <DropdownMenuItem onClick={() => useSettingsStore.getState().open()}>
                  <Settings className="h-4 w-4" />
                  {t('userMenu.settings', {default: 'Settings'})}
                </DropdownMenuItem>
                {/* <DropdownMenuItem asChild>
                  <Link href="/settings">
                    <Settings className="mr-2 h-4 w-4" />
                    Settings
                  </Link>
                </DropdownMenuItem> */}
                {/* Language switcher: submenu with 中文 & English */}
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Globe className="h-4 w-4 mr-2" />
                    <span>{t('userMenu.language', {default: 'Language'})}</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent>
                      <DropdownMenuItem onClick={() => switchLocale('zh')}>
                        <span className="text-xs">中文</span>
                        {locale === 'zh' && <span className="ml-auto text-xs">✓</span>}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => switchLocale('en')}>
                        <span className="text-xs">English</span>
                        {locale === 'en' && <span className="ml-auto text-xs">✓</span>}
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>

                <ThemeMenuSub label={t('userMenu.theme', {default: 'Theme'})} />
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem className='text-destructive focus:text-destructive focus:bg-destructive/10' onClick={handleLogout}>
                <LogOut className="h-4 w-4 text-destructive" />
                {t('userMenu.logout', {default: 'Log out'})}
              </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </SidebarMenuItem>
      </SidebarMenu>

      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="text-foreground">
            {t('userMenu.createTeam.title', {default: 'Create a new team'})}
          </DialogTitle>
          <DialogDescription className="text-foreground/70">
            {t('userMenu.createTeam.desc', {default: 'Create a team to collaborate with others.'})}
          </DialogDescription>
        </DialogHeader>
        <NewTeamForm />
      </DialogContent>

      {/* Billing Modal */}
      <BillingModal
        open={showBillingModal}
        onOpenChange={setShowBillingModal}
        returnUrl={typeof window !== 'undefined' ? window?.location?.href || '/' : '/'}
      />

    </Dialog>
  );
}
