'use client';

import { useState } from 'react';
import {
  DehydratedState,
  HydrationBoundary,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { handleApiError } from '@/lib/error-handler';
import { isLocalMode } from '@/lib/config';
import { BillingError, AgentRunLimitError } from '@/lib/api';

export function ReactQueryProvider({
  children,
  dehydratedState,
}: {
  children: React.ReactNode;
  dehydratedState?: DehydratedState | null;
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 60 * 1000, // 5分钟缓存 - 大幅减少重复请求
            gcTime: 10 * 60 * 1000,   // 10分钟垃圾回收 - 更长的内存保持
            retry: (failureCount, error: any) => {
              if (error?.status >= 400 && error?.status < 500) return false;
              if (error?.status === 404) return false;
              return failureCount < 3;
            },
            refetchOnMount: false,       // 依赖staleTime缓存策略
            refetchOnWindowFocus: false, // 避免频繁重新获取
            refetchOnReconnect: 'always',
            // 启用预取以提升性能
            networkMode: 'online',
            // 对于慢速查询启用更长的缓存
            notifyOnChangeProps: 'all',
          },
          mutations: {
            retry: (failureCount, error: any) => {
              if (error?.status >= 400 && error?.status < 500) return false;
              return failureCount < 1;
            },
            onError: (error: any, variables: any, context: any) => {
              // Don't globally handle errors that are expected to be handled by components
              if (error instanceof BillingError || error instanceof AgentRunLimitError) {
                return; // Let components handle these specific errors
              }
              if ((error as any)?.suppressGlobalError) {
                return;
              }
              handleApiError(error, {
                operation: 'perform action',
                silent: false,
              });
            },
          },
        },
      }),
  );

  const isLocal = isLocalMode();

  return (
    <QueryClientProvider client={queryClient}>
      <HydrationBoundary state={dehydratedState ?? null}>
        {children}
        {isLocal && (
          <ReactQueryDevtools initialIsOpen={false} />
        )}
      </HydrationBoundary>
    </QueryClientProvider>
  );
}
