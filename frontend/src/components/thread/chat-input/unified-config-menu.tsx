'use client';

import React, { useMemo, useState } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { ChevronDown, CheckIcon, Loader2 } from '@/components/ui/icons';
import { ZmindLogo } from '@/components/sidebar/zmind-logo';
import { getModelIconUrl } from '@/lib/model-icons';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

// Local fallback types to decouple from model-store (which may be removed)
type ModelOption = {
  id: string;
  label: string;
  requiresSubscription?: boolean;
  providerBlocked?: boolean;
};
type SubscriptionStatus = 'no_subscription' | 'active' | 'past_due' | 'canceled';

type UnifiedConfigMenuProps = {
    isLoggedIn?: boolean;

    // Model
    selectedModel: string;
    onModelChange: (modelId: string) => void;
    modelOptions: ModelOption[];
    isLoadingModels?: boolean;
    modelError?: Error | null;
    subscriptionStatus: SubscriptionStatus;
    canAccessModel: (modelId: string) => boolean;
    refreshCustomModels?: () => void;
    onUpgradeRequest?: () => void;
};

const LoggedInMenu: React.FC<UnifiedConfigMenuProps> = ({
  selectedModel,
  onModelChange,
  modelOptions,
  isLoadingModels = false,
  modelError = null,
  canAccessModel,
  onUpgradeRequest,
  refreshCustomModels,
}) => {
  const [open, setOpen] = useState(false);

  const hasOptions = (modelOptions?.length || 0) > 0;
  const effectiveModelId = useMemo(() => {
    if (selectedModel && modelOptions.some(m => m.id === selectedModel)) {
      return selectedModel;
    }
    return hasOptions ? modelOptions[0].id : selectedModel;
  }, [selectedModel, hasOptions, modelOptions]);

  const selectedLabel = useMemo(() => {
    if (isLoadingModels) return 'Loading models...';
    if (!hasOptions) {
      if (modelError) return 'Model list failed. Click to retry';
      return 'Loading models...';
    }
    return (modelOptions.find((m) => m.id === effectiveModelId)?.label) || effectiveModelId || 'Model';
  }, [isLoadingModels, hasOptions, modelError, modelOptions, effectiveModelId]);

  const handleSelect = (model: ModelOption, accessible: boolean) => {
    if (accessible) {
      onModelChange(model.id);
      setOpen(false);
      return;
    }
    if (model.requiresSubscription) {
      onUpgradeRequest?.();
    }
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 bg-transparent border-0 rounded-xl text-muted-foreground hover:text-foreground hover:bg-accent/10 flex items-center gap-1.5"
          aria-label="Model menu"
          aria-busy={isLoadingModels}
          type="button"
          onClick={() => {
            if (!hasOptions && refreshCustomModels) {
              refreshCustomModels();
            }
          }}
        >
          <div className="flex items-center gap-2 min-w-0 max-w-[220px]">
            {(() => {
              const iconUrl = getModelIconUrl(effectiveModelId);
              if (iconUrl) {
                return (
                  <Image
                    src={iconUrl}
                    alt="model"
                    width={16}
                    height={16}
                    unoptimized
                    loader={({ src }) => src}
                    className="w-4 h-4 flex-shrink-0"
                  />
                );
              }
              return (
                <div className="flex-shrink-0">
                  <ZmindLogo size={20} />
                </div>
              );
            })()}
            <span className="truncate text-sm font-medium">{selectedLabel}</span>
            {isLoadingModels ? (
              <Loader2 size={12} className="opacity-60 flex-shrink-0 animate-spin" />
            ) : (
              <ChevronDown size={12} className="opacity-60 flex-shrink-0" />
            )}
          </div>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        className="w-72 max-h-52 border border-border bg-card p-1 shadow-md overflow-hidden relative z-[2000]"
        side="bottom"
        align="end"
        sideOffset={8}
        onCloseAutoFocus={(event) => {
          // Keep focus on trigger so keyboard users stay in place
          event.preventDefault();
        }}
      >
        {!hasOptions ? (
          <div className="flex items-center justify-between gap-2 px-3 py-2 text-sm text-muted-foreground">
            <span>{isLoadingModels ? 'Loading models...' : 'Models unavailable. Retry'}</span>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => refreshCustomModels?.()}
            >
              Retry
            </Button>
          </div>
        ) : (
          <div
            className="max-h-44 overflow-y-auto pr-1"
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
            <style jsx>{`
              div::-webkit-scrollbar {
                width: 0;
                height: 0;
              }
            `}</style>
            {modelOptions.map((model) => {
              const accessible = canAccessModel(model.id);
              const isSelected = model.id === selectedModel;
              const iconUrl = getModelIconUrl(model.id);
              const unavailableTag = model.providerBlocked
                ? 'Disabled'
                : model.requiresSubscription
                  ? 'Upgrade'
                  : 'Unavailable';
              return (
                <DropdownMenuItem
                  key={model.id}
                  onSelect={(event) => {
                    event.preventDefault();
                    handleSelect(model, accessible);
                  }}
                  className={cn(
                    'px-3 py-2 flex items-center justify-between gap-2 rounded-lg text-sm focus:bg-accent focus:text-accent-foreground',
                    !accessible && 'opacity-70'
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {iconUrl ? (
                      <Image
                        src={iconUrl}
                        alt={model.label}
                        width={14}
                        height={14}
                        unoptimized
                        loader={({ src }) => src}
                        className="w-3.5 h-3.5 flex-shrink-0"
                      />
                    ) : null}
                    <span className="truncate">{model.label}</span>
                    {!accessible && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                        {unavailableTag}
                      </span>
                    )}
                  </div>
                  {isSelected && <CheckIcon size={14} className="opacity-80" />}
                </DropdownMenuItem>
              );
            })}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const GuestMenu: React.FC<UnifiedConfigMenuProps> = ({ selectedModel, modelOptions }) => {
  const selectedLabel = (modelOptions.find(m => m.id === selectedModel)?.label) || selectedModel || 'Model';
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 bg-transparent border-0 rounded-xl text-muted-foreground hover:text-foreground hover:bg-accent/50 flex items-center gap-1.5 cursor-not-allowed opacity-80 pointer-events-none"
              disabled
            >
              <div className="flex items-center gap-2 min-w-0 max-w-[180px]">
                <div className="flex-shrink-0">
                  <ZmindLogo size={20} />
                </div>
                <span className="truncate text-sm font-medium">{selectedLabel}</span>
                <ChevronDown size={12} className="opacity-60 flex-shrink-0" />
              </div>
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          <p>Log in to access model selection</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export const UnifiedConfigMenu: React.FC<UnifiedConfigMenuProps> = (props) => {
  if (props.isLoggedIn) {
    return <LoggedInMenu {...props} />;
  }
  return <GuestMenu {...props} />;
};

export default UnifiedConfigMenu;
