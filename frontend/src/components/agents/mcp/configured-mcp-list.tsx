import React from 'react';
import { MCPConfiguration, ConfiguredMcpListProps } from './types';
import { MCPServerCard } from './mcp-server-card';

export const ConfiguredMcpList: React.FC<ConfiguredMcpListProps> = ({
  configuredMCPs,
  onEdit,
  onRemove,
  onConfigureTools,
}) => {
  if (!configuredMCPs || configuredMCPs.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      {configuredMCPs.map((mcp, index) => {
        const url =
          mcp.customType === 'composio'
            ? `profile_id=${mcp.config?.profile_id || mcp.selectedProfileId || 'unknown'}`
            : (mcp.config?.url || '');
        const type =
          mcp.customType === 'composio'
            ? 'http'
            : (mcp.customType as 'http' | 'sse') || 'http';

        return (
          <MCPServerCard
            key={mcp.qualifiedName || `${mcp.name}-${index}`}
            name={mcp.name}
            url={url}
            type={type}
            isCustom={!!mcp.isCustom}
            toolsCount={mcp.enabledTools?.length}
            onConfigure={() => onConfigureTools(index)}
            onEdit={() => onEdit(index)}
            onRemove={() => onRemove(index)}
          />
        );
      })}
    </div>
  );
};

