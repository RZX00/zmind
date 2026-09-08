'use client';

import React from 'react';
import { ThemeSwitcher } from '@/components/theme/theme-switcher';
import { cn } from '@/lib/utils';
import type { DocsThemeToggleProps } from './types';

export const DocsThemeToggle = ({
  size = 'sm',
  variant = 'ghost',
  className,
}: DocsThemeToggleProps) => {
  return (
    <ThemeSwitcher
      variant={variant}
      size={size}
      className={cn('h-8 w-8 p-0', className)}
    />
  );
};
