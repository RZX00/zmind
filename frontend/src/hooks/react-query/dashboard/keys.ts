import { createQueryKeys } from '@/hooks/use-query';

const dashboardKeysBase = ['dashboard'] as const;
const dashboardAgentsBase = ['dashboard', 'agents'] as const;

export const dashboardKeys = createQueryKeys({
  all: dashboardKeysBase,
  agents: dashboardAgentsBase,
  initiateAgent: () => [...dashboardAgentsBase, 'initiate'] as const,
  // 新增的聚合数据查询键
  data: (workspaceId?: string | null) => [...dashboardKeysBase, 'aggregated-data', workspaceId ?? 'personal'] as const,
  stats: (workspaceId?: string | null) => [...dashboardKeysBase, 'stats', workspaceId ?? 'personal'] as const,
  health: (workspaceId?: string | null) => [...dashboardKeysBase, 'health', workspaceId ?? 'personal'] as const,
});
