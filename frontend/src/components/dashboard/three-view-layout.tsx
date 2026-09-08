'use client';

import React from 'react';

interface ThreeViewLayoutProps {
  children: React.ReactNode;
}

export function ThreeViewLayout({ children }: ThreeViewLayoutProps) {
  return <div className="h-full w-full">{children}</div>;
}
