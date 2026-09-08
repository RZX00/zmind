"use client";

import React, { Suspense, useEffect } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import CanvasEditor from '@/canvas/components/core/CanvasEditor';
import { Skeleton } from '@/components/ui/skeleton';
import { useSidebar } from '@/components/ui/sidebar';

const AUTO_COLLAPSE_SIDEBAR_KEY = 'sidebar:autoCollapseOnCanvasOpen';

export default function CanvasPage() {
  const params = useParams<{ canvasId: string }>();
  const canvasId = params?.canvasId as string;
  // searchParams consumed by child panels (e.g., prompt auto-submit)
  const searchParams = useSearchParams();
  const { setOpen, setOpenMobile } = useSidebar();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const shouldCollapse = sessionStorage.getItem(AUTO_COLLAPSE_SIDEBAR_KEY);
      if (shouldCollapse !== '1') return;
      sessionStorage.removeItem(AUTO_COLLAPSE_SIDEBAR_KEY);
      setOpen(false);
      setOpenMobile(false);
    } catch {}
  }, [setOpen, setOpenMobile]);

  if (!canvasId) return null;

  return (
    <div className="w-full h-screen overflow-y-auto scrollbar-none">
      <Suspense fallback={<div className="p-6"><Skeleton className="h-8 w-40" /></div>}>
        <CanvasEditor canvasId={canvasId} />
      </Suspense>
    </div>
  );
}

