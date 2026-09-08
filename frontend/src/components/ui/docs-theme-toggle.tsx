'use client';

import * as React from 'react';
import { ThemeSwitcher } from '@/components/theme/theme-switcher';
import { cn } from '@/lib/utils';

export interface DocsThemeToggleProps extends React.HTMLAttributes<HTMLButtonElement> {
  size?: 'sm' | 'default' | 'lg';
  variant?: 'default' | 'outline' | 'ghost' | 'secondary';
}

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
