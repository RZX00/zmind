'use client';

import React from 'react';
import { AlertTriangle, CheckCircle2, GitBranchPlus, Layers3, Sparkles } from 'lucide-react';

import type { CanvasPreviewMessage } from '@/components/thread/types';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface CanvasPreviewCardProps {
  preview: CanvasPreviewMessage;
  className?: string;
}

const RISK_STYLES: Record<string, string> = {
  low: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  medium: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  high: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
};

function toCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function formatRiskLabel(riskLevel?: string): string {
  if (!riskLevel) return 'Review';
  const normalized = riskLevel.trim().toLowerCase();
  if (normalized === 'low') return 'Low risk';
  if (normalized === 'medium') return 'Needs review';
  if (normalized === 'high') return 'High impact';
  return riskLevel;
}

function summarizeOperations(operationSummary?: Record<string, any>): Array<{ key: string; label: string; value: number }> {
  if (!operationSummary) return [];
  const entries = [
    { key: 'add_node', label: 'Add nodes', value: toCount(operationSummary.add_node) },
    { key: 'update_node', label: 'Update nodes', value: toCount(operationSummary.update_node) },
    { key: 'move_node', label: 'Move nodes', value: toCount(operationSummary.move_node) },
    { key: 'delete_node', label: 'Delete nodes', value: toCount(operationSummary.delete_node) },
    { key: 'add_connection', label: 'Add links', value: toCount(operationSummary.add_connection) },
    { key: 'delete_connection', label: 'Delete links', value: toCount(operationSummary.delete_connection) },
  ];
  return entries.filter((entry) => entry.value > 0);
}

export const CanvasPreviewCard: React.FC<CanvasPreviewCardProps> = ({ preview, className }) => {
  const riskLevel = String(preview.risk_level || '').toLowerCase();
  const operationItems = summarizeOperations(preview.operation_summary);
  const impactedNodes = Array.isArray(preview.impacted_node_ids) ? preview.impacted_node_ids.length : 0;
  const impactedConnections = Array.isArray(preview.impacted_connection_ids) ? preview.impacted_connection_ids.length : 0;
  const verifyLevel = preview.verification_summary?.level || 'lightweight';
  const verifyCount = toCount(preview.verification_summary?.check_count);
  const focusScope = typeof preview.planning_summary?.focus_scope === 'string'
    ? preview.planning_summary.focus_scope
    : preview.selection_scope || 'canvas';

  return (
    <Card className={cn('overflow-hidden border-border/70 bg-card/80 shadow-sm', className)}>
      <div className="border-b border-border/60 bg-muted/30 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Sparkles className="h-4 w-4 text-primary" />
            <span>Canvas update preview</span>
          </div>
          <Badge
            variant="outline"
            className={cn('capitalize', RISK_STYLES[riskLevel] || 'border-border/60 bg-muted/40 text-foreground')}
          >
            {riskLevel === 'high' ? <AlertTriangle className="mr-1 h-3.5 w-3.5" /> : <CheckCircle2 className="mr-1 h-3.5 w-3.5" />}
            {formatRiskLabel(preview.risk_level)}
          </Badge>
          {typeof preview.expected_canvas_version === 'number' && (
            <Badge variant="secondary" className="font-normal">
              Canvas v{preview.expected_canvas_version}
            </Badge>
          )}
        </div>
        {preview.user_goal ? (
          <p className="mt-2 text-sm text-muted-foreground">{preview.user_goal}</p>
        ) : null}
      </div>

      <div className="grid gap-4 px-4 py-4 md:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-3">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Planned changes</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {operationItems.length > 0 ? operationItems.map((item) => (
                <div
                  key={item.key}
                  className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/80 px-3 py-1 text-sm text-foreground"
                >
                  <span>{item.label}</span>
                  <span className="font-medium">{item.value}</span>
                </div>
              )) : (
                <div className="rounded-full border border-border/60 bg-background/80 px-3 py-1 text-sm text-muted-foreground">
                  No structural diff detected yet
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-border/60 bg-background/70 p-3">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Layers3 className="h-3.5 w-3.5" />
                Impact
              </div>
              <div className="mt-2 text-sm text-foreground">
                {impactedNodes} nodes and {impactedConnections} links
              </div>
            </div>

            <div className="rounded-xl border border-border/60 bg-background/70 p-3">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <GitBranchPlus className="h-3.5 w-3.5" />
                Verification
              </div>
              <div className="mt-2 text-sm text-foreground capitalize">
                {verifyLevel} check set
              </div>
              <div className="text-xs text-muted-foreground">{verifyCount} checks queued before completion</div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-dashed border-border/70 bg-background/60 p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Execution scope</div>
          <div className="mt-2 space-y-2 text-sm text-foreground">
            <div className="flex items-start justify-between gap-3">
              <span className="text-muted-foreground">Focus</span>
              <span className="text-right capitalize">{focusScope}</span>
            </div>
            <div className="flex items-start justify-between gap-3">
              <span className="text-muted-foreground">Target canvas</span>
              <span className="text-right">{preview.target_canvas_id || 'Current canvas'}</span>
            </div>
            <div className="flex items-start justify-between gap-3">
              <span className="text-muted-foreground">Plan</span>
              <span className="text-right">{preview.plan_id || 'Pending plan'}</span>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
};

export default CanvasPreviewCard;
