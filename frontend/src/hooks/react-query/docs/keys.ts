import { createQueryKeys } from '@/hooks/use-query';

const docsBase = ['docs'] as const;

export const docsKeys = createQueryKeys({
  all: docsBase,
  detail: (itemId: string | null) => [...docsBase, itemId] as const,
  blocks: (itemId: string | null) => [...docsBase, itemId, 'blocks'] as const,
});
