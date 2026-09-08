'use client';

import { useMutation } from '@tanstack/react-query';

export function useExportAgent() {
  return useMutation({
    mutationFn: async (_agentId: string) => {
      // Stub: simulate export
      return { success: true } as const;
    },
  });
}

