export type MindmapPalette = {
  id: string;
  name: string;
  light: string[]; // 11 colors
  dark: string[];  // 11 colors
};

// 11-color categorical palettes for mindmap clarity.
// Curated for strong differentiation and readability.
// Colors are chosen to work on white (light) and near-black (dark) backgrounds.
export const MINDMAP_PALETTES: MindmapPalette[] = [
  {
    id: 'professional',
    name: 'Professional',
    light: [
      '#2563EB', '#059669', '#DC2626', '#7C3AED', '#D97706',
      '#0891B2', '#16A34A', '#EA580C', '#4F46E5', '#BE185D', '#0EA5E9',
    ],
    dark: [
      '#60A5FA', '#34D399', '#F87171', '#A78BFA', '#FBBF24',
      '#22D3EE', '#4ADE80', '#FB923C', '#818CF8', '#F472B6', '#38BDF8',
    ],
  },
  // ColorBrewer Set3 (12 colors)
  {
    id: 'cb-set3',
    name: 'ColorBrewer Set3',
    light: ['#8DD3C7','#FFFFB3','#BEBADA','#FB8072','#80B1D3','#FDB462','#B3DE69','#FCCDE5','#D9D9D9','#BC80BD','#CCEBC5','#FFED6F'],
    dark:  ['#8DD3C7','#FFFFB3','#BEBADA','#FB8072','#80B1D3','#FDB462','#B3DE69','#FCCDE5','#D9D9D9','#BC80BD','#CCEBC5','#FFED6F'],
  },
  // ColorBrewer Paired (12 colors)
  {
    id: 'cb-paired',
    name: 'ColorBrewer Paired',
    light: ['#A6CEE3','#1F78B4','#B2DF8A','#33A02C','#FB9A99','#E31A1C','#FDBF6F','#FF7F00','#CAB2D6','#6A3D9A','#FFFF99','#B15928'],
    dark:  ['#A6CEE3','#1F78B4','#B2DF8A','#33A02C','#FB9A99','#E31A1C','#FDBF6F','#FF7F00','#CAB2D6','#6A3D9A','#FFFF99','#B15928'],
  },
  // D3 Category10 extended (11)
  {
    id: 'd3-category10',
    name: 'D3 Category10+',
    light: ['#1F77B4','#FF7F0E','#2CA02C','#D62728','#9467BD','#8C564B','#E377C2','#7F7F7F','#BCBD22','#17BECF','#AEC7E8'],
    dark:  ['#1F77B4','#FF7F0E','#2CA02C','#D62728','#9467BD','#8C564B','#E377C2','#7F7F7F','#BCBD22','#17BECF','#AEC7E8'],
  },
  // ECharts Macarons (11)
  {
    id: 'echarts-macarons',
    name: 'ECharts Macarons',
    light: ['#2EC7C9','#B6A2DE','#5AB1EF','#FFB980','#D87A80','#8D98B3','#E5CF0D','#97B552','#95706D','#DC69AA','#07A2A4'],
    dark:  ['#2EC7C9','#B6A2DE','#5AB1EF','#FFB980','#D87A80','#8D98B3','#E5CF0D','#97B552','#95706D','#DC69AA','#07A2A4'],
  },
  {
    id: 'minimal',
    name: 'Minimal Modern',
    light: [
      '#1F2937', '#6B7280', '#374151', '#4B5563', '#111827',
      '#9CA3AF', '#475569', '#334155', '#0F172A', '#64748B', '#1E293B',
    ],
    dark: [
      '#E5E7EB', '#D1D5DB', '#F3F4F6', '#9CA3AF', '#CBD5E1',
      '#F9FAFB', '#E2E8F0', '#F8FAFC', '#FFFFFF', '#94A3B8', '#C7D2FE',
    ],
  },
  {
    id: 'sunset',
    name: 'Warm Sunset',
    light: [
      '#EF4444', '#F97316', '#F59E0B', '#EAB308', '#84CC16',
      '#22C55E', '#06B6D4', '#0EA5E9', '#3B82F6', '#8B5CF6', '#EC4899',
    ],
    dark: [
      '#FCA5A5', '#FDBA74', '#FCD34D', '#FDE047', '#BEF264',
      '#86EFAC', '#67E8F9', '#7DD3FC', '#93C5FD', '#C4B5FD', '#F9A8D4',
    ],
  },
  {
    id: 'dark',
    name: 'Professional Dark',
    light: [
      '#0F172A', '#1E293B', '#334155', '#475569', '#64748B',
      '#94A3B8', '#0B1220', '#111827', '#1F2937', '#0A0F1F', '#0C1222',
    ],
    dark: [
      '#F8FAFC', '#F1F5F9', '#E2E8F0', '#CBD5E1', '#94A3B8',
      '#E5E7EB', '#FFFFFF', '#F3F4F6', '#D1D5DB', '#E2E8F0', '#F8FAFC',
    ],
  },
  {
    id: 'forest',
    name: 'Natural Green',
    light: [
      '#166534', '#15803D', '#16A34A', '#22C55E', '#4ADE80',
      '#84CC16', '#65A30D', '#A3E635', '#059669', '#10B981', '#34D399',
    ],
    dark: [
      '#86EFAC', '#A7F3D0', '#6EE7B7', '#4ADE80', '#22C55E',
      '#BBF7D0', '#BEF264', '#D9F99D', '#34D399', '#10B981', '#84CC16',
    ],
  },
  // Fallback palette for system/ui contexts without explicit theme id
  {
    id: 'system',
    name: 'System Neutral',
    light: [
      '#3B82F6', '#10B981', '#EF4444', '#8B5CF6', '#F59E0B',
      '#06B6D4', '#84CC16', '#F97316', '#6366F1', '#EC4899', '#0EA5E9',
    ],
    dark: [
      '#93C5FD', '#6EE7B7', '#FCA5A5', '#C4B5FD', '#FCD34D',
      '#67E8F9', '#BEF264', '#FDBA74', '#A5B4FC', '#F9A8D4', '#7DD3FC',
    ],
  },
];

export function getMindmapPalette(themeId: string | undefined, isDark: boolean): string[] {
  const id = (themeId || '').toLowerCase();
  const found = MINDMAP_PALETTES.find(p => p.id.toLowerCase() === id) || MINDMAP_PALETTES.find(p => p.id === 'system')!;
  return isDark ? found.dark : found.light;
}

// Six categorical palette IDs we want to apply across all Mermaid types
export const CATEGORICAL_PALETTE_IDS = new Set([
  'cb-set3',
  'cb-paired',
  'd3-category10',
  'echarts-macarons',
]);

// Helpers
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return { r, g, b };
}

function clamp(n: number, min = 0, max = 255) { return Math.max(min, Math.min(max, n)); }

export function shade(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  const nr = clamp(Math.round(r + (amount * 255)));
  const ng = clamp(Math.round(g + (amount * 255)));
  const nb = clamp(Math.round(b + (amount * 255)));
  return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`;
}

export function pickReadableTextColor(bgHex: string): '#0f172a' | '#f8fafc' {
  const { r, g, b } = hexToRgb(bgHex);
  // relative luminance approximation
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.6 ? '#0f172a' : '#f8fafc';
}

// WCAG contrast helpers
function srgbToLin(c: number) {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string) {
  const { r, g, b } = hexToRgb(hex);
  const R = srgbToLin(r), G = srgbToLin(g), B = srgbToLin(b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrastRatio(hex1: string, hex2: string) {
  const L1 = relativeLuminance(hex1);
  const L2 = relativeLuminance(hex2);
  const lighter = Math.max(L1, L2);
  const darker = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}

function mix(hex1: string, hex2: string, weight: number) {
  const a = hexToRgb(hex1);
  const b = hexToRgb(hex2);
  const w = Math.max(0, Math.min(1, weight));
  const r = Math.round(a.r * (1 - w) + b.r * w);
  const g = Math.round(a.g * (1 - w) + b.g * w);
  const b2 = Math.round(a.b * (1 - w) + b.b * w);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b2.toString(16).padStart(2, '0')}`;
}

function ensureReadableWithTarget(bgHex: string, targetText: '#0f172a' | '#f8fafc'): { fill: string } {
  const darkText: '#0f172a' = '#0f172a';
  const lightText: '#f8fafc' = '#f8fafc';
  let fill = bgHex;

  // target minimum contrast ratio per WCAG AA (normal text)
  const target = 4.5;
  let attempts = 0;

  while (contrastRatio(fill, targetText) < target && attempts < 20) {
    attempts++;
    // If target text is dark, lighten the background toward white; else darken toward black
    fill = targetText === darkText ? mix(fill, '#ffffff', 0.1) : mix(fill, '#000000', 0.1);
  }

  return { fill };
}

// Derive general Mermaid themeVariables from a categorical palette id.
// This is used for non-mindmap diagrams so the six palettes affect all Mermaid types.
export function getMermaidThemeFromPalette(
  themeId: string | undefined,
  isDark: boolean
): { theme: 'base'; themeVariables: Record<string, string> } | null {
  const id = (themeId || '').toLowerCase();
  if (!CATEGORICAL_PALETTE_IDS.has(id)) return null;

  // Find palette; fall back to system if somehow missing
  const palette = getMindmapPalette(id, isDark);
  const accent = palette[0] || (isDark ? '#60A5FA' : '#2563EB');
  const accent2 = palette[1] || (isDark ? '#34D399' : '#16A34A');
  const bg = isDark ? '#0b1220' : '#ffffff';

  // Node background: tint accent toward bg to avoid harsh fills
  const nodeBkg = isDark ? mix(accent, '#000000', 0.4) : mix(accent, '#ffffff', 0.85);
  const nodeBkgAdjusted = ensureReadableWithTarget(nodeBkg, isDark ? '#f8fafc' : '#0f172a').fill;
  const nodeText = pickReadableTextColor(nodeBkgAdjusted);

  // Cluster/background variants
  const clusterBkgBase = isDark ? mix(accent2, '#000000', 0.55) : mix(accent2, '#ffffff', 0.9);
  const clusterBkg = ensureReadableWithTarget(clusterBkgBase, nodeText).fill;

  const border = isDark ? shade(accent, 0.2) : shade(accent, -0.2);
  const clusterBorder = isDark ? shade(accent2, 0.2) : shade(accent2, -0.2);
  const lineColor = clusterBorder;
  const tertiary = isDark ? '#111827' : '#ffffff';

  return {
    theme: 'base',
    themeVariables: {
      background: bg,
      primaryColor: nodeBkgAdjusted,
      primaryTextColor: nodeText,
      primaryBorderColor: border,
      lineColor,
      secondaryColor: clusterBkg,
      tertiaryColor: tertiary,
      nodeBkg: nodeBkgAdjusted,
      nodeBorder: border,
      clusterBkg: clusterBkg,
      clusterBorder: clusterBorder,
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: '14px',
    },
  };
}

// Apply palette to a Mermaid mindmap SVG by depth
type ApplyOptions = { adjustFill?: boolean };

export function applyMindmapPalette(svgRoot: SVGElement, palette: string[], isDark?: boolean, opts: ApplyOptions = { adjustFill: false }) {
  if (!svgRoot) return;

  const globalText = (isDark ? '#f8fafc' : '#0f172a') as '#f8fafc' | '#0f172a';

  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  function rgbStrToHex(rgb: string): string | null {
    try {
      if (!rgb) return null;
      if (rgb.startsWith('#')) return rgb;
      const m = rgb.match(/rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
      if (!m) return null;
      const r = parseInt(m[1], 10), g = parseInt(m[2], 10), b = parseInt(m[3], 10);
      return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    } catch { return null; }
  }

  function getEffectiveFill(el: SVGElement): string {
    let color = '';
    const inline = (el as any).style?.fill;
    if (typeof inline === 'string' && inline) color = inline;
    if (!color) {
      try { color = getComputedStyle(el as any).fill; } catch {}
    }
    if (!color) color = el.getAttribute('fill') || '';
    const hex = rgbStrToHex(color);
    return hex || '#ffffff';
  }

  function textForBg(bgHex: string): '#0f172a' | '#f8fafc' {
    const L = relativeLuminance(bgHex);
    return L < 0.5 ? '#f8fafc' : '#0f172a';
  }

  // Heuristic: mindmap nodes are groups with text and a shape; prefer groups with mindmap-related classes/ids
  const groups = Array.from(svgRoot.querySelectorAll('g')) as SVGElement[];
  const nodeGroups = groups.filter(g => {
    const id = (g.getAttribute('id') || '').toLowerCase();
    const cls = (g.getAttribute('class') || '').toLowerCase();
    const hasText = !!g.querySelector('text');
    const hasShape = !!(g.querySelector('rect, circle, ellipse, path'));
    const looksLikeMindmap = id.includes('mindmap') || cls.includes('mindmap') || cls.includes('section') || cls.includes('node');
    return (hasText || hasShape) && looksLikeMindmap;
  });

  // Try to locate the mindmap root group to compute depth
  const findRootGroup = (): SVGElement | null => {
    return groups.find(el => {
      const id = (el.getAttribute('id') || '').toLowerCase();
      const cls = (el.getAttribute('class') || '').toLowerCase();
      return id.includes('mindmap') || cls.includes('mindmap') || cls.includes('section');
    }) || null;
  };

  const rootGroup = findRootGroup();

  const computeDepth = (el: SVGElement): number => {
    let depth = 0; let cur: Element | null = el;
    while (cur && cur !== svgRoot && cur !== rootGroup) { if (cur.tagName.toLowerCase() === 'g') depth++; cur = cur.parentElement; }
    return depth;
  };

  if (nodeGroups.length === 0) {
    // Fallback: do NOT paint shapes globally (避免整图变成纯色)。仅统一文字颜色以确保可读。
    const base = palette[0] || '#2563EB';
    const fill = base;
    const texts = svgRoot.querySelectorAll('text, tspan');
    const tf = textForBg(fill);
    texts.forEach((el) => {
      try { (el as any).style?.setProperty('fill', tf, 'important'); } catch {}
      (el as SVGElement).setAttribute('fill', tf);
    });
    return;
  }

  // Small stable hash for strings
  const hash = (s: string) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i);
    return h | 0;
  };

  nodeGroups.forEach((group, idx) => {
    const depth = computeDepth(group);
    const label = (group.querySelector('text')?.textContent || group.getAttribute('id') || '') as string;
    const key = label.trim() || `g${idx}`;
    const baseIndex = Math.abs(hash(key)) % palette.length;
    const base = palette[baseIndex];
    const adjustedFill = opts.adjustFill ? ensureReadableWithTarget(base, globalText).fill : base;
    const text = group.querySelector('text') as SVGElement | null;
    const tspans = Array.from(group.querySelectorAll('tspan')) as SVGElement[];
    // pick node shape within group; ignore edge paths (id^='L_')
    const shape = (group.querySelector('rect, circle, ellipse')
      || (group.querySelector('path:not([id^="L_"])') as SVGElement | null)) as SVGElement | null;
    if (shape && opts.adjustFill) {
      try { (shape as any).style?.setProperty('fill', adjustedFill, 'important'); } catch {}
      try { (shape as any).style?.setProperty('stroke', shade(adjustedFill, -0.25), 'important'); } catch {}
      shape.setAttribute('fill', adjustedFill);
      shape.setAttribute('stroke', shade(adjustedFill, -0.25));
    }
    // compute bg for text decision: either adjusted fill or effective fill from shape
    const bg = shape && !opts.adjustFill ? getEffectiveFill(shape) : adjustedFill;
    const tf = textForBg(bg);
    if (text) {
      try { (text as any).style?.setProperty('fill', tf, 'important'); } catch {}
      text.setAttribute('fill', tf);
    }
    if (tspans && tspans.length) {
      for (const ts of tspans) {
        try { (ts as any).style?.setProperty('fill', tf, 'important'); } catch {}
        ts.setAttribute('fill', tf);
      }
    }
  });
}
