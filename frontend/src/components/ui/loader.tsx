'use client';

import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type Size = 'sm' | 'md' | 'lg' | 'xl';

const sizeMap: Record<Size, { icon: string; container: string }> = {
  sm: { icon: 'h-4 w-4', container: 'h-4 w-4' },
  md: { icon: 'h-6 w-6', container: 'h-6 w-6' },
  lg: { icon: 'h-8 w-8', container: 'h-8 w-8' },
  xl: { icon: 'h-10 w-10', container: 'h-10 w-10' },
};

interface UnifiedLoaderProps {
  size?: Size;
  className?: string;
  center?: boolean;
}

/**
 * UnifiedLoader
 * A single, consistent loader used across the auth flows.
 * Keeps visuals unified without extra runtime deps.
 */
export function UnifiedLoader({ size = 'md', className, center = true }: UnifiedLoaderProps) {
  const s = sizeMap[size];
  const content = (
    <Loader2 className={cn(s.icon, 'animate-spin text-primary')} />
  );

  if (!center) {
    return <div className={cn('inline-flex items-center justify-center', s.container, className)}>{content}</div>;
  }

  return (
    <div className={cn('flex items-center justify-center', className)}>
      {content}
    </div>
  );
}

