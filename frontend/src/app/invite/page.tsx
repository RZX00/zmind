'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Sparkles, CreditCard, Zap, Shield, ArrowRight, CheckCircle, Loader2, Clock, XCircle, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { useRouter } from '@/i18n/routing';
import { useState, useEffect } from 'react';
import { useSubscription } from '@/hooks/react-query/use-billing-v2';
import { redeemInvite, getCreditBalance } from '@/lib/api/billing-v2';
import { Skeleton } from '@/components/ui/skeleton';
import { ZmindLogo } from '@/components/sidebar/zmind-logo';
import {Link} from '@/i18n/routing';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/components/AuthProvider';
import { clearUserLocalStorage } from '@/lib/utils/clear-local-storage';
import { useMaintenanceNoticeQuery } from '@/hooks/react-query/edge-flags';
import { MaintenanceAlert } from '@/components/maintenance-alert';
import { getWechatQrPublic } from '@/lib/api/assets';
import {useTranslations, useMessages} from 'next-intl';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';

export default function InvitePage() {
  const router = useRouter();
  const t = useTranslations();
  const messages = useMessages();
  const { user, isLoading: authLoading } = useAuth();
  const { data: subscription, isLoading: isLoadingSubscription } = useSubscription();
  const searchParams = useSearchParams();
  const [inviteCode, setInviteCode] = useState('');
  const [isRedeeming, setIsRedeeming] = useState(false);
  const { data: maintenanceNotice, isLoading: maintenanceLoading } = useMaintenanceNoticeQuery();
  const [qrImageUrl, setQrImageUrl] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(true);
  const [qrErrored, setQrErrored] = useState(false);
  const tipUploadCopy =
    (messages as any)?.activateTrial?.how?.tipUpload ||
    "Scan the QR to join the WeChat group. If it's missing, ask an admin for the latest code.";

  const inviteQuery = searchParams?.toString();
  const returnPath = inviteQuery ? `/invite?${inviteQuery}` : '/invite';
  const codeFromQuery = (searchParams?.get('code') || '').trim();

  // Redirect unauthenticated users to auth with returnUrl
  useEffect(() => {
    if (!authLoading && !user) {
      router.replace(`/auth?returnUrl=${encodeURIComponent(returnPath)}`);
    }
  }, [authLoading, user, router, returnPath]);

  useEffect(() => {
    if (!codeFromQuery) return;
    if (inviteCode.trim()) return;
    setInviteCode(codeFromQuery);
  }, [codeFromQuery, inviteCode]);

  useEffect(() => {
    if (!authLoading && user && !isLoadingSubscription && subscription) {
      const hasActiveSubscription = subscription.tier && 
        subscription.tier.name !== 'none' && 
        subscription.tier.name !== 'free';
      if (hasActiveSubscription) {
        router.push('/dashboard');
      }
    }
  }, [subscription, isLoadingSubscription, authLoading, user, router]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await getWechatQrPublic();
        if (!mounted) return;
        setQrImageUrl(res.public_url);
      } catch (error) {
        console.error('Failed to load WeChat QR', error);
      } finally {
        if (mounted) setQrLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const handleRedeem = async () => {
    const code = inviteCode.trim();
    if (!code || code.length < 6) {
      toast.error(t('activateTrial.toast.invalidCode', {default: 'Please enter a valid invite code.'}));
      return;
    }
    try {
      setIsRedeeming(true);
      const res = await redeemInvite({ code });
      toast.success(res.message || t('activateTrial.toast.redeemedSuccess', {default: 'Invite redeemed successfully'}));
      // Redirect with flag so Dashboard can show a success modal
      router.push('/dashboard?invite=redeemed');
    } catch (error: any) {
      console.error('Failed to redeem invite:', error);

      // 优先根据具体错误反馈更清晰的提示
      const status = error?.status;
      const detail: string = (error?.details?.detail || error?.message || '').toLowerCase();

      if (status === 409 || detail.includes('already redeemed')) {
        toast.error(t('activateTrial.toast.alreadyRedeemed', {default: 'This account has already redeemed an invite code.'}));
      } else if (status === 400 && (detail.includes('expired') || detail.includes('invalid'))) {
        toast.error(t('activateTrial.toast.invalidOrExpired', {default: 'The invite code is invalid or has expired.'}));
      } else if (status === 400 && detail.includes('already used')) {
        toast.error(t('activateTrial.toast.alreadyUsed', {default: 'This invite code has already been used.'}));
      } else if (status === 403 && detail.includes('only new accounts')) {
        toast.error(t('activateTrial.toast.onlyNewAccounts', {default: 'Only new accounts are eligible to redeem.'}));
      } else {
        // 兜底：若可能是 5xx/网络问题，但后端实际已加余额，则探测余额后按成功处理
        try {
          const bal = await getCreditBalance();
          if ((bal as any)?.balance >= 10) {
            toast.success(t('activateTrial.toast.redeemedSuccessWithBalance', {default: 'Invite redeemed successfully. 1000 test points added.'}));
            router.push('/dashboard?invite=redeemed');
            return;
          }
        } catch {}

        toast.error(t('activateTrial.toast.redeemFailed', {default: 'Redemption failed, please try again later.'}));
      }
    } finally {
      setIsRedeeming(false);
    }
  };

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    clearUserLocalStorage();
    router.push('/auth');
  };

  const isMaintenanceLoading = maintenanceLoading;

  if (isMaintenanceLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-background to-muted/20 flex items-center justify-center p-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (maintenanceNotice?.enabled) {
    return <MaintenanceAlert open={true} onOpenChange={() => {}} closeable={false} />;
  }

  const isLoading = authLoading || isLoadingSubscription;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-muted/20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20 flex items-center justify-center p-4 relative">
      {/* Quick navigation */}
      <div className="absolute top-4 left-4 flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => router.push('/')}>{t('activateTrial.nav.home', {default: 'Home'})}</Button>
        <Button variant="ghost" size="sm" onClick={() => router.push('/dashboard')}>{t('activateTrial.nav.dashboard', {default: 'Dashboard'})}</Button>
      </div>
      {user && (
      <div className="absolute top-4 right-4">
        {user && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleLogout}
            className="gap-2"
          >
            <LogOut className="h-4 w-4" />
            {t('activateTrial.nav.logout', {default: 'Log out'})}
          </Button>
        )}
      </div>
      )}
      <Card className="w-full max-w-2xl border-2 shadow-none bg-transparent border-none">
        <CardHeader className="text-center space-y-4">
          <div>
            <CardTitle className="text-2xl font-bold flex items-center justify-center gap-2">
              <ZmindLogo/>
              <span>{t('activateTrial.title', {default: 'Welcome to Zmind'})}</span>
            </CardTitle>
            <CardDescription className="mt-2">
              {t('activateTrial.subtitle', {default: 'Redeem an invite to unlock AI access'})}
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="bg-muted/50 rounded-lg p-6 space-y-4">
            <h3 className="font-semibold text-lg flex items-center gap-2">
              <Zap className="h-5 w-5 text-primary" />
              {t('activateTrial.section.title', {default: 'Early Access via Invite Code'})}
            </h3>
            <p className="text-sm text-muted-foreground">
              {t('activateTrial.section.desc', {default: 'Enter your invite code to receive 1000 test points (valid for 30 days).'})}
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <input 
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder={t('activateTrial.input.placeholder', {default: 'Enter your invite code'})}
                className="flex-1 w-full rounded-md border px-3 py-2 text-sm bg-background"
              />
              <Button onClick={handleRedeem} disabled={isRedeeming} className="w-full sm:w-auto">
                {isRedeeming ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('activateTrial.redeem.redeeming', {default: 'Redeeming...'})}
                  </>
                ) : (
                  <>
                    <CreditCard className="h-4 w-4" />
                    {t('activateTrial.redeem.cta', {default: 'Redeem Invite'})}
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardContent>

        {/* How to get an invite code */}
        <CardContent className="space-y-4 mt-2">
          <div className="bg-muted/40 rounded-lg p-5">
            <h3 className="font-semibold text-base mb-2">{t('activateTrial.how.title', {default: 'How to get an invite code'})}</h3>
            <p className="text-sm text-muted-foreground mb-3">
              {t('activateTrial.how.desc', {default: 'Join our WeChat group and request an invite code from the admins. Scan the QR code below to join.'})}
            </p>
            <div className="flex flex-col sm:flex-row items-center gap-4">
              <div className="w-40 h-40 rounded-md border bg-background flex items-center justify-center overflow-hidden">
                {qrImageUrl && !qrErrored ? (
                  <Image
                    src={qrImageUrl}
                    alt={t('activateTrial.how.qrAlt', {default: 'WeChat Group QR'})}
                    width={160}
                    height={160}
                    className="w-full h-full object-contain"
                    unoptimized
                    loader={({ src }) => src}
                    onError={() => setQrErrored(true)}
                  />
                ) : qrLoading ? (
                  <Skeleton className="w-full h-full" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground text-center px-2">
                    {t('activateTrial.how.qrPlaceholder', {default: 'QR coming soon'})}
                  </div>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                {tipUploadCopy}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
