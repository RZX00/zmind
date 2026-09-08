import React, { useEffect, useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { composioApi } from '@/hooks/react-query/composio/utils';
import { Loader2 } from 'lucide-react';

interface ComposioToolsSelectorProps {
  profileId: string;
  agentId: string;
  toolkitName: string;
  toolkitSlug: string;
  selectedTools: string[];
  onToolsChange: (tools: string[]) => void;
  onSave: () => void;
  onCancel: () => void;
  className?: string;
}

interface ComposioTool {
  name: string;
  description: string;
}

export const ComposioToolsSelector: React.FC<ComposioToolsSelectorProps> = ({
  profileId,
  agentId,
  toolkitName,
  toolkitSlug,
  selectedTools,
  onToolsChange,
  onSave,
  onCancel,
  className,
}) => {
  const [availableTools, setAvailableTools] = useState<ComposioTool[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadTools = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await composioApi.getTools(toolkitSlug);
        const tools: ComposioTool[] =
          res.tools?.map(t => ({
            name: t.slug || t.name,
            description: t.description || '',
          })) || [];
        setAvailableTools(tools);
      } catch (err: any) {
        console.error('Failed to load Composio tools:', err);
        setError(err.message || 'Failed to load tools');
      } finally {
        setIsLoading(false);
      }
    };

    void loadTools();
  }, [toolkitSlug]);

  const toggleTool = (name: string) => {
    onToolsChange(
      selectedTools.includes(name)
        ? selectedTools.filter(t => t !== name)
        : [...selectedTools, name],
    );
  };

  return (
    <div className={cn('flex flex-col flex-1 min-h-0', className)}>
      <div className="flex-shrink-0 p-4 border-b">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">
            Configure {toolkitName} Tools
          </h2>
          <p className="text-xs text-muted-foreground">
            Select which tools from {toolkitName} should be available to this agent.
          </p>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            <span className="text-sm text-muted-foreground">Loading tools...</span>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full">
            <span className="text-sm text-red-500">{error}</span>
          </div>
        ) : (
          <ScrollArea className="h-full">
            <div className="p-4 space-y-3">
              {availableTools.map(tool => (
                <div
                  key={tool.name}
                  className={cn(
                    'flex items-start gap-3 rounded-md border p-3 cursor-pointer',
                    selectedTools.includes(tool.name)
                      ? 'bg-muted/60 border-primary/40'
                      : 'hover:bg-muted/40',
                  )}
                  onClick={() => toggleTool(tool.name)}
                >
                  <Checkbox
                    checked={selectedTools.includes(tool.name)}
                    onCheckedChange={() => toggleTool(tool.name)}
                    className="mt-0.5"
                  />
                  <div className="space-y-1">
                    <Label className="text-sm font-medium">{tool.name}</Label>
                    <p className="text-xs text-muted-foreground">
                      {tool.description ||
                        'No description available for this tool.'}
                    </p>
                  </div>
                </div>
              ))}
              {availableTools.length === 0 && (
                <div className="text-xs text-muted-foreground text-center py-8">
                  No tools available for this app yet.
                </div>
              )}
            </div>
          </ScrollArea>
        )}
      </div>

      <div className="flex-shrink-0 border-t p-4 flex justify-between items-center">
        <div className="text-xs text-muted-foreground">
          {selectedTools.length} tool{selectedTools.length === 1 ? '' : 's'} selected
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            type="button"
            onClick={onSave}
            disabled={isLoading}
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  );
};

