import React from 'react';
import { cn } from '@/lib/utils';
import type { RunMode } from '@/lib/run-mode';

interface RunModeMenuProps {
  runMode: RunMode;
  onSelect: (mode: RunMode) => void;
}

const RUN_MODE_OPTIONS: Array<{
  value: RunMode;
  label: string;
  hint: string;
}> = [
  { value: 'agent', label: 'Agent', hint: 'Actions enabled' },
  { value: 'chat', label: 'Chat', hint: 'Read-only' },
];

export const RunModeMenu: React.FC<RunModeMenuProps> = ({ runMode, onSelect }) => {
  return (
    <>
      <div className="px-2 pb-1 text-[11px] text-muted-foreground">Mode</div>
      <div className="space-y-1">
        {RUN_MODE_OPTIONS.map((mode) => {
          const isActive = runMode === mode.value;
          return (
            <button
              key={mode.value}
              type="button"
              onClick={() => onSelect(mode.value)}
              aria-pressed={isActive}
              className={cn(
                'w-full rounded-md px-2.5 py-2 text-left transition-colors',
                isActive
                  ? 'bg-muted/60 text-foreground'
                  : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
              )}
            >
              <div className="text-xs font-medium">{mode.label}</div>
              <div className="text-[11px] text-muted-foreground">{mode.hint}</div>
            </button>
          );
        })}
      </div>
    </>
  );
};
