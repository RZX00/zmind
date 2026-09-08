'use client';

import { AlertCircle, X, Info } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useEffect, useState } from 'react';
import {useTranslations, useFormatter} from 'next-intl';

interface MaintenanceBannerProps {
  startTime: string; // ISO string
  endTime: string; // ISO string
}

export function MaintenanceBanner({
  startTime,
  endTime,
}: MaintenanceBannerProps) {
  const [timeDisplay, setTimeDisplay] = useState<string>('');
  const [isMaintenanceActive, setIsMaintenanceActive] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const t = useTranslations();
  const format = useFormatter();

  // Create a unique key for this maintenance window
  const maintenanceKey = `maintenance-dismissed-${startTime}-${endTime}`;

  useEffect(() => {
    setIsMounted(true);
    // Check if this maintenance has been dismissed
    const dismissed = localStorage.getItem(maintenanceKey);
    if (dismissed === 'true') {
      setIsDismissed(true);
    }
  }, [maintenanceKey]);

  useEffect(() => {
    const updateCountdown = () => {
      const now = new Date();
      const start = new Date(startTime);
      const end = new Date(endTime);

      // Check if maintenance is currently active
      if (now >= start && now <= end) {
        setIsMaintenanceActive(true);
        const diffToEnd = end.getTime() - now.getTime();

        if (diffToEnd <= 0) {
          setTimeDisplay(t('maintenance.completed', {default: 'Maintenance completed'}));
          return;
        }

        const hours = Math.floor(diffToEnd / (1000 * 60 * 60));
        const minutes = Math.floor(
          (diffToEnd % (1000 * 60 * 60)) / (1000 * 60),
        );

        if (hours > 0) {
          setTimeDisplay(t('maintenance.remainingHm', {hours, minutes, default: `${hours}h ${minutes}m remaining`}));
        } else {
          setTimeDisplay(t('maintenance.remainingM', {minutes, default: `${minutes}m remaining`}));
        }
      } else if (now < start) {
        // Maintenance hasn't started yet
        setIsMaintenanceActive(false);
        const diffToStart = start.getTime() - now.getTime();

        if (diffToStart <= 0) {
          setTimeDisplay(t('maintenance.startingNow', {default: 'starting now'}));
          return;
        }

        const days = Math.floor(diffToStart / (1000 * 60 * 60 * 24));
        const hours = Math.floor(
          (diffToStart % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60),
        );
        const minutes = Math.floor(
          (diffToStart % (1000 * 60 * 60)) / (1000 * 60),
        );

        if (days > 0) {
          setTimeDisplay(t('maintenance.startingIn', {time: `${days}d ${hours}h`, default: 'starting in {time}'}));
        } else if (hours > 0) {
          setTimeDisplay(t('maintenance.startingIn', {time: `${hours}h ${minutes}m`, default: 'starting in {time}'}));
        } else {
          setTimeDisplay(t('maintenance.startingIn', {time: `${minutes}m`, default: 'starting in {time}'}));
        }
      } else {
        // Maintenance is over
        setTimeDisplay('');
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 60000); // Update every minute

    return () => clearInterval(interval);
  }, [endTime, startTime, t]);

  const handleDismiss = () => {
    setIsDismissed(true);
    localStorage.setItem(maintenanceKey, 'true');
  };

  const formatDateTime = (isoString: string) =>
    format.dateTime(new Date(isoString), {
      weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
    });

  const getDuration = () => {
    const start = new Date(startTime);
    const end = new Date(endTime);
    const diff = end.getTime() - start.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else {
      return `${minutes}m`;
    }
  };

  // Don't show banner if maintenance is over or dismissed
  const now = new Date();
  const end = new Date(endTime);

  // Don't render until mounted (SSR safety)
  if (!isMounted) {
    return null;
  }

  if (now > end || isDismissed) {
    return null;
  }

  return (
    <Alert
      className={`py-2 ${
        isMaintenanceActive
          ? 'border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-950'
          : 'border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950'
      }`}
    >
      <AlertCircle
        className={`h-4 w-4 ${
          isMaintenanceActive
            ? 'text-orange-600 dark:text-orange-400'
            : 'text-yellow-600 dark:text-yellow-400'
        }`}
      />
      <AlertDescription
        className={`flex items-center gap-2 ${
          isMaintenanceActive
            ? 'text-orange-700 dark:text-orange-300'
            : 'text-yellow-700 dark:text-yellow-300'
        }`}
      >
        <span className="font-medium">
          {isMaintenanceActive
            ? t('maintenance.inProgress', {default: 'Scheduled maintenance in progress'})
            : t('maintenance.scheduled', {default: 'Scheduled maintenance'})}
        </span>
        {timeDisplay && (
          <>
            <span>•</span>
            <span>{timeDisplay}</span>
          </>
        )}

        {/* Info icon with tooltip */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Info className="h-3 w-3 cursor-help opacity-60 hover:opacity-100 transition-opacity" />
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            <div className="space-y-1 text-xs">
              {!isMaintenanceActive && (
                <div>{t('maintenance.starts', {time: formatDateTime(startTime), default: 'Starts: {time}'})}</div>
              )}
              <div>
                {isMaintenanceActive ? t('maintenance.expected', {time: formatDateTime(endTime), default: 'Expected completion: {time}'}) : t('maintenance.ends', {time: formatDateTime(endTime), default: 'Ends: {time}'})}
              </div>
              <div>{t('maintenance.duration', {time: getDuration(), default: 'Duration: {time}'})}</div>
            </div>
          </TooltipContent>
        </Tooltip>
      </AlertDescription>

      {/* Dismiss button */}
      <Button
        variant="ghost"
        size="sm"
        className={`absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 p-0 hover:bg-transparent ${
          isMaintenanceActive
            ? 'text-orange-600 hover:text-orange-800 dark:text-orange-400 dark:hover:text-orange-200'
            : 'text-yellow-600 hover:text-yellow-800 dark:text-yellow-400 dark:hover:text-yellow-200'
        }`}
        onClick={handleDismiss}
        aria-label={t('maintenance.dismiss', {default: 'Dismiss maintenance notice'})}
      >
        <X className="h-3 w-3" />
      </Button>
    </Alert>
  );
}
