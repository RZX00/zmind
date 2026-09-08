// 🎨 Shared text style type
// Isolated in its own module to avoid circular dependencies between canvas types and presets.

export interface TextStyles {
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  accentColor?: string;
  opacity?: number;
}
