// 🟢 Canonical background style constants for core canvas modules

export interface BackgroundStyle {
  id: string;
  name: string;
  type: 'dots' | 'grid' | 'solid';
  density?: 'small' | 'medium' | 'large';
  color?: string;
  opacity?: number;
  size?: number;
}

// Minimal, stable set used by core components; UI panels may expose richer options
export const BACKGROUND_STYLES: BackgroundStyle[] = [
  { id: 'dots-medium', name: 'Dots', type: 'dots', density: 'medium', size: 24, opacity: 0.4 },
  { id: 'solid', name: 'Solid', type: 'solid' },
  { id: 'grid-medium', name: 'Grid', type: 'grid', density: 'medium', size: 24, opacity: 0.5 },
];

