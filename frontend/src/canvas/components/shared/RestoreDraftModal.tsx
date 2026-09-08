"use client";

import React, { useMemo } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface RestoreDraftModalProps {
  isOpen: boolean;
  savedAt?: number | null;
  onRestore: () => void;
  onDiscard: () => void;
}

export const RestoreDraftModal: React.FC<RestoreDraftModalProps> = ({
  isOpen,
  savedAt,
  onRestore,
  onDiscard,
}) => {
  const savedAtLabel = useMemo(() => {
    if (!savedAt) return "just now";
    try {
      return new Date(savedAt).toLocaleString();
    } catch {
      return "recently";
    }
  }, [savedAt]);

  return (
    <Dialog open={isOpen}>
      <DialogContent
        className="sm:max-w-md rounded-[var(--canvas-panel-radius)] border-border/60 bg-card/95"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Local draft found</DialogTitle>
          <DialogDescription>
            We saved a local draft at {savedAtLabel}. Restore it to avoid losing changes.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 pt-2">
          <Button onClick={onRestore}>Restore draft</Button>
          <Button variant="outline" onClick={onDiscard}>Discard draft</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default RestoreDraftModal;
