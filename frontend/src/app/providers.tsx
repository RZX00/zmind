'use client';

import { ThemeProvider } from 'next-themes';
import { useState, useMemo, createContext, useEffect } from 'react';
import { AuthProvider } from '@/components/AuthProvider';
import { ReactQueryProvider } from '@/providers/react-query-provider';
import { dehydrate, QueryClient } from '@tanstack/react-query';
import { PreferenceHydrator } from '@/components/preferences/preference-hydrator';

export interface ParsedTag {
  tagName: string;
  attributes: Record<string, string>;
  content: string;
  isClosing: boolean;
  id: string; // Unique ID for each tool call instance
  rawMatch?: string; // Raw XML match for deduplication
  timestamp?: number; // Timestamp when the tag was created

  // Pairing and completion status
  resultTag?: ParsedTag; // Reference to the result tag if this is a tool call
  isToolCall?: boolean; // Whether this is a tool call (vs a result)
  isPaired?: boolean; // Whether this tag has been paired with its call/result
  status?: 'running' | 'completed' | 'error'; // Status of the tool call

  // VNC preview for browser-related tools
  vncPreview?: string; // VNC preview image URL
}

// Create the context here instead of importing it
export const ToolCallsContext = createContext<{
  toolCalls: ParsedTag[];
  setToolCalls: React.Dispatch<React.SetStateAction<ParsedTag[]>>;
}>({
  toolCalls: [],
  setToolCalls: () => {},
});

export function Providers({ children }: { children: React.ReactNode }) {
  // Shared state for tool calls across the app
  const [toolCalls, setToolCalls] = useState<ParsedTag[]>([]);
  const [queryClient] = useState(
    () =>
      new QueryClient()
  );
  const dehydratedState = useMemo(() => dehydrate(queryClient), [queryClient]);
  const toolCallsValue = useMemo(
    () => ({ toolCalls, setToolCalls }),
    [toolCalls],
  );

  // Guard against noisy SES/lockdown extension errors and capture diagnostics
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (process.env.NODE_ENV === 'production') return;

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      try {
        // Many wallet/extensions using SES log "SES_UNCAUGHT_EXCEPTION: null" when reason is null/undefined
        if (event.reason == null) {
          // Add useful context and suppress default noisy console output
          console.warn('[UnhandledRejection] Suppressed null/undefined reason', event);
          event.preventDefault();
        }
      } catch {}
    };

    const onError = (event: ErrorEvent) => {
      try {
        // Some extensions surface errors as coming from lockdown-install.js
        const filename = (event as any)?.filename || '';
        if ((filename && filename.includes('lockdown-install.js')) || event.error == null) {
          // Avoid double-reporting extremely unhelpful errors while keeping our own logs informative
          console.warn('[WindowError] Suppressed extension lockdown noise', {
            message: event.message,
            filename,
            lineno: event.lineno,
            colno: event.colno,
          });
          event.preventDefault?.();
        }
      } catch {}
    };

    window.addEventListener('unhandledrejection', onUnhandledRejection);
    window.addEventListener('error', onError);
    return () => {
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
      window.removeEventListener('error', onError);
    };
  }, []);

  return (
    <AuthProvider>
      <ToolCallsContext.Provider value={toolCallsValue}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
          storageKey="zmind-theme"
        >
          <PreferenceHydrator />
          <ReactQueryProvider dehydratedState={dehydratedState}>
            {children}
          </ReactQueryProvider>
        </ThemeProvider>
      </ToolCallsContext.Provider>
    </AuthProvider>
  );
}
