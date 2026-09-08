'use client';

export type SelectionRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type SelectionBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
};

export const isSelectionWithinContainer = (
  selection: Selection,
  container: HTMLElement,
): boolean => {
  const anchor = selection.anchorNode;
  const focus = selection.focusNode;
  if (!anchor || !focus) return false;
  return container.contains(anchor) && container.contains(focus);
};

export const getSelectionRects = (
  selection: Selection,
  container: HTMLElement,
): SelectionRect[] => {
  const containerRect = container.getBoundingClientRect();
  const rects: SelectionRect[] = [];

  for (let i = 0; i < selection.rangeCount; i += 1) {
    const range = selection.getRangeAt(i);
    if (range.collapsed) continue;
    const inContainer =
      container.contains(range.commonAncestorContainer) ||
      container.contains(range.startContainer) ||
      container.contains(range.endContainer);
    if (!inContainer) continue;

    const clientRects = Array.from(range.getClientRects());
    clientRects.forEach((r) => {
      if (r.width < 1 || r.height < 1) return;
      rects.push({
        left: r.left - containerRect.left + container.scrollLeft,
        top: r.top - containerRect.top + container.scrollTop,
        width: r.width,
        height: r.height,
      });
    });
  }

  return rects;
};

export const getSelectionBounds = (
  rects: SelectionRect[],
): SelectionBounds | null => {
  if (!rects.length) return null;
  let left = rects[0].left;
  let top = rects[0].top;
  let right = rects[0].left + rects[0].width;
  let bottom = rects[0].top + rects[0].height;

  rects.forEach((rect) => {
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.left + rect.width);
    bottom = Math.max(bottom, rect.top + rect.height);
  });

  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
};
