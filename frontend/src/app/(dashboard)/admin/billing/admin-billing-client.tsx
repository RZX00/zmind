'use client';

import { useState } from 'react';
import { CardContent } from '@/components/ui/card';
import { AdminUserTable } from '@/components/admin/admin-user-table';
import { AdminUserDetailsDialog } from '@/components/admin/admin-user-details-dialog';
import { useAdminUserStats, useRefreshUserData } from '@/hooks/react-query/admin/use-admin-users';
import type { UserSummary } from '@/hooks/react-query/admin/use-admin-users';

export default function AdminBillingClient() {
  const [selectedUser, setSelectedUser] = useState<UserSummary | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const { data: stats } = useAdminUserStats();
  const { refreshUserList, refreshUserStats } = useRefreshUserData();

  const handleUserSelect = (user: UserSummary) => {
    setSelectedUser(user);
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setSelectedUser(null);
  };

  const handleRefreshData = () => {
    refreshUserList();
    refreshUserStats();
  };

  return (
    <div className="dashboard-page">
      <div className="dashboard-container space-y-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight dashboard-title">
              Account Billing - Admin
            </h1>
            <p className="text-md text-muted-foreground mt-2">
              Manage billing for personal and team accounts
            </p>
          </div>
        </div>
        <div className="border-0 bg-transparent shadow-none">
          <CardContent className="p-0">
            <AdminUserTable onUserSelect={handleUserSelect} />
          </CardContent>
        </div>
        <AdminUserDetailsDialog
          user={selectedUser}
          isOpen={isDialogOpen}
          onClose={handleCloseDialog}
          onRefresh={handleRefreshData}
        />
      </div>
    </div>
  );
}
