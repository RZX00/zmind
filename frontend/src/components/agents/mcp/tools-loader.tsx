import React, { useEffect, useState } from 'react';
import { backendApi } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Tool {
  name: string;
  description: string;
  enabled: boolean;
}

interface ToolsLoaderProps {
  agentId: string;
  mcpUrl: string;
  mcpType: 'http' | 'sse' | 'composio';
  initialEnabledTools?: string[];
  onToolsLoaded: (tools: Tool[]) => void;
  className?: string;
}

export const ToolsLoader: React.FC<ToolsLoaderProps> = ({
  agentId,
  mcpUrl,
  mcpType,
  initialEnabledTools = [],
  onToolsLoaded,
  className,
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadTools = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await backendApi.get(`/agents/${agentId}/custom-mcp-tools`, {
          headers: {
            'X-MCP-URL': mcpUrl,
            'X-MCP-Type': mcpType,
          },
        });

        if (response?.data?.tools) {
          const tools: Tool[] = response.data.tools.map((tool: any) => ({
            name: tool.name,
            description: tool.description,
            enabled: tool.enabled ?? initialEnabledTools.includes(tool.name),
          }));
          onToolsLoaded(tools);
        } else {
          throw new Error('No tools returned from server');
        }
      } catch (err: any) {
        console.error('Failed to load tools:', err);
        setError(err.message || 'Failed to load tools');
      } finally {
        setIsLoading(false);
      }
    };

    void loadTools();
  }, [agentId, mcpUrl, mcpType, initialEnabledTools, onToolsLoaded]);

  if (isLoading) {
    return (
      <div className={cn('flex items-center justify-center py-8', className)}>
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        <span className="text-sm text-muted-foreground">Discovering tools from MCP server...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn('flex flex-col items-center justify-center py-8', className)}>
        <p className="text-sm text-red-500 mb-2">{error}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            // Force reload by resetting state
            setIsLoading(true);
            setError(null);
          }}
        >
          Retry
        </Button>
      </div>
    );
  }

  return null;
};

