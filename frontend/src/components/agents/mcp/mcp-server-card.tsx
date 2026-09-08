import React from 'react';
import { MCPServerCardProps } from './types';
import { Button } from '@/components/ui/button';
import { Settings, Trash2, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

export const MCPServerCard: React.FC<MCPServerCardProps> = ({
  name,
  url,
  type,
  toolsCount,
  isCustom,
  onConfigure,
  onRemove,
  onEdit,
}) => {
  const displayName = name || (type === 'http' ? 'HTTP Server' : 'SSE Server');
  const displayType = type === 'http' ? 'HTTP' : 'SSE';

  return (
    <div className={cn(
      "group flex items-center justify-between rounded-lg border bg-card p-3",
      "hover:bg-muted/50 transition-colors"
    )}>
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 flex items-center justify-center rounded-md bg-primary/10 text-primary">
          <Zap className="h-4 w-4" />
        </div>
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium leading-none">{displayName}</h3>
            <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground bg-muted/50">
              {displayType} {isCustom ? 'Custom' : 'Server'}
            </span>
          </div>
          <p className="text-xs text-muted-foreground truncate max-w-[320px]">
            {url}
          </p>
          {typeof toolsCount === 'number' && (
            <p className="text-xs text-muted-foreground">
              {toolsCount > 0
                ? `${toolsCount} tool${toolsCount === 1 ? '' : 's'} enabled`
                : 'No tools enabled yet'}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {onConfigure && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1 text-xs"
            onClick={onConfigure}
            type="button"
          >
            <Settings className="h-3 w-3" />
            Tools
          </Button>
        )}
        {onEdit && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onEdit}
            type="button"
          >
            <Settings className="h-4 w-4" />
          </Button>
        )}
        {onRemove && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:text-destructive"
            onClick={onRemove}
            type="button"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
};

