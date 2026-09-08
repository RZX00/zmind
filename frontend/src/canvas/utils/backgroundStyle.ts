// Utilities for canvas background rendering independent of UI panels
import { hexToRgba } from './colorUtils';
import type { BackgroundStyle } from '../constants/backgroundStyles';

// Generate CSS style for a given background pattern and colors
export const generateBackgroundStyle = (
  style: BackgroundStyle,
  customBackgroundColor?: string,
  customPatternColor?: string,
): React.CSSProperties => {
  const baseStyle: React.CSSProperties = { pointerEvents: 'none' };

  const bgColor = customBackgroundColor || '#eeeded';

  const isDarkHex = (hex: string): boolean => {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return false;
    let r = 0, g = 0, b = 0;
    if (hex.length === 4) {
      r = parseInt(hex[1] + hex[1], 16);
      g = parseInt(hex[2] + hex[2], 16);
      b = parseInt(hex[3] + hex[3], 16);
    } else {
      r = parseInt(hex.slice(1, 3), 16);
      g = parseInt(hex.slice(3, 5), 16);
      b = parseInt(hex.slice(5, 7), 16);
    }
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    return luminance < 0.5;
  };

  let basePatternColor = customPatternColor || style.color || '#C7C9CA';
  if (!customPatternColor && isDarkHex(bgColor)) {
    basePatternColor = '#4D4F52';
  }
  const patternOpacity = style.opacity || 0.4;
  const patternColor = hexToRgba(basePatternColor, patternOpacity);

  const baseSize = style.size || 20;
  const effectiveSize = Math.max(4, baseSize);

  switch (style.type) {
    case 'dots': {
      const auraColor = hexToRgba(basePatternColor, Math.min(1, patternOpacity * 0.35));
      const dotRadius = 1.4;
      const haloRadius = dotRadius + 1.2;
      return {
        ...baseStyle,
        backgroundImage: `radial-gradient(circle, ${patternColor} 0px, ${patternColor} ${dotRadius}px, ${auraColor} ${dotRadius}px, transparent ${haloRadius}px)`,
        backgroundSize: `${effectiveSize}px ${effectiveSize}px`,
        backgroundPosition: '0 0',
        backgroundColor: bgColor,
      };
    }
    case 'grid':
      return {
        ...baseStyle,
        backgroundImage: `
          linear-gradient(${patternColor} 1px, transparent 1px),
          linear-gradient(90deg, ${patternColor} 1px, transparent 1px)
        `,
        backgroundSize: `${effectiveSize}px ${effectiveSize}px`,
        backgroundColor: bgColor,
      };
    case 'solid':
      return { ...baseStyle, backgroundColor: bgColor, backgroundImage: 'none' };
    default:
      return { ...baseStyle, backgroundColor: bgColor };
  }
};

