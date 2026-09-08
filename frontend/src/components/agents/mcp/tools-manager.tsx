import React, { useEffect, useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ToolsManagerProps } from './types';
import { ToolsLoader } from './tools-loader';
import { cn } from '@/lib/utils';

interface ToolItem {
  name: string;
  description: string;
  enabled: boolean;
}

export const ToolsManager: React.FC<ToolsManagerProps> = ({
  mode,
  agentId,
  mcpConfig,
  mcpName,
  open,
  onOpenChange,
  onToolsUpdate,
  versionData,
  saveMode = 'direct',
  versionId,
  initialEnabledTools = [],
}) => {
  const [tools, setTools] = useState<ToolItem[]>([]);
  const [selectedTools, setSelectedTools] = useState<string[]>(initialEnabledTools);
  const [isSaving, setIsSaving] = useState(false);

  const handleToolsLoaded = useCallback((loadedTools: ToolItem[]) => {
    setTools(loadedTools);
    const initiallyEnabled = loadedTools
      .filter(t => t.enabled)
      .map(t => t.name);
    setSelectedTools(initiallyEnabled.length > 0 ? initiallyEnabled : initialEnabledTools);
  }, [initialEnabledTools]);

  useEffect(() => {
    if (!open) {
      setTools([]);
      setSelectedTools(initialEnabledTools);
      setIsSaving(false);
    }
  }, [open, initialEnabledTools]);

  const toggleTool = (toolName: string) => {
    setSelectedTools(prev => {
      if (prev.includes(toolName)) {
        return prev.filter(name => name !== toolName);
      }
      return [...prev, toolName];
    });
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      onToolsUpdate(selectedTools);
      onOpenChange(false);
    } finally {
      setIsSaving(false);
    }
  };

  const mcpUrl = mcpConfig?.url || '';
  const mcpType = (mcpConfig?.type || 'http') as 'http' | 'sse';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl h-[80vh] flex flex-col p-0">
        <DialogHeader className="p-6 pb-4 border-b">
          <DialogTitle>
            Configure Tools for {mcpName || 'MCP Server'}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 flex flex-col">
          <ToolsLoader
            agentId={agentId || ''}
            mcpUrl={mcpUrl}
            mcpType={mcpType}
            initialEnabledTools={initialEnabledTools}
            onToolsLoaded={handleToolsLoaded}
            className="flex-1"
          />

          {tools.length > 0 && (
            <ScrollArea className="flex-1">
              <div className="p-6 space-y-3">
                {tools.map(tool => (
                  <div
                    key={tool.name}
                    className={cn(
                      'flex items-start gap-3 rounded-md border p-3 cursor-pointer',
                      selectedTools.includes(tool.name) ? 'bg-muted/60 border-primary/40' : 'hover:bg-muted/40'
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
                        {tool.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>

        <div className="flex justify-between items-center p-4 border-t">
          <div className="text-xs text-muted-foreground">
            {selectedTools.length} tool{selectedTools.length === 1 ? '' : 's'} selected
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

