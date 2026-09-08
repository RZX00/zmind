'use client';

import React from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/components/AuthProvider';
import { useWorkspace } from '@/contexts/workspace-context';
import { useSubscriptionContext } from '@/contexts/SubscriptionContext';
import AccountProfileCard from '@/components/account/AccountProfileCard';

const AccountPane: React.FC = () => {
  const t = useTranslations('settings.account');
  const { user, isLoading: authLoading } = useAuth();
  const { accounts, account } = useWorkspace();
  const { subscriptionData, creditBalance, isLoading: billingLoading } =
    useSubscriptionContext();
  const [workspaceStats, setWorkspaceStats] = React.useState<{
    canvases: any[];
  } | null>(null);
  const [workspaceStatsLoading, setWorkspaceStatsLoading] =
    React.useState(false);

  const activeAccount = account || accounts?.find((a) => a.personal_account) || null;
  const isPersonalAccount = activeAccount ? Boolean(activeAccount.personal_account) : true;

  React.useEffect(() => {
    const fetchWorkspaceStats = async () => {
      if (!activeAccount?.account_id) {
        setWorkspaceStats(null);
        return;
      }
      setWorkspaceStatsLoading(true);
      try {
        const headers: Record<string, string> = {
          'X-Workspace-Id': activeAccount.account_id,
        };
        const resp = await fetch('/api/workspace/meta', {
          headers,
          cache: 'no-store',
        });
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }
        const json = await resp.json();
        setWorkspaceStats({
          canvases: Array.isArray(json?.canvases) ? json.canvases : [],
        });
      } catch {
        setWorkspaceStats(null);
      } finally {
        setWorkspaceStatsLoading(false);
      }
    };

    fetchWorkspaceStats();
  }, [activeAccount?.account_id]);

  const isLoading = authLoading || billingLoading || workspaceStatsLoading;

  const totalCanvases = workspaceStats?.canvases?.length ?? 0;
  const totalNodes =
    workspaceStats?.canvases?.reduce((sum: number, canvas: any) => {
      const nodeCount = typeof canvas.nodeCount === 'number'
        ? canvas.nodeCount
        : (Array.isArray(canvas.nodes) ? canvas.nodes.length : 0);
      return sum + nodeCount;
    }, 0) ?? 0;

  let planLabel: string;
  const tierKey =
    (subscriptionData?.plan_name ||
      subscriptionData?.tier?.name ||
      '').toLowerCase();

  if (!subscriptionData) {
    planLabel = t('stats.planFree', { default: 'Free plan' });
  } else {
    switch (tierKey) {
      case 'tier_2_20':
        planLabel = 'Plus';
        break;
      case 'tier_6_50':
        planLabel = 'Pro';
        break;
      case 'tier_12_100':
      case 'tier_25_200':
      case 'tier_50_400':
      case 'tier_125_800':
      case 'tier_200_1000':
        planLabel = 'MAX';
        break;
      default:
        planLabel = t('stats.planFree', { default: 'Free plan' });
        break;
    }
  }

  const balance = creditBalance?.balance ?? 0;
  const balancePoints = Math.round(balance * 1000) / 10;

  if (isLoading || !activeAccount) {
    return (
      <div className="flex h-full items-center justify-center py-10 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        {t('loading', { default: '正在加载账户信息...' })}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto text-foreground">
      <div className="mb-4">
        <h3 className="text-sm font-semibold">
          {t('title', { default: '账户信息' })}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {t('subtitle', { default: '管理你的账户资料和登录信息' })}
        </p>
      </div>
      <AccountProfileCard user={user} account={activeAccount} isPersonal={isPersonalAccount} compact />
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-background/60 px-4 py-3">
          <div className="text-xs font-medium text-muted-foreground">
            {t('stats.subscription', { default: '订阅状态' })}
          </div>
          <div className="mt-1 text-sm font-semibold text-foreground">
            {planLabel}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-background/60 px-4 py-3">
          <div className="text-xs font-medium text-muted-foreground">
            {t('stats.balance', { default: '额度余额' })}
          </div>
          <div className="mt-1 text-sm font-semibold text-foreground">
            {balancePoints.toLocaleString(undefined, {
              maximumFractionDigits: 1,
              minimumFractionDigits: 0,
            })}{' '}
            {t('stats.pointsUnit', { default: '积分' })}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-background/60 px-4 py-3">
          <div className="text-xs font-medium text-muted-foreground">
            {t('stats.canvases', { default: '画布数量' })}
          </div>
          <div className="mt-1 text-sm font-semibold text-foreground">
            {totalCanvases.toLocaleString()}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-background/60 px-4 py-3">
          <div className="text-xs font-medium text-muted-foreground">
            {t('stats.nodes', { default: '节点总数' })}
          </div>
          <div className="mt-1 text-sm font-semibold text-foreground">
            {totalNodes.toLocaleString()}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AccountPane;
