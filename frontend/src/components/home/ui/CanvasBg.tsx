'use client';

import React, { useMemo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';

type BandsPreset = 'calm' | 'lively' | 'minimal';

interface OrthogonalBandsProps {
  className?: string;
  /** Number of bands to render (2–4 recommended) */
  bands?: number;
  /** Base band height in px */
  bandHeight?: number;
  /** Band width as percentage of container width (e.g., 120 = 120%) */
  widthPct?: number;
  /** Corner radius in px (0 for square corners) */
  cornerRadius?: number;
  /** Animation period in seconds */
  periodSec?: number;
  /** Max translation amplitude in px */
  amplitude?: number;
  /** Overall opacity multiplier (0–1) */
  opacity?: number;
  /** Size multiplier for band height & corner radius */
  sizeMultiplier?: number;
  /** Visual presets for quick tuning */
  preset?: BandsPreset;
  /** Optional per-band overrides */
  customBands?: Array<Partial<{
    /** fixed vertical offset relative to center (px) */
    offsetY: number;
    /** static horizontal offset (px) around which animation oscillates */
    baseX: number;
    /** rotation angle in degrees */
    angle: number;
    /** per-band width percentage override */
    widthPct: number;
    /** per-band opacity override */
    opacity: number;
  }>>;
  /** Optional content overlay per band (index-aligned) */
  content?: Array<React.ReactNode | null>;
}

function usePreset(preset?: BandsPreset) {
  switch (preset) {
    case 'lively':
      return { bandHeight: 360, periodSec: 36, amplitude: 14, opacity: 0.16 };
    case 'minimal':
      return { bandHeight: 300, periodSec: 48, amplitude: 8, opacity: 0.10 };
    case 'calm':
    default:
      return { bandHeight: 320, periodSec: 42, amplitude: 12, opacity: 0.14 };
  }
}

/**
 * CanvasBg.OrthogonalBands
 * 
 * A background tailored for canvas/card-based UIs: large orthogonal rounded bands
 * drift slowly to imply flow and structure without distracting. Theme-aware via
 * utility classes, performant (few layers), and respects reduced motion.
 */
export function OrthogonalBands({
  className,
  bands = 3,
  bandHeight,
  widthPct,
  cornerRadius,
  periodSec,
  amplitude,
  opacity,
  sizeMultiplier = 1,
  preset = 'calm',
  customBands,
  content,
}: OrthogonalBandsProps) {
  const reduceMotion = useReducedMotion();
  const p = usePreset(preset);

  const h = Math.round((bandHeight ?? p.bandHeight) * sizeMultiplier);
  const amp = Math.round((amplitude ?? p.amplitude) * sizeMultiplier);
  const period = periodSec ?? p.periodSec;
  const baseOpacity = opacity ?? p.opacity; // kept for potential future use
  const bandWidthPct = Math.max(90, Math.min(200, widthPct ?? 140));
  const radius = typeof cornerRadius === 'number' ? Math.max(0, cornerRadius) : 24; // default ~rounded-3xl

  // Precompute per-band offsets/angles for slight variation
  const bandConfigs = useMemo(() => {
    return Array.from({ length: bands }).map((_, i) => {
      const sign = i % 2 === 0 ? 1 : -1;
      const defaultAngle = (i - (bands - 1) / 2) * 1.5;
      const defaultOffsetY = (i - (bands - 1) / 2) * (h + 120);
      const localOpacityDefault = baseOpacity * (0.9 + (i / Math.max(1, bands - 1)) * 0.2);
      const delay = (i * period) / (bands * 3);

      const overrides = customBands?.[i] ?? {};
      const angle = overrides.angle ?? defaultAngle;
      const offsetY = overrides.offsetY ?? defaultOffsetY;
      const baseX = overrides.baseX ?? 0;
      const localOpacity = overrides.opacity ?? localOpacityDefault;
      const wPct = overrides.widthPct ?? bandWidthPct;
      return { sign, angle, offsetY, localOpacity, delay, baseX, wPct };
    });
  }, [bands, h, baseOpacity, period, customBands, bandWidthPct]);

  return (
    <div className={cn('absolute inset-0 pointer-events-none select-none overflow-hidden', className)}>
      {/* Bands */}
      {bandConfigs.map(({ sign, angle, offsetY, localOpacity, delay, baseX, wPct }, i) => (
        <motion.div
          key={i}
          className={cn(
            'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2'
          )}
          style={{
            top: `calc(50% + ${offsetY}px)`,
            width: `${wPct}%`,
            height: h,
            rotate: `${angle}deg`,
            borderRadius: radius,
          }}
          initial={reduceMotion ? { x: baseX, y: 0, scale: 1 } : { x: baseX - sign * amp, y: -amp / 2, scale: 0.995 }}
          animate={reduceMotion ? { x: baseX, y: 0, scale: 1 } : {
            x: [ baseX - sign * amp, baseX + sign * amp, baseX - sign * amp ],
            y: [ -amp / 2, amp / 2, -amp / 2 ],
            scale: [ 0.995, 1.005, 0.995 ],
          }}
          transition={reduceMotion ? { duration: 0 } : {
            duration: period,
            ease: [0.85, 0, 0.06, 1.01],
            repeat: Infinity,
            repeatType: 'reverse',
            delay,
          }}
        >
          <div
            className={cn(
              'absolute inset-0 z-0 backdrop-blur-[6px]',
              'bg-white/85 ring-1 ring-black/15 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.35)] dark:bg-white/28 dark:ring-white/35 dark:shadow-[0_10px_40px_-12px_rgba(255,255,255,0.18)]'
            )}
            style={{ borderRadius: radius, opacity: localOpacity }}
          />
          {content?.[i] && (
            <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none select-none px-4">
              {content[i]}
            </div>
          )}
        </motion.div>
      ))}

      {/* connectors removed per design feedback */}
    </div>
  );
}

export const CanvasBg = {
  OrthogonalBands,
};

export default CanvasBg;
