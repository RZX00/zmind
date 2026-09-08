'use client';

import { useMemo } from 'react';
import { FileText, Link2, Loader2, Radar, SquareStack } from 'lucide-react';
import { useRouter } from '@/i18n/routing';
import { useWorkspace } from '@/contexts/workspace-context';
import { useWorkspaceData } from '@/hooks/useWorkspaceData';
import { useUnifiedSearch } from '@/hooks/react-query/search/use-unified-search';
import { buildCanvasPath, buildDocPath } from '@/lib/workspace-path';
import { cn } from '@/lib/utils';
import type { UnifiedSearchResult } from '@/types/search';

interface UnifiedSearchPanelProps {
  query: string;
  visible: boolean;
  className?: string;
  onResultSelect?: () => void;
}

export default function UnifiedSearchPanel({
  query,
  visible,
  className,
  onResultSelect,
}: UnifiedSearchPanelProps) {
  const router = useRouter();
  const { teamSlug } = useWorkspace();
  const { data: workspaceData } = useWorkspaceData();
  const { data, isFetching } = useUnifiedSearch(query, {
    enabled: visible && query.trim().length > 0,
    limit: 10,
  });

  const itemById = useMemo(() => {
    const map = new Map<string, { sourceId?: string; type?: string }>();
    for (const item of workspaceData?.items || []) {
      map.set(item.id, { sourceId: item.sourceId, type: item.type });
    }
    return map;
  }, [workspaceData?.items]);

  const openResult = (result: UnifiedSearchResult) => {
    if (result.resultType === 'doc' && result.itemId) {
      const search = result.targetAnchor
        ? `focusBlock=${encodeURIComponent(result.targetAnchor)}`
        : undefined;
      router.push(buildDocPath(result.itemId, teamSlug, search));
      onResultSelect?.();
      return;
    }

    if (result.resultType === 'canvas_node' && result.canvasId) {
      const search = result.nodeId
        ? `focusNode=${encodeURIComponent(result.nodeId)}`
        : undefined;
      router.push(buildCanvasPath(result.canvasId, teamSlug, search));
      onResultSelect?.();
      return;
    }

    if (result.resultType === 'reference') {
      const targetType = result.targetType;
      if ((targetType === 'doc' || targetType === 'doc_block') && result.targetItemId) {
        const search = result.targetAnchor
          ? `focusBlock=${encodeURIComponent(result.targetAnchor)}`
          : undefined;
        router.push(buildDocPath(result.targetItemId, teamSlug, search));
        onResultSelect?.();
        return;
      }
      if (targetType === 'canvas') {
        const directCanvasId = result.targetCanvasId;
        const mappedCanvasId = result.targetItemId
          ? itemById.get(result.targetItemId)?.sourceId
          : undefined;
        const canvasId = directCanvasId || mappedCanvasId;
        if (canvasId) {
          const search = result.targetAnchor
            ? `focusNode=${encodeURIComponent(result.targetAnchor)}`
            : undefined;
          router.push(buildCanvasPath(canvasId, teamSlug, search));
          onResultSelect?.();
          return;
        }
      }
    }
  };

  if (!visible) return null;

  const results = data?.results || [];

  return (
    <div
      className={cn(
        'rounded-xl border border-border/80 bg-card/95 p-2 shadow-2xl backdrop-blur',
        className,
      )}
    >
      <div className="mb-1 flex items-center justify-between px-1 py-1">
        <div className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
          <Radar className="h-3 w-3" />
          Unified Search
        </div>
        {isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>

      {results.length === 0 && (
        <div className="rounded-lg border border-dashed border-border/70 px-3 py-4 text-center text-xs text-muted-foreground">
          {query.trim().length > 0 ? 'No cross-knowledge matches found.' : 'Start typing to search docs, nodes and links.'}
        </div>
      )}

      {results.length > 0 && (
        <div className="max-h-[320px] space-y-1 overflow-y-auto pr-1">
          {results.map((result) => (
            <button
              key={result.id}
              className="w-full rounded-lg border border-border/60 bg-background/70 px-2 py-2 text-left transition-colors hover:bg-accent"
              onClick={() => openResult(result)}
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className="inline-flex min-w-0 items-center gap-1.5">
                  {result.resultType === 'doc' && <FileText className="h-3.5 w-3.5 text-muted-foreground" />}
                  {result.resultType === 'canvas_node' && <SquareStack className="h-3.5 w-3.5 text-muted-foreground" />}
                  {result.resultType === 'reference' && <Link2 className="h-3.5 w-3.5 text-muted-foreground" />}
                  <span className="truncate text-xs font-medium text-foreground">{result.title || 'Untitled'}</span>
                </div>
                <span className="rounded border border-border/70 px-1 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {result.resultType}
                </span>
              </div>
              {result.snippet && (
                <p className="line-clamp-2 text-[11px] text-muted-foreground">{result.snippet}</p>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

