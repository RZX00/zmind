import type { Agent } from '@/hooks/react-query/agents/use-agents';

export interface MCPConfiguration {
  name: string;
  qualifiedName?: string;
  config: {
    url?: string;
    type?: 'http' | 'sse';
    headers?: Record<string, string>;
    profile_id?: string;
  };
  enabledTools?: string[];
  isCustom?: boolean;
  customType?: 'http' | 'sse' | 'composio';
  selectedProfileId?: string;
  mcp_qualified_name?: string;
  toolkitSlug?: string;
  toolkit_slug?: string;
}

export interface MCPConfigurationProps {
  configuredMCPs: MCPConfiguration[];
  onConfigurationChange: (mcps: MCPConfiguration[]) => void;
  agentId?: string;
  versionData?: {
    configured_mcps?: any[];
    custom_mcps?: any[];
    system_prompt?: string;
    native_tools?: any;
  };
  saveMode?: 'direct' | 'callback';
  versionId?: string;
  isLoading?: boolean;
}

export interface ToolsManagerProps {
  mode: 'custom' | 'agent';
  agentId?: string;
  mcpConfig?: {
    url?: string;
    type?: 'http' | 'sse';
    headers?: Record<string, string>;
  };
  mcpName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onToolsUpdate: (enabledTools: string[]) => void;
  versionData?: {
    configured_mcps?: any[];
    custom_mcps?: any[];
    system_prompt?: string;
    native_tools?: any;
  };
  saveMode?: 'direct' | 'callback';
  versionId?: string;
  initialEnabledTools?: string[];
}

export interface MCPServerCardProps {
  name: string;
  url: string;
  type: 'http' | 'sse';
  toolsCount?: number;
  isCustom?: boolean;
  onConfigure?: () => void;
  onRemove?: () => void;
  onEdit?: () => void;
}

export interface ConfiguredMcpListProps {
  configuredMCPs: MCPConfiguration[];
  onEdit: (index: number) => void;
  onRemove: (index: number) => void;
  onConfigureTools: (index: number) => void;
}

