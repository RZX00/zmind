export const knowledgeBaseKeys = {
    all: ['knowledge-base'] as const,
    // Keeping minimal keys; legacy agent/thread keys removed with migration.
    // Agent-scoped assignments/listing invalidation (used by useAgentStream finalize)
    agent: (agentId: string) => [...knowledgeBaseKeys.all, 'agent', agentId] as const,
    entry: (entryId: string) => [...knowledgeBaseKeys.all, 'entry', entryId] as const,
  };
