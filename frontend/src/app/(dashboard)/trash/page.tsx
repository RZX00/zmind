"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Search, Trash2, RotateCcw, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { listDeletedCanvases, restoreCanvas, purgeDeletedCanvases, hardDeleteCanvas, restoreCanvasesBatch, purgeCanvasesByIds } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { toast } from '@/lib/toast';

type TrashItem = {
  id: string;
  title: string;
  deleted_at?: string;
  days_remaining?: number;
  created_at?: string;
  updated_at?: string;
  node_count?: number;
  connection_count?: number;
};

export default function TrashPage() {
  const [trashLoading, setTrashLoading] = useState(false);
  const [trashItems, setTrashItems] = useState<TrashItem[]>([]);
  const [retentionDays, setRetentionDays] = useState<number>(15);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'deleted_at' | 'title' | 'nodes'>('deleted_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [workingIds, setWorkingIds] = useState<Set<string>>(new Set());
  const [pageSize, setPageSize] = useState<number>(20);
  const [page, setPage] = useState<number>(0); // zero-based
  const [totalCount, setTotalCount] = useState<number>(0);

  // Confirm dialogs state
  const [confirmEmptyOpen, setConfirmEmptyOpen] = useState(false);
  const [confirmBulkDeleteOpen, setConfirmBulkDeleteOpen] = useState(false);
  const [pendingSingleDeleteId, setPendingSingleDeleteId] = useState<string | null>(null);

  const loadTrash = useCallback(async () => {
    setTrashLoading(true);
    try {
      const data = await listDeletedCanvases({
        q: search.trim() || undefined,
        limit: pageSize,
        offset: page * pageSize,
        sort_by: sortBy === 'nodes' ? 'node_count' : sortBy,
        sort_dir: sortDir,
      });
      setTrashItems(Array.isArray(data?.items) ? data.items : []);
      if (typeof data?.retention_days === 'number') setRetentionDays(data.retention_days);
      if (typeof (data as any)?.total_count === 'number') setTotalCount((data as any).total_count as number);
    } catch (e) {
      console.error('Failed to load trash', e);
    } finally {
      setTrashLoading(false);
    }
  }, [search, sortBy, sortDir, page, pageSize]);

  useEffect(() => { loadTrash(); }, [loadTrash]);

  // Reset to first page when search/sort changes
  useEffect(() => { setPage(0); }, [search, sortBy, sortDir]);

  const pageItems = useMemo(() => trashItems, [trashItems]);

  const allSelectedOnView = pageItems.length > 0 && pageItems.every(it => selected.has(it.id));
  const someSelectedOnView = pageItems.some(it => selected.has(it.id)) && !allSelectedOnView;

  const toggleSelectAllOnView = () => {
    const next = new Set(selected);
    if (allSelectedOnView) {
      for (const it of pageItems) next.delete(it.id);
    } else {
      for (const it of pageItems) next.add(it.id);
    }
    setSelected(next);
  };

  const toggleSelectOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const withWorking = (id: string, fn: () => Promise<void>) => {
    setWorkingIds(prev => new Set(prev).add(id));
    return fn().finally(() => setWorkingIds(prev => { const n = new Set(prev); n.delete(id); return n; }));
  };

  // Fetch all trashed IDs (ignore current search, clear entire trash)
  const fetchAllTrashIds = useCallback(async (): Promise<string[]> => {
    const all: string[] = [];
    const size = 200;
    let off = 0;
    let total = 0;
    for (let i = 0; i < 1000; i++) { // hard guard
      const data = await listDeletedCanvases({ limit: size, offset: off, sort_by: 'deleted_at', sort_dir: 'desc' });
      const items = Array.isArray(data?.items) ? data.items : [];
      for (const it of items) if (it?.id) all.push(it.id);
      total = typeof (data as any)?.total_count === 'number' ? (data as any).total_count as number : (off + items.length);
      off += size;
      if (off >= total || items.length === 0) break;
    }
    return Array.from(new Set(all));
  }, []);

  // Helpers
  const doRestore = async (ids: string[]) => {
    let ok = 0, fail = 0;
    for (const id of ids) {
      // sequential keeps API gentle; can parallelize if needed
      // use withWorking for row state
      await withWorking(id, async () => {
        try { await restoreCanvas(id); ok++; setTrashItems(prev => prev.filter(x => x.id !== id)); } catch { fail++; }
      });
    }
    if (ok) toast.success(`Restored ${ok} item${ok>1?'s':''}`);
    if (fail) toast.error(`Failed to restore ${fail} item${fail>1?'s':''}`);
  };

  const doHardDelete = async (ids: string[]) => {
    let ok = 0, fail = 0;
    for (const id of ids) {
      await withWorking(id, async () => {
        try { await hardDeleteCanvas(id); ok++; setTrashItems(prev => prev.filter(x => x.id !== id)); } catch { fail++; }
      });
    }
    if (ok) toast.success(`Deleted ${ok} permanently`);
    if (fail) toast.error(`Failed to delete ${fail}`);
  };

  const onClickHeaderSort = (key: 'deleted_at' | 'title' | 'nodes') => {
    if (sortBy === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(key); setSortDir(key === 'title' ? 'asc' : 'desc'); }
  };

  const selectedIds = useMemo(() => Array.from(selected), [selected]);
  const selectedCount = selectedIds.length;

  const clearSelection = () => setSelected(new Set());

  return (
    <div className="w-full h-screen overflow-y-auto scrollbar-none">
      <div className="dashboard-page">
        <div className="dashboard-container-wide space-y-6">
          {/* Header */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold flex items-center gap-2 dashboard-title">
                  <Trash2 className="h-4 w-4 opacity-60" /> Trash
                </h2>
                <p className="text-sm text-muted-foreground">Retention: {retentionDays} days. Items beyond retention can be purged.</p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    try {
                      await purgeDeletedCanvases(retentionDays);
                      toast.success('Purged expired items');
                      await loadTrash();
                    } catch (e: any) {
                      toast.error(e?.message || 'Failed to purge');
                    }
                  }}
                >
                  <ShieldAlert className="h-4 w-4 mr-1" /> Purge expired
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  className="bg-black text-white hover:bg-black/90 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                  onClick={() => setConfirmEmptyOpen(true)}
                >
                  <Trash2 className="h-4 w-4 mr-1" /> Empty Trash
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative w-full max-w-sm">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>
          </div>

      {/* Bulk bar */}
      {selectedCount > 0 && (
        <div className="dashboard-panel-soft flex items-center justify-between p-3">
          <div className="text-sm">Selected {selectedCount} item{selectedCount>1?'s':''}</div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                const ids = selectedIds.slice();
                clearSelection();
                try {
                  const res = await restoreCanvasesBatch(ids);
                  toast.success(`Restored ${res.count_restored} item${res.count_restored>1?'s':''}`);
                } catch (e: any) {
                  toast.error(e?.message || 'Failed to restore');
                } finally {
                  await loadTrash();
                }
              }}
            >
              <RotateCcw className="h-4 w-4 mr-1" /> Restore selected
            </Button>
            <Button
              variant="default"
              size="sm"
              className="bg-black text-white hover:bg-black/90 dark:bg-zinc-900 dark:hover:bg-zinc-800"
              onClick={() => setConfirmBulkDeleteOpen(true)}
            >
              <Trash2 className="h-4 w-4 mr-1" /> Delete selected
            </Button>
            <Button variant="ghost" size="sm" onClick={clearSelection}>Clear</Button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="dashboard-panel overflow-hidden">
        <div className="grid grid-cols-12 gap-3 px-3 py-2 text-xs text-muted-foreground border-b bg-muted/30">
          <div className="col-span-5 flex items-center gap-2">
            <Checkbox
              checked={allSelectedOnView}
              onCheckedChange={toggleSelectAllOnView}
              {...(someSelectedOnView ? { 'data-state': 'indeterminate' } as any : {})}
            />
            <button className="text-left" onClick={() => onClickHeaderSort('title')}>Name</button>
          </div>
          <div className="col-span-1 text-right">
            <button onClick={() => onClickHeaderSort('nodes')}>Nodes</button>
          </div>
          <div className="col-span-3">
            <button onClick={() => onClickHeaderSort('deleted_at')}>Deleted At</button>
          </div>
          <div className="col-span-1 text-center">Remaining</div>
          <div className="col-span-2 text-right">Actions</div>
        </div>

        {trashLoading ? (
          <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading...
          </div>
        ) : pageItems.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">No deleted canvases</div>
        ) : (
          <div className="divide-y">
            {pageItems.map((item) => {
              const isWorking = workingIds.has(item.id);
              const isSelected = selected.has(item.id);
              const remaining = typeof item.days_remaining === 'number' ? item.days_remaining : undefined;
              const remainingBadge = (
                <Badge variant="outline" className="text-muted-foreground">{remaining === undefined ? '-' : `${remaining}d`}</Badge>
              );

              return (
                <div key={item.id} className={cn('grid grid-cols-12 gap-3 items-center px-3 py-2', isWorking && 'opacity-60 pointer-events-none') }>
                  <div className="col-span-5 min-w-0 flex items-center gap-2">
                    <Checkbox checked={isSelected} onCheckedChange={() => toggleSelectOne(item.id)} />
                    <TooltipProvider delayDuration={200}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="truncate text-sm" title={item.title || 'Untitled Canvas'}>
                            {item.title || 'Untitled Canvas'}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          <div className="text-xs max-w-xs">{item.title || 'Untitled Canvas'}</div>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <div className="col-span-1 text-right text-sm">{typeof item.node_count === 'number' ? item.node_count : '-'}</div>
                  <div className="col-span-3 text-xs text-muted-foreground">
                    {item.deleted_at ? (
                      <TooltipProvider delayDuration={200}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span>{new Intl.DateTimeFormat(undefined, {year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'}).format(new Date(item.deleted_at))}</span>
                          </TooltipTrigger>
                          <TooltipContent>
                            <span className="text-xs">{item.deleted_at}</span>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ) : '-'}
                  </div>
                  <div className="col-span-1 text-center">{remainingBadge}</div>
                  <div className="col-span-2 flex items-center justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        await withWorking(item.id, async () => {
                          try { await restoreCanvas(item.id); toast.success('Restored'); setTrashItems(prev => prev.filter(x => x.id !== item.id)); setSelected(prev => { const n = new Set(prev); n.delete(item.id); return n; }); } catch (e: any) { toast.error(e?.message || 'Failed to restore'); }
                        });
                      }}
                      disabled={isWorking}
                    >
                      <RotateCcw className="h-4 w-4 mr-1" /> Restore
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      className="bg-black text-white hover:bg-black/90 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                      onClick={() => setPendingSingleDeleteId(item.id)}
                      disabled={isWorking}
                    >
                      <Trash2 className="h-4 w-4 mr-1" /> Delete
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between mt-3 text-sm">
        <div className="text-muted-foreground">
          {totalCount} items • Page {Math.floor(totalCount === 0 ? 0 : page + 1)} of {Math.max(1, Math.ceil(totalCount / pageSize))}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>Prev</Button>
          <Button variant="outline" size="sm" disabled={(page + 1) * pageSize >= totalCount} onClick={() => setPage(p => p + 1)}>Next</Button>
        </div>
      </div>

      {/* Confirm: Empty Trash */}
      <AlertDialog open={confirmEmptyOpen} onOpenChange={setConfirmEmptyOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Empty Trash?</AlertDialogTitle>
            <AlertDialogDescription>
              Permanently delete all items in Trash. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-black text-white hover:bg-black/90 dark:bg-zinc-900 dark:hover:bg-zinc-800"
              onClick={async () => {
                setConfirmEmptyOpen(false);
                try {
                  const ids = await fetchAllTrashIds();
                  if (ids.length === 0) { toast.info('Trash is already empty'); return; }
                  const res = await purgeCanvasesByIds(ids);
                  toast.success(`Deleted ${res.count_deleted}`);
                } catch (e: any) {
                  toast.error(e?.message || 'Failed to empty trash');
                } finally {
                  clearSelection();
                  await loadTrash();
                }
              }}
            >
              Empty Trash
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm: Bulk Delete */}
      <AlertDialog open={confirmBulkDeleteOpen} onOpenChange={setConfirmBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete selected items?</AlertDialogTitle>
            <AlertDialogDescription>
              Permanently delete {selectedCount} selected item{selectedCount>1?'s':''}. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-black text-white hover:bg-black/90 dark:bg-zinc-900 dark:hover:bg-zinc-800"
              onClick={async () => {
                setConfirmBulkDeleteOpen(false);
                const ids = selectedIds.slice();
                clearSelection();
                try {
                  const res = await purgeCanvasesByIds(ids);
                  toast.success(`Deleted ${res.count_deleted}`);
                } catch (e: any) {
                  toast.error(e?.message || 'Failed to delete');
                } finally {
                  await loadTrash();
                }
              }}
            >
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm: Single Delete */}
      <AlertDialog open={!!pendingSingleDeleteId} onOpenChange={(v) => { if (!v) setPendingSingleDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this canvas permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The canvas and its related data will be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-black text-white hover:bg-black/90 dark:bg-zinc-900 dark:hover:bg-zinc-800"
              onClick={async () => {
                const id = pendingSingleDeleteId;
                setPendingSingleDeleteId(null);
                if (!id) return;
                try {
                  await purgeCanvasesByIds([id]);
                  toast.success('Deleted');
                } catch (e: any) {
                  toast.error(e?.message || 'Failed to delete');
                } finally {
                  await loadTrash();
                }
              }}
            >
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
        </div>
      </div>
    </div>
  );
}

