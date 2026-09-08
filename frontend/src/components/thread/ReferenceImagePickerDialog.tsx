/* eslint-disable @next/next/no-img-element */
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { getDownloadUrl } from '@/lib/api/files';
import { cn } from '@/lib/utils';

export type ReferenceImageCandidate = {
  file_id: string;
  storage_path?: string;
  node_id?: string;
  label?: string;
  width?: number;
  height?: number;
};

export type ReferenceImagePickerPayload = {
  thread_id?: string;
  canvas_id?: string;
  prompt?: string;
  aspect_ratio?: string;
  quantity?: number;
  model?: string;
  candidates?: ReferenceImageCandidate[];
};

interface ReferenceImagePickerDialogProps {
  open: boolean;
  payload?: ReferenceImagePickerPayload | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (candidate: ReferenceImageCandidate) => Promise<void> | void;
}

export function ReferenceImagePickerDialog({
  open,
  payload,
  onOpenChange,
  onConfirm,
}: ReferenceImagePickerDialogProps) {
  const candidates = useMemo(() => payload?.candidates || [], [payload]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelectedId(candidates[0]?.file_id || null);
  }, [open, candidates]);

  useEffect(() => {
    if (!open || candidates.length === 0) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const entries = await Promise.all(
        candidates.map(async (candidate) => {
          if (!candidate.file_id) return [candidate.file_id, ''] as const;
          try {
            const { url } = await getDownloadUrl(candidate.file_id);
            return [candidate.file_id, url] as const;
          } catch {
            return [candidate.file_id, ''] as const;
          }
        }),
      );
      if (cancelled) return;
      const next: Record<string, string> = {};
      entries.forEach(([id, url]) => {
        if (id) next[id] = url;
      });
      setPreviewUrls(next);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, candidates]);

  const selectedCandidate = candidates.find((candidate) => candidate.file_id === selectedId) || null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Select a reference image</DialogTitle>
          <DialogDescription>
            Choose the image you want to use as the reference for this edit.
          </DialogDescription>
        </DialogHeader>

        {candidates.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
            No available reference images found on this canvas.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {candidates.map((candidate) => {
              const isSelected = candidate.file_id === selectedId;
              const preview = previewUrls[candidate.file_id];
              return (
                <button
                  key={candidate.file_id}
                  type="button"
                  onClick={() => setSelectedId(candidate.file_id)}
                  className={cn(
                    'group flex flex-col overflow-hidden rounded-lg border text-left transition',
                    isSelected ? 'border-primary ring-2 ring-primary/40' : 'border-border/60 hover:border-border',
                  )}
                >
                  <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted/40">
                    {preview ? (
                      <img
                        src={preview}
                        alt={candidate.label || 'Reference image'}
                        className="h-full w-full object-cover transition group-hover:scale-[1.02]"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                        {loading ? 'Loading…' : 'Preview unavailable'}
                      </div>
                    )}
                  </div>
                  <div className="px-2 py-1.5 text-xs text-foreground">
                    <div className="truncate">{candidate.label || candidate.node_id || 'Untitled image'}</div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => selectedCandidate && onConfirm(selectedCandidate)}
            disabled={!selectedCandidate}
          >
            Use selected image
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
