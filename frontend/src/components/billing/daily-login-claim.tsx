'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useAuth } from '@/components/AuthProvider';
import { useWorkspace } from '@/contexts/workspace-context';
import { useClaimDailyLogin } from '@/hooks/react-query/use-billing-v2';

export function DailyLoginClaim() {
  const t = useTranslations();
  const { user, session, isLoading } = useAuth();
  const { workspaceId, isReady } = useWorkspace();
  const { mutateAsync } = useClaimDailyLogin();
  const hasTriggeredRef = useRef(false);

  useEffect(() => {
    if (hasTriggeredRef.current) return;
    if (isLoading || !user || !session?.access_token) return;
    if (!isReady || !workspaceId) return;

    hasTriggeredRef.current = true;

    mutateAsync()
      .then((response) => {
        if (response?.granted && response.points > 0) {
          toast.success(
            t('billing.dailyLogin.toastGranted', {
              default: 'Daily login bonus +{points} points added.',
              points: response.points,
            })
          );
        }
      })
      .catch(() => {});
  }, [isLoading, user, session?.access_token, isReady, workspaceId, mutateAsync, t]);

  return null;
}
