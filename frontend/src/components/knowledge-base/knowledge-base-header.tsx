'use client';

import React from 'react';
import {useTranslations} from 'next-intl';
import { BookOpen } from 'lucide-react';
import { useFileStorageUsage } from '@/hooks/react-query/files';
import { Button } from '@/components/ui/button';
import { useRouter } from '@/i18n/routing';
import { useWorkspace } from '@/contexts/workspace-context';
import { buildTeamScopedPath } from '@/lib/workspace-path';

const formatBytes = (bytes: number) => {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, idx);
  const fixed = idx === 0 ? 0 : 1;
  return `${value.toFixed(fixed)} ${units[idx]}`;
};

export const KnowledgeBasePageHeader = () => {
  const t = useTranslations();
  const router = useRouter();
  const { teamSlug } = useWorkspace();
  const subscriptionPath = buildTeamScopedPath('/subscription', teamSlug);
  const { data: storageUsage, isLoading } = useFileStorageUsage(true);
  const usedBytes = storageUsage?.used_bytes ?? 0;
  const totalBytes = storageUsage?.max_total_bytes ?? 0;
  const usagePercent = totalBytes ? Math.min(100, Math.round((usedBytes / totalBytes) * 100)) : 0;
  const isFull = totalBytes > 0 && usedBytes >= totalBytes;
  const usageLabel = isLoading
    ? t('knowledge.loading', {default: 'Loading...'})
    : totalBytes
      ? t('knowledge.quota.usage', {
        used: formatBytes(usedBytes),
        total: formatBytes(totalBytes),
        default: `${formatBytes(usedBytes)} / ${formatBytes(totalBytes)}`,
      })
      : t('knowledge.quota.inlineUnavailable', {default: 'Storage unavailable'});
  return (
    <div className="border-b">
      <div className="flex items-center justify-between gap-4 px-6 py-4">
        <div className="flex items-center gap-3">
          <BookOpen className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-2xl font-semibold text-foreground">
            {t('knowledge.title', {default: 'Knowledge Base'})}
          </h1>
        </div>
        <div className="flex items-center gap-4">
          <div className="min-w-[240px]">
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold text-muted-foreground">
                {t('knowledge.quota.title', {default: 'Storage'})}
              </span>
              <span className="font-medium text-foreground">{usageLabel}</span>
            </div>
            {!isLoading && totalBytes ? (
              <div className="mt-2 h-1 w-full rounded-none bg-muted">
                <div className="h-1 rounded-none bg-emerald-500" style={{ width: `${usagePercent}%` }} />
              </div>
            ) : (
              <div className="mt-2 h-1 w-full rounded-none bg-muted" />
            )}
          </div>
          {isFull && (
            <Button size="sm" onClick={() => router.push(subscriptionPath)}>
              {t('knowledge.quota.manageUpgrade', {default: 'Upgrade plan'})}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
