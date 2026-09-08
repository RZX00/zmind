"use client";

import { createContext, useContext, useLayoutEffect, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import type { GetAccountsResponse } from '@usebasejump/shared';
import { useAccounts } from '@/hooks/use-accounts';
import { setCurrentWorkspaceId } from '@/lib/workspace-session';

type WorkspaceContextValue = {
  workspaceId: string | null;
  account: GetAccountsResponse[number] | null;
  accounts: GetAccountsResponse;
  isPersonal: boolean;
  isReady: boolean;
  teamSlug: string | null;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function deriveAccountFromPath(
  accounts: GetAccountsResponse,
  pathname: string,
): GetAccountsResponse[number] | null {
  if (!accounts.length) return null;
  const segments = pathname.split('?')[0].split('/').filter(Boolean);
  if (segments.length > 0) {
    // Handle locale prefix
    const LOCALES = new Set(['en', 'zh']);
    let idx = 0;
    if (segments[0] && LOCALES.has(segments[0])) idx = 1;
    // Team routes use /team/:slug
    if (segments[idx] === 'team' && segments.length > idx + 1) {
      const maybeSlug = segments[idx + 1];
      const teamAccount = accounts.find(
        (account) => account.slug && account.slug.toLowerCase() === maybeSlug.toLowerCase(),
      );
      if (teamAccount) {
        return teamAccount;
      }
    } else {
      // Also support legacy /:slug paths (if any still exist)
      const maybeSlug = segments[idx];
      const teamAccount = accounts.find(
        (account) => account.slug && account.slug.toLowerCase() === maybeSlug.toLowerCase(),
      );
      if (teamAccount) {
        return teamAccount;
      }
    }
  }

  const personalAccount =
    accounts.find((account) => account.personal_account) ?? accounts[0] ?? null;
  return personalAccount || null;
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { data: accounts = [], isLoading } = useAccounts();
  const pathname = usePathname();

  const account = useMemo(() => {
    if (!accounts.length) return null;
    return deriveAccountFromPath(accounts, pathname);
  }, [accounts, pathname]);

  const workspaceId = account?.account_id ?? null;

  useLayoutEffect(() => {
    setCurrentWorkspaceId(workspaceId);
    return () => {
      setCurrentWorkspaceId(null);
    };
  }, [workspaceId]);

  const isReady = !!workspaceId && !isLoading;

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      workspaceId,
      account: account ?? null,
      accounts,
      isPersonal: Boolean(account?.personal_account),
      isReady,
      teamSlug: account && !account.personal_account ? account.slug ?? null : null,
    }),
    [account, accounts, isReady, workspaceId],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }
  return context;
}

export function useOptionalWorkspace() {
  return useContext(WorkspaceContext);
}
