'use client';

import { useEffect } from 'react';
import { SidebarLeft, FloatingMobileMenuButton } from '@/components/sidebar/sidebar-left';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { useAccounts } from '@/hooks/use-accounts';
import { useAuth } from '@/components/AuthProvider';
import { useMaintenanceNoticeQuery } from '@/hooks/react-query/edge-flags';
import { useRouter } from '@/i18n/routing';
import { usePathname } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useApiHealth } from '@/hooks/react-query';
import { MaintenancePage } from '@/components/maintenance/maintenance-page';
import { DeleteOperationProvider } from '@/contexts/DeleteOperationContext';
import { StatusOverlay } from '@/components/ui/status-overlay';
import { ThreeViewLayout } from './three-view-layout';
import SettingsModal from '@/canvas/components/shared/settings/SettingsModal';
import { WorkspaceProvider } from '@/contexts/workspace-context';
import GlobalSearch from '@/components/search/GlobalSearch';

import { useProjects, useThreads } from '@/hooks/react-query/sidebar/use-sidebar';
import { useIsMobile } from '@/hooks/use-mobile';
import { SubscriptionProvider } from '@/contexts/SubscriptionContext';
import { MaintenanceAlert } from '../maintenance-alert';
import { DailyLoginClaim } from '@/components/billing/daily-login-claim';
import { isMobileDevice } from '@/lib/utils/is-mobile-device';
import { TutorialsBanner } from '@/components/announcements/tutorials-banner';
import { BackgroundAALChecker } from '@/components/auth/background-aal-checker';

interface DashboardLayoutContentProps {
  children: React.ReactNode;
}

export default function DashboardLayoutContent({
  children,
}: DashboardLayoutContentProps) {
  const { user, isLoading } = useAuth();
  const { data: accounts } = useAccounts({ enabled: !!user });
  const personalAccount = accounts?.find((account) => account.personal_account);
  const router = useRouter();
  const { data: maintenanceNotice, isLoading: maintenanceLoading } = useMaintenanceNoticeQuery();
  const {
    data: healthData,
    isLoading: isCheckingHealth,
    error: healthError,
  } = useApiHealth();
  const pathname = usePathname();
  const isExploreRoute = pathname === '/explore' || pathname?.startsWith('/zh/explore');

  useEffect(() => {
    if (maintenanceNotice?.enabled) {
      // setShowMaintenanceAlert(true); // This line was removed
    } else {
      // setShowMaintenanceAlert(false); // This line was removed
    }
  }, [maintenanceNotice]);

  // API health is now managed by useApiHealth hook
  const isApiHealthy = healthData?.status === 'ok' && !healthError;

  // Check authentication status
  useEffect(() => {
    if (!isLoading && !user && !isExploreRoute) {
      router.push('/auth');
    }
  }, [user, isLoading, router, isExploreRoute]);

  const mantenanceBanner: React.ReactNode | null = null;

  // Show loading state while checking auth, health, or maintenance status
  if (isLoading || isCheckingHealth || maintenanceLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Don't render anything if not authenticated
  if (!user && !isExploreRoute) {
    return null;
  }

  // Show maintenance page if maintenance mode is enabled
  if (maintenanceNotice?.enabled) {
    return <MaintenanceAlert open={true} onOpenChange={() => {}} closeable={false} />;
  }

  // Show maintenance page if API is not healthy (but not during initial loading)
  if (!isCheckingHealth && !isApiHealthy) {
    return <MaintenancePage />;
  }

  return (
    <BackgroundAALChecker enabled={!isExploreRoute}>
      <DeleteOperationProvider>
        <WorkspaceProvider>
          <SubscriptionProvider>
            <DailyLoginClaim />
            <SidebarProvider className="dashboard-shell">
              <DashboardPrefetchLogger accounts={accounts} user={user} />
              <TutorialsBanner />
              <SidebarLeft />
              <SidebarInset className="bg-transparent">
                {mantenanceBanner}
                <div className="dashboard-main">
                  <ThreeViewLayout>{children}</ThreeViewLayout>
                </div>
              </SidebarInset>

              {/* <PricingAlert
              open={showPricingAlert}
              onOpenChange={setShowPricingAlert}
              closeable={false}
              accountId={personalAccount?.account_id}
              /> */}

              {/* <MaintenanceAlert
                open={showMaintenanceAlert}
                onOpenChange={setShowMaintenanceAlert}
                closeable={true}
              /> */}

              {/* Status overlay for deletion operations */}
              <StatusOverlay />
              {/* Global search overlay */}
              <GlobalSearch />

              {/* Floating mobile menu button */}
              <FloatingMobileMenuButton />
              {/* Global settings modal for canvas (keymap/style) */}
              <SettingsModal />
            </SidebarProvider>
          </SubscriptionProvider>
        </WorkspaceProvider>
      </DeleteOperationProvider>
    </BackgroundAALChecker>
  );
}

function DashboardPrefetchLogger({
  accounts,
  user,
}: {
  accounts?: any;
  user?: any;
}) {
  const isMobile = useIsMobile();
  const { data: projects } = useProjects();
  const { data: threads } = useThreads();

  useEffect(() => {
    if (isMobile && isMobileDevice()) {
      console.log('📱 Mobile Layout - Prefetched data:', {
        projects: projects?.length || 0,
        threads: threads?.length || 0,
        accounts: accounts?.length || 0,
        user: !!user
      });
    }
  }, [isMobile, projects, threads, accounts, user]);

  return null;
}
