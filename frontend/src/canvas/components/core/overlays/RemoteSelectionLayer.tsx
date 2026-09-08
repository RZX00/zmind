'use client';

import React, { useMemo } from 'react';
import type { Canvas } from '../../../types/canvas';
import type { Collaborator } from '../../../collaboration/useCanvasCollaboration';
import { computeCollaboratorColor } from '../../../collaboration/collaboratorColors';

interface RemoteSelectionLayerProps {
  canvas: Canvas;
  collaborators: Collaborator[];
  containerScale: number;
}

/**
 * Renders remote collaborators' current selections as colored overlays on the
 * nodes they have selected ("who is editing what"). Coordinates are flat world
 * coords (x/y/width/height on CanvasNode); the layer is mounted inside the same
 * transformed/scaled container as the nodes, so it shares their coordinate space.
 *
 * Fully non-interactive: the container and every child use pointerEvents:'none'.
 */
const RemoteSelectionLayer: React.FC<RemoteSelectionLayerProps> = ({
  canvas,
  collaborators,
  containerScale,
}) => {
  const safeScale = Math.max(containerScale, 0.01);
  const borderWidth = 2 / safeScale;

  const overlays = useMemo(() => {
    return collaborators
      .filter((c) => !c.isSelf && c.selectedNodeIds && c.selectedNodeIds.length > 0)
      .flatMap((c) => {
        const color = computeCollaboratorColor(c.name || c.userId, c.color);
        return (c.selectedNodeIds || [])
          .map((id) => canvas.nodes.find((n) => n.id === id))
          .filter((n): n is NonNullable<typeof n> => Boolean(n))
          .map((node) => ({
            key: `${c.userId}:${node.id}`,
            color,
            name: c.name,
            x: node.x,
            y: node.y,
            width: node.width,
            height: node.height,
          }));
      });
  }, [collaborators, canvas.nodes]);

  if (overlays.length === 0) return null;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 8,
      }}
    >
      {overlays.map((o) => (
        <div
          key={o.key}
          style={{
            position: 'absolute',
            left: o.x,
            top: o.y,
            width: o.width,
            height: o.height,
            border: `${borderWidth}px solid ${o.color}`,
            borderRadius: 4 / safeScale,
            pointerEvents: 'none',
            zIndex: 8,
            boxSizing: 'border-box',
          }}
        >
          <span
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              transform: `translateY(-100%) scale(${1 / safeScale})`,
              transformOrigin: 'left bottom',
              backgroundColor: o.color,
              color: 'white',
              fontSize: 11,
              lineHeight: '14px',
              padding: '1px 6px',
              borderRadius: 4,
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              maxWidth: 160,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {o.name}
          </span>
        </div>
      ))}
    </div>
  );
};

export default RemoteSelectionLayer;
