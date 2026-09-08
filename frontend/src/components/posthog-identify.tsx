'use client';

import posthog from 'posthog-js';
import { useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { usePathname } from 'next/navigation';

export const PostHogIdentify = () => {
  const pathname = usePathname();
  const isHome = pathname === '/' || pathname === '/zh';

  useEffect(() => {
    if (isHome) return undefined;

    const supabase = createClient();
    const listener = supabase.auth.onAuthStateChange((_, session) => {
      if (session) {
        posthog.identify(session.user.id, { email: session.user.email });
      } else {
        posthog.reset();
      }
    });

    return () => {
      listener.data.subscription.unsubscribe();
    };
  }, [isHome]);

  return null;
};
