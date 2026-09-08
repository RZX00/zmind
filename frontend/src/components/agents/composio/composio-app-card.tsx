import React from 'react';
import Image from 'next/image';
import type { ComposioToolkit } from '@/hooks/react-query/composio/utils';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface ComposioAppCardProps {
  app: ComposioToolkit;
  isConnected?: boolean;
  onConnect?: () => void;
  onConfigure?: () => void;
}

export const ComposioAppCard: React.FC<ComposioAppCardProps> = ({
  app,
  isConnected,
  onConnect,
  onConfigure,
}) => {
  return (
    <Card
      className={cn(
        'p-4 flex flex-col gap-3 border border-border/60 bg-card hover:bg-muted/30 transition-colors cursor-pointer'
      )}
      onClick={isConnected ? onConfigure : onConnect}
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl border border-border bg-background flex items-center justify-center">
          {app.logo ? (
            <Image
              src={app.logo}
              alt={app.name}
              width={24}
              height={24}
              unoptimized
              loader={({ src }) => src}
              className="w-6 h-6 object-contain"
            />
          ) : (
            <span className="text-foreground text-base font-medium">
              {app.name.charAt(0)}
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-sm truncate">{app.name}</h3>
          {app.categories && app.categories.length > 0 && (
            <p className="text-xs text-muted-foreground truncate">
              {app.categories.join(' · ')}
            </p>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground line-clamp-2 min-h-[2.5rem]">
        {app.description || 'Connect this app to your agent to enable automated workflows.'}
      </p>
      <div className="flex justify-between items-center mt-2">
        <div className="text-xs text-muted-foreground">
          {isConnected ? 'Connected' : 'Not connected'}
        </div>
        <Button
          size="sm"
          variant={isConnected ? 'outline' : 'default'}
          type="button"
        >
          {isConnected ? 'Configure' : 'Connect'}
        </Button>
      </div>
    </Card>
  );
};

