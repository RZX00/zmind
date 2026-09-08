'use client';

import { useEffect, Suspense } from 'react';
import { useParams } from 'next/navigation';
import { useSidebar } from '@/components/ui/sidebar';
import DocEditorShell from '@/components/docs/DocEditorShell';
import { Skeleton } from '@/components/ui/skeleton';

const AUTO_COLLAPSE_SIDEBAR_KEY = 'sidebar:autoCollapseOnCanvasOpen';

export default function DocPage() {
  const params = useParams<{ itemId: string }>();
  const itemId = params?.itemId;
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

  if (!itemId) return null;

  return (
    <div className="h-screen w-full overflow-hidden">
      <Suspense fallback={<div className="p-6"><Skeleton className="h-8 w-40" /></div>}>
        <DocEditorShell itemId={itemId} />
      </Suspense>
    </div>
  );
}
