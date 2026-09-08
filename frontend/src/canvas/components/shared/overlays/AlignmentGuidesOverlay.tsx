import React, { useMemo } from 'react';
import { useTheme } from 'next-themes';
import { useSettingsStore } from '../../../stores/settings.store';
import type { Canvas } from '../../../../types/canvas';
import { calculateCanvasBounds } from '../../core/systems/CoordinateSystem';
import type { GuideLine, DistanceHint } from '../../../../domain/guides';

interface AlignmentGuidesOverlayProps {
  canvas: Canvas;
  containerScale: number; // current zoom / 100
  guides: GuideLine[];
  distances?: DistanceHint[];
  forceShowLines?: boolean;
}

// Render smart guide lines (Phase 1)
const AlignmentGuidesOverlay: React.FC<AlignmentGuidesOverlayProps> = ({
  canvas,
  containerScale,
  guides,
  distances,
  forceShowLines,
}) => {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const g = useSettingsStore((s) => s.guides);
  // Default to Morandi-like gentle green-gray if not set
  const color = (g?.colorHex && typeof g.colorHex === 'string') ? g.colorHex : (isDark ? '#9FA8A3' : '#9FA8A3');
  const dashed = !!g?.dashed;
  const stroke = Math.max(1, Math.round(1.5 / Math.max(containerScale, 0.01)));
  const showLines = !!forceShowLines || g?.showLines === true;

  const bounds = useMemo(() => calculateCanvasBounds(canvas.nodes || [], 0), [canvas.nodes]);

  const hasGuides = showLines && guides && guides.length > 0;
  const hasDistances = distances && distances.length > 0;
  if (!hasGuides && !hasDistances) return null;

  return (
    <>
      {hasGuides && guides.map((g, idx) => {
        const isSecondary = g.role === 'secondary' || g.priority === 1;
        const lineOpacity = isSecondary ? 0.45 : 0.75;
        const lineStroke = isSecondary ? Math.max(1, Math.round(stroke * 0.8)) : stroke;
        if (g.orientation === 'vertical') {
          return (
            <div
              key={`vg-${idx}-${g.pos}`}
              className="absolute pointer-events-none"
              style={{
                left: g.pos,
                top: bounds.minY,
                width: 0,
                height: bounds.height,
                borderLeft: `${lineStroke}px ${dashed ? 'dashed' : 'solid'} ${color}`,
                opacity: lineOpacity,
                zIndex: 12,
              }}
            />
          );
        }
        return (
          <div
            key={`hg-${idx}-${g.pos}`}
            className="absolute pointer-events-none"
            style={{
              left: bounds.minX,
              top: g.pos,
              height: 0,
              width: bounds.width,
              borderTop: `${lineStroke}px ${dashed ? 'dashed' : 'solid'} ${color}`,
              opacity: lineOpacity,
              zIndex: 12,
            }}
          />
        );
      })}

      {hasDistances && distances!.map((d, idx) => {
        const thick = Math.max(1, Math.round(1 / Math.max(containerScale, 0.01)));
        const labelBg = isDark ? 'rgba(20,20,20,0.8)' : 'rgba(255,255,255,0.9)';
        const labelColor = isDark ? '#e5e7eb' : '#111827';
        if (d.orientation === 'horizontal') {
          const x = Math.min(d.x1, d.x2);
          const w = Math.abs(d.x2 - d.x1);
          const y = d.y1; // y1==y2
          return (
            <div key={`dh-${idx}`} className="absolute pointer-events-none" style={{ left: x, top: y, width: w, height: 0, borderTop: `${thick}px ${dashed ? 'dashed' : 'solid'} ${color}`, zIndex: 12 }}>
              <div style={{ position: 'absolute', left: '50%', top: -18 / Math.max(containerScale, 0.01), transform: 'translateX(-50%)', padding: '2px 4px', borderRadius: 'var(--radius-xs)', background: labelBg, color: labelColor, fontSize: Math.max(9, 12 / Math.max(containerScale, 0.01)), lineHeight: 1 }}>{Math.round(d.value)}</div>
            </div>
          );
        }
        // vertical
        const y = Math.min(d.y1, d.y2);
        const h = Math.abs(d.y2 - d.y1);
        const x = d.x1; // x1==x2
        return (
          <div key={`dv-${idx}`} className="absolute pointer-events-none" style={{ left: x, top: y, height: h, width: 0, borderLeft: `${thick}px ${dashed ? 'dashed' : 'solid'} ${color}`, zIndex: 12 }}>
            <div style={{ position: 'absolute', left: 6 / Math.max(containerScale, 0.01), top: '50%', transform: 'translateY(-50%)', padding: '2px 4px', borderRadius: 'var(--radius-xs)', background: labelBg, color: labelColor, fontSize: Math.max(9, 12 / Math.max(containerScale, 0.01)), lineHeight: 1 }}>{Math.round(d.value)}</div>
          </div>
        );
      })}
    </>
  );
};

export default AlignmentGuidesOverlay;
