"use client";

import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { summarize, ToolExecution } from './summarizers';
import { cn } from '@/lib/utils';
import { getToolIcon } from '@/components/thread/utils';

interface Props {
  exec: ToolExecution;
  className?: string;
  insetRightPx?: number; // e.g., 16 for 16px right inset
  summaryOverride?: ReturnType<typeof summarize>;
  badgeCount?: number;
  children?: React.ReactNode;
}

export const ToolCallInline: React.FC<Props> = ({ exec, className = '', insetRightPx = 16, summaryOverride, badgeCount, children }) => {
  const summary = React.useMemo(() => summaryOverride || summarize(exec), [exec, summaryOverride]);
  const hasDetails = !!summary.details;
  const hasChildren = React.Children.count(children) > 0;
  const canExpand = Boolean(summary.line) || hasDetails || hasChildren;
  const [isOpen, setIsOpen] = useState(false);

  const style: React.CSSProperties = insetRightPx ? { marginRight: `${insetRightPx}px` } : {};
  const ToolIcon = getToolIcon(exec.xml_tag_name || exec.function_name || 'unknown');

  const toggleOpen = (e: React.MouseEvent) => {
    if (!canExpand) return;
    e.preventDefault();
    e.stopPropagation();
    setIsOpen((prev) => !prev);
  };

  return (
    <div className={cn('w-full font-sans text-sm', className)} style={style}>
      <div
        className={cn('rounded-lg bg-card px-4 py-3 text-card-foreground transition-colors', canExpand && 'cursor-pointer')}
        onClick={toggleOpen}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <ToolIcon
              className={cn(
                'h-4 w-4 text-muted-foreground',
                exec.result?.success === false && 'text-destructive',
              )}
              strokeWidth={2}
            />
            <div className="flex items-center gap-2">
              <span className="text-base font-medium text-foreground">{summary.label}</span>
              {badgeCount && badgeCount > 1 && (
                <span className="inline-flex items-center rounded-full border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  x{badgeCount}
                </span>
              )}
            </div>
          </div>
          {canExpand && (
            <ChevronDown
              className={cn('h-4 w-4 text-muted-foreground transition-transform', isOpen && 'rotate-180')}
              strokeWidth={2}
            />
          )}
        </div>

        {isOpen && summary.line && (
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{summary.line}</p>
        )}

        {isOpen && hasDetails && (
          <div className="mt-2">
            {summary.details}
          </div>
        )}

        {isOpen && hasChildren && (
          <div className="mt-2 space-y-2">
            {children}
          </div>
        )}
      </div>
    </div>
  );
};

export default ToolCallInline;
