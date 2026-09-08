import type { CSSProperties } from 'react';
import type { FontStyle, NodeStyles } from '../../types/canvas';
import { buildInlineMarkdownRhythmCssVariables } from './textMarkdownRhythm';

type TextAlign = 'left' | 'center' | 'right' | 'justify';

export interface TextTypographyTokens {
  fontSize: number;
  lineHeight: number;
  fontFamily: string;
  fontWeight: string | number;
  color: string;
  textAlign: TextAlign;
  letterSpacing: string;
}

interface ResolveTextTypographyTokensInput {
  fontStyle?: FontStyle;
  nodeStyles?: NodeStyles;
}

export function resolveTextTypographyTokens(
  input: ResolveTextTypographyTokensInput,
): TextTypographyTokens {
  const textStyles = input.nodeStyles?.textStyles;
  const textAlign = (textStyles?.textAlign ?? input.fontStyle?.textAlign ?? 'left') as TextAlign;

  return {
    fontSize: input.fontStyle?.size ?? 16,
    lineHeight: 1.4,
    fontFamily: input.fontStyle?.fontFamily ?? 'inherit',
    fontWeight: input.fontStyle?.weight ?? 'normal',
    color: input.fontStyle?.color ?? 'inherit',
    textAlign,
    letterSpacing: 'normal',
  };
}

export function buildInlineTypographyCssVariables(tokens: TextTypographyTokens): CSSProperties {
  const rhythmVars = buildInlineMarkdownRhythmCssVariables();
  return {
    ['--canvas-inline-font-size' as string]: `${tokens.fontSize}px`,
    ['--canvas-inline-line-height' as string]: `${tokens.lineHeight}`,
    ['--canvas-inline-font-family' as string]: tokens.fontFamily,
    ['--canvas-inline-font-weight' as string]: `${tokens.fontWeight}`,
    ['--canvas-inline-color' as string]: tokens.color,
    ['--canvas-inline-text-align' as string]: tokens.textAlign,
    ['--canvas-inline-letter-spacing' as string]: tokens.letterSpacing,
    ...rhythmVars,
  } as CSSProperties;
}
