'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import {useTranslations, useFormatter} from 'next-intl';
import { DataTable, DataTableColumn } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Pagination } from '@/components/ui/pagination';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  Search, 
  User, 
  CreditCard, 
  Calendar,
  Filter,
  TrendingUp,
  Users,
  Activity
} from 'lucide-react';
import { useAdminUserList, useAdminUserStats } from '@/hooks/react-query/admin/use-admin-users';
import type { UserSummary } from '@/hooks/react-query/admin/use-admin-users';

interface AdminUserTableProps {
  onUserSelect?: (user: UserSummary) => void;
}

type AccountTypeFilter = 'all' | 'personal' | 'team';

export function AdminUserTable({ onUserSelect }: AdminUserTableProps) {
  const t = useTranslations();
  const fmt = useFormatter();
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [searchEmail, setSearchEmail] = useState('');
  const [accountTypeFilter, setAccountTypeFilter] = useState<AccountTypeFilter>('all');
  const [tierFilter, setTierFilter] = useState<string>('');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  
  const [debouncedSearch, setDebouncedSearch] = useState(searchEmail);
  
  const { data: userListResponse, isLoading, error } = useAdminUserList({
    page,
    page_size: pageSize,
    search_email: debouncedSearch || undefined,
    search_name: debouncedSearch || undefined,
    tier_filter: tierFilter || undefined,
    account_type: accountTypeFilter === 'all' ? undefined : accountTypeFilter,
    sort_by: sortBy,
    sort_order: sortOrder,
  });

  const { data: stats } = useAdminUserStats();

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchEmail);
      setPage(1);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchEmail]);

  useEffect(() => {
    setPage(1);
  }, [accountTypeFilter]);

  const handleAccountTypeChange = (value: string) => {
    if (value === 'all' || value === 'personal' || value === 'team') {
      setAccountTypeFilter(value);
    }
  };

  const formatCurrency = (amount: number) => `$${amount.toFixed(2)}`;

  const formatDate = useCallback(
    (dateString: string) =>
      fmt.dateTime(new Date(dateString), {year:'numeric', month:'short', day:'numeric'}),
    [fmt]
  );

  const isPersonalAccount = useCallback((user: UserSummary) => user.personal_account !== false, []);

  const getAccountName = useCallback(
    (user: UserSummary) => {
      if (isPersonalAccount(user)) return user.email;
      return user.account_name || t('admin.userTable.teamAccount', {default: 'Team Account'});
    },
    [isPersonalAccount, t]
  );

  const getAccountMeta = useCallback((user: UserSummary) => {
    if (isPersonalAccount(user)) {
      return t('admin.userTable.joinedOn', {date: formatDate(user.created_at), default: `Joined ${formatDate(user.created_at)}`});
    }

    const ownerEmail = user.email && user.email !== 'N/A' ? user.email : null;
    const ownerLabel = ownerEmail
      ? `${t('admin.userTable.owner', {default: 'Owner'})} ${ownerEmail}`
      : null;
    const createdLabel = t('admin.userTable.createdOn', {date: formatDate(user.created_at), default: `Created ${formatDate(user.created_at)}`});

    return [ownerLabel, createdLabel].filter(Boolean).join(' • ');
  }, [formatDate, isPersonalAccount, t]);

  const tierName = (tier: string) => {
    switch (tier) {
      case 'tier_2_20':
        return '20 USD';
      case 'tier_6_50':
        return '40 USD';
      case 'tier_25_200':
        return '100 USD';
      default:
        return 'Unknown';
    }
  };

  const columns: DataTableColumn<UserSummary>[] = useMemo(() => [
    {
      id: 'account',
      header: t('admin.userTable.account', {default: 'Account'}),
      cell: (user) => (
        <div className="flex flex-col gap-1 min-w-[200px]">
          <div className="font-medium text-foreground">{getAccountName(user)}</div>
          <div className="text-xs text-muted-foreground">{getAccountMeta(user)}</div>
        </div>
      ),
    },
    {
      id: 'accountType',
      header: t('admin.userTable.accountType', {default: 'Type'}),
      cell: (user) => (
        <Badge variant={isPersonalAccount(user) ? 'outline' : 'secondary'}>
          {isPersonalAccount(user)
            ? t('admin.userTable.personal', {default: 'Personal'})
            : t('admin.userTable.team', {default: 'Team'})}
        </Badge>
      ),
      width: 'w-32',
    },
    {
      id: 'tier',
      header: t('admin.userTable.tier', {default: 'Tier'}),
      cell: (user) => (
        <Badge variant="outline" className="capitalize">
          {tierName(user.tier)}
        </Badge>
      ),
      width: 'w-42',
    },
    {
      id: 'balance',
      header: t('admin.userTable.creditBalance', {default: 'Credit Balance'}),
      cell: (user) => (
        <div className="text-start">
          <div className="font-medium text-green-600">
            {formatCurrency(user.credit_balance)}
          </div>
        </div>
      ),
      width: 'w-42',
    },
    {
      id: 'actions',
      header: t('admin.userTable.actions', {default: 'Actions'}),
      cell: (user) => (
        <Button 
          variant="outline" 
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onUserSelect?.(user);
          }}
        >
          {t('admin.userTable.details', {default: 'Details'})}
        </Button>
      ),
      width: 'w-32',
    },
  ], [getAccountMeta, getAccountName, isPersonalAccount, onUserSelect, t]);

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
  };

  if (error) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-destructive">
            Failed to load users: {error.message}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="search-email"
            placeholder={t('admin.userTable.searchByAccount', {default: 'Search by email or team name...'})}
            value={searchEmail}
            onChange={(e) => setSearchEmail(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="w-full md:w-56">
          <Label htmlFor="account-type" className="sr-only">
            {t('admin.userTable.accountType', {default: 'Account Type'})}
          </Label>
          <Select value={accountTypeFilter} onValueChange={handleAccountTypeChange}>
            <SelectTrigger id="account-type">
              <SelectValue placeholder={t('admin.userTable.accountType', {default: 'Account Type'})} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('admin.userTable.allAccounts', {default: 'All accounts'})}</SelectItem>
              <SelectItem value="personal">{t('admin.userTable.personal', {default: 'Personal'})}</SelectItem>
              <SelectItem value="team">{t('admin.userTable.team', {default: 'Team'})}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <Card className='border-0 shadow-none bg-transparent'>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center space-x-4">
                  <Skeleton className="h-12 w-full" />
                </div>
              ))}
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={userListResponse?.data || []}
              onRowClick={onUserSelect}
              emptyMessage={t('admin.userTable.emptyMessage', {default: 'No users found matching your criteria'})}
              getItemId={(user) => user.id}
            />
          )}
        </CardContent>
      </Card>
      {userListResponse?.pagination && (
        <Pagination
          currentPage={userListResponse.pagination.current_page}
          totalPages={userListResponse.pagination.total_pages}
          onPageChange={handlePageChange}
        />
      )}
    </div>
  );
} 
