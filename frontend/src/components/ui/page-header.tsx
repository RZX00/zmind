'use client';

import React from 'react';
import { LucideIcon } from 'lucide-react';

interface PageHeaderProps {
  icon: LucideIcon;
  children: React.ReactNode;
  right?: React.ReactNode;
}

export const PageHeader: React.FC<PageHeaderProps> = ({ icon: Icon, children, right }) => {
  return (
    <div className="dashboard-panel">
      <div className="flex items-center gap-4 px-6 py-5">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted/40 text-foreground">
          <Icon className="h-6 w-6 text-primary" />
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-between gap-4">
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight dashboard-title min-w-0">
            {children}
          </h1>
          {right ? <div className="shrink-0">{right}</div> : null}
        </div>
      </div>
    </div>
  );
}; 
