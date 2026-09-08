'use client';

import React, { useMemo } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAgents } from '@/hooks/react-query/agents/use-agents';

interface AgentSelectorProps {
  selectedAgentId?: string;
  onAgentSelect: (agentId: string) => void;
  placeholder?: string;
  disabled?: boolean;
  showCreateOption?: boolean;
}

export const AgentSelector: React.FC<AgentSelectorProps> = ({
  selectedAgentId,
  onAgentSelect,
  placeholder = 'Choose an agent',
  disabled = false,
}) => {
  const { data: agentsResponse, isLoading } = useAgents({ limit: 100 });

  const agents = useMemo(() => agentsResponse?.agents ?? [], [agentsResponse?.agents]);

  return (
    <Select
      value={selectedAgentId || ''}
      onValueChange={onAgentSelect}
      disabled={disabled || isLoading}
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder={isLoading ? 'Loading agents...' : placeholder} />
      </SelectTrigger>
      <SelectContent>
        {agents.map((agent) => (
          <SelectItem key={agent.agent_id} value={agent.agent_id}>
            {agent.name || 'Untitled Agent'}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};
