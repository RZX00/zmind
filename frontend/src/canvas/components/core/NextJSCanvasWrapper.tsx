'use client';

import React from 'react';
import { useRouter, usePathname } from '@/i18n/routing';
import { useSearchParams } from 'next/navigation';

// 创建Next.js路由适配器，模拟react-router-dom的useNavigate
export function useNavigateAdapter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const navigate = React.useCallback((to: string | { pathname?: string; search?: string }) => {
    if (typeof to === 'string') {
      router.push(to);
    } else {
      const url = to.pathname || pathname;
      const search = to.search || '';
      router.push(`${url}${search}`);
    }
  }, [router, pathname]);

  return navigate;
}

// 创建路由上下文，为canvas组件提供兼容的路由接口
interface RouteContextValue {
  navigate: ReturnType<typeof useNavigateAdapter>;
  pathname: string;
  search: string;
}

const RouteContext = React.createContext<RouteContextValue | null>(null);

export function RouteProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigateAdapter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();

  const value = React.useMemo(() => ({
    navigate,
    pathname,
    search
  }), [navigate, pathname, search]);

  return (
    <RouteContext.Provider value={value}>
      {children}
    </RouteContext.Provider>
  );
}

export function useRoute() {
  const context = React.useContext(RouteContext);
  if (!context) {
    throw new Error('useRoute must be used within RouteProvider');
  }
  return context;
}

// 为现有canvas组件提供useNavigate hook兼容性
export function useNavigate() {
  const { navigate } = useRoute();
  return navigate;
}
