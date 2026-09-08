// Color mapping utility for light <-> dark theme background colors
// Implements Strategy B: nearest-neighbor mapping within source theme palette,
// then map index-wise to the counterpart palette.

export type ThemeMode = 'light' | 'dark';

// Canonical light/dark palettes (lowercased hex)
const LIGHT_BG = ['#eeeded', '#f2f3ee', '#f1f5f9', '#f8fafc', '#fefbf3', '#f0f9f4'] as const;
const DARK_BG = ['#232628', '#101418', '#1f2937', '#111827', '#0b0f12', '#0f172a'] as const;

const DEFAULT_LIGHT = LIGHT_BG[0];
const DEFAULT_DARK = DARK_BG[0];

type RGB = { r: number; g: number; b: number };

const clamp = (n: number) => Math.max(0, Math.min(255, n | 0));

function toLowerHex(hex: string): string {
  return (hex || '').trim().toLowerCase();
}

function expandShortHex(hex: string): string {
  // #abc -> #aabbcc
  if (/^#([0-9a-f]{3})$/i.test(hex)) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`.toLowerCase();
  }
  return hex.toLowerCase();
}

function parseColor(input?: string | null): RGB | null {
  if (!input) return null;
  const v = input.trim().toLowerCase();
  // hex #rrggbb or #rgb
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) {
    const hex = expandShortHex(v);
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return { r, g, b };
  }
  // rgb(a) notation
  const m = v.match(/rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (m) {
    const r = clamp(parseInt(m[1], 10));
    const g = clamp(parseInt(m[2], 10));
    const b = clamp(parseInt(m[3], 10));
    return { r, g, b };
  }
  return null;
}

function distanceSq(a: RGB, b: RGB): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return dr * dr + dg * dg + db * db;
}

function hexToRgb(hex: string): RGB {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

function nearestIndex(color: RGB, palette: readonly string[]): number {
  let bestIdx = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < palette.length; i++) {
    const rgb = hexToRgb(palette[i]);
    const d = distanceSq(color, rgb);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

export function mapBackgroundColorForTheme(
  input: string | undefined | null,
  target: ThemeMode
): string {
  const raw = typeof input === 'string' ? input : '';
  const trimmed = raw.trim();
  const normalizedHex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed)
    ? expandShortHex(toLowerHex(trimmed))
    : undefined;
  const parsed = parseColor(normalizedHex || trimmed);

  if (!parsed) {
    return target === 'dark' ? DEFAULT_DARK : DEFAULT_LIGHT;
  }

  const sourcePalette = target === 'dark' ? (LIGHT_BG as readonly string[]) : (DARK_BG as readonly string[]);
  const destPalette = target === 'dark' ? (DARK_BG as readonly string[]) : (LIGHT_BG as readonly string[]);

  // Preserve any custom color (not in canonical palettes) exactly as entered
  const isLightPreset = normalizedHex ? (LIGHT_BG as readonly string[]).includes(normalizedHex) : false;
  const isDarkPreset = normalizedHex ? (DARK_BG as readonly string[]).includes(normalizedHex) : false;
  if (!isLightPreset && !isDarkPreset) {
    return normalizedHex || trimmed;
  }

  if (normalizedHex && destPalette.includes(normalizedHex)) {
    return normalizedHex;
  }

  const idx = nearestIndex(parsed, sourcePalette);
  return destPalette[idx];
}

export const THEME_COLOR_MAPPING = {
  light: LIGHT_BG,
  dark: DARK_BG,
} as const;

// ======================= Pattern color mapping =======================
// Palettes are curated from StylePanel options and runtime defaults
const LIGHT_PATTERN = ['#c7c9ca', '#94a3b8', '#64748b', '#475569', '#1e293b', '#374151'] as const;
// Include '#262524' as the primary dark counterpart for '#C7C9CA'
const DARK_PATTERN = ['#4d4f52', '#cbd5e1', '#94a3b8', '#d1d5db', '#f1f5f9', '#e2e8f0'] as const;

const DEFAULT_LIGHT_PATTERN = LIGHT_PATTERN[0];
const DEFAULT_DARK_PATTERN = DARK_PATTERN[0];

export function mapPatternColorForTheme(
  input: string | undefined | null,
  target: ThemeMode
): string {
  const raw = typeof input === 'string' ? input : undefined;
  const normalized = raw ? expandShortHex(toLowerHex(raw)) : undefined;
  const parsed = parseColor(normalized);
  if (!parsed) return target === 'dark' ? DEFAULT_DARK_PATTERN : DEFAULT_LIGHT_PATTERN;

  const sourcePalette = target === 'dark' ? (LIGHT_PATTERN as readonly string[]) : (DARK_PATTERN as readonly string[]);
  const destPalette = target === 'dark' ? (DARK_PATTERN as readonly string[]) : (LIGHT_PATTERN as readonly string[]);

  if (normalized && destPalette.includes(normalized)) {
    return normalized;
  }
  const idx = nearestIndex(parsed, sourcePalette);
  return destPalette[idx];
}

export const THEME_PATTERN_MAPPING = {
  light: LIGHT_PATTERN,
  dark: DARK_PATTERN,
} as const;
