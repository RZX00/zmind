import React from 'react';
import type { Canvas } from '../../../../types/canvas';
import SelectionFeedbackOverlay from '../../shared/overlays/SelectionFeedbackOverlay';
import SelectionChatOverlay from '../../shared/overlays/SelectionChatOverlay';
import GroupOverlays from '../../shared/groups/GroupOverlays';
import AlignmentGuidesOverlay from '../../shared/overlays/AlignmentGuidesOverlay';
import type { GuideLine, DistanceHint } from '../../../../domain/guides';

export interface OverlaysLayerProps {
  canvas: Canvas;
  containerScale: number;
  // selection overlay
  showSelectionOverlay: boolean;
  selectedNodeIds: Set<string>;
  // smart guides
  alignmentGuides?: GuideLine[] | null;
  alignmentDistances?: DistanceHint[] | null;
  forceGuideLines?: boolean;
  // group overlays
  selectedGroupId: string | null;
  onSelectGroup: (groupId: string | null) => void;
  onRenameGroup: (groupId: string, name: string) => void;
  onGroupDragStart: (e: React.MouseEvent, groupId: string) => void;
  onUngroup: (groupId: string) => void;
  isEditMode?: boolean;
  onOpenContextMenu?: (e: React.MouseEvent) => void;
  renameRequestId?: string | null;
  onRenameRequestConsumed?: () => void;
  // Notify parent when a group label enters/exits edit mode
  onGroupLabelEditingChange?: (groupId: string | null) => void;
}

const OverlaysLayer: React.FC<OverlaysLayerProps> = (props) => {
  const {
    canvas,
    containerScale,
    showSelectionOverlay,
    selectedNodeIds,
    selectedGroupId,
    onSelectGroup,
    onRenameGroup,
    onGroupDragStart,
    onUngroup,
    isEditMode = false,
    onOpenContextMenu,
    renameRequestId,
    onRenameRequestConsumed,
    onGroupLabelEditingChange,
  } = props;

  const hasGroups = !!canvas.nodes?.some((n) => (n as any).type === 'group');
  const hasSelection = showSelectionOverlay && (selectedNodeIds?.size ?? 0) > 0;

  return (
    <>
      {/* Smart alignment guides */}
      {(props.alignmentGuides && props.alignmentGuides.length > 0) || (props.alignmentDistances && props.alignmentDistances.length > 0) ? (
        <AlignmentGuidesOverlay
          canvas={canvas}
          containerScale={containerScale}
          guides={(props.alignmentGuides as GuideLine[]) || []}
          distances={(props.alignmentDistances as DistanceHint[]) || []}
          forceShowLines={props.forceGuideLines}
        />
      ) : null}

      {hasSelection && (
        <SelectionFeedbackOverlay
          canvas={canvas}
          selectedIds={Array.from(selectedNodeIds)}
          containerScale={containerScale}
        />
      )}

      {hasSelection && !isEditMode && (
        <SelectionChatOverlay
          canvas={canvas}
          selectedIds={Array.from(selectedNodeIds)}
          containerScale={containerScale}
        />
      )}

      {hasGroups && (
        <GroupOverlays
          canvas={canvas}
          containerScale={containerScale}
          selectedGroupId={selectedGroupId}
          onSelectGroup={onSelectGroup}
          onRenameGroup={onRenameGroup}
          onGroupDragStart={onGroupDragStart}
          onUngroup={onUngroup}
          onOpenContextMenu={onOpenContextMenu}
          renameRequestId={renameRequestId}
          onRenameRequestConsumed={onRenameRequestConsumed}
          onGroupLabelEditingChange={onGroupLabelEditingChange}
        />
      )}
    </>
  );
};

export default OverlaysLayer;

