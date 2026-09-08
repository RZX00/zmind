import type { CSSProperties } from 'react';

export const TEXT_MARKDOWN_RHYTHM = Object.freeze({
  paragraph: {
    marginTopRem: 0.25,
    marginBottomRem: 0.75,
  },
  heading1: {
    scale: 1.9,
    lineHeight: 1.2,
    letterSpacingEm: 0.01,
    marginTopRem: 1.2,
    marginBottomRem: 0.6,
    paddingBottomRem: 0.35,
  },
  heading2: {
    scale: 1.5,
    lineHeight: 1.25,
    marginTopRem: 1,
    marginBottomRem: 0.5,
  },
  heading3: {
    scale: 1.3,
    lineHeight: 1.3,
    marginTopRem: 0.85,
    marginBottomRem: 0.35,
  },
  heading4to6: {
    scale: 1,
    lineHeight: 1.4,
    marginTopRem: 0.65,
    marginBottomRem: 0.25,
  },
  list: {
    marginTopRem: 0.25,
    marginBottomRem: 0.65,
    marginLeftRem: 1.5,
    paddingLeftRem: 0.25,
    itemSpacingRem: 0.35,
  },
  task: {
    itemGapRem: 0.45,
    itemSpacingRem: 0.2,
    checkboxOffsetTopRem: 0.1,
  },
  horizontalRule: {
    marginTopRem: 0.6,
    marginBottomRem: 0.6,
  },
});

export function buildInlineMarkdownRhythmCssVariables(): CSSProperties {
  const rhythm = TEXT_MARKDOWN_RHYTHM;
  return {
    ['--canvas-inline-p-margin-top' as string]: `${rhythm.paragraph.marginTopRem}rem`,
    ['--canvas-inline-p-margin-bottom' as string]: `${rhythm.paragraph.marginBottomRem}rem`,

    ['--canvas-inline-h1-scale' as string]: `${rhythm.heading1.scale}`,
    ['--canvas-inline-h1-line-height' as string]: `${rhythm.heading1.lineHeight}`,
    ['--canvas-inline-h1-letter-spacing' as string]: `${rhythm.heading1.letterSpacingEm}em`,
    ['--canvas-inline-h1-margin-top' as string]: `${rhythm.heading1.marginTopRem}rem`,
    ['--canvas-inline-h1-margin-bottom' as string]: `${rhythm.heading1.marginBottomRem}rem`,
    ['--canvas-inline-h1-padding-bottom' as string]: `${rhythm.heading1.paddingBottomRem}rem`,

    ['--canvas-inline-h2-scale' as string]: `${rhythm.heading2.scale}`,
    ['--canvas-inline-h2-line-height' as string]: `${rhythm.heading2.lineHeight}`,
    ['--canvas-inline-h2-margin-top' as string]: `${rhythm.heading2.marginTopRem}rem`,
    ['--canvas-inline-h2-margin-bottom' as string]: `${rhythm.heading2.marginBottomRem}rem`,

    ['--canvas-inline-h3-scale' as string]: `${rhythm.heading3.scale}`,
    ['--canvas-inline-h3-line-height' as string]: `${rhythm.heading3.lineHeight}`,
    ['--canvas-inline-h3-margin-top' as string]: `${rhythm.heading3.marginTopRem}rem`,
    ['--canvas-inline-h3-margin-bottom' as string]: `${rhythm.heading3.marginBottomRem}rem`,

    ['--canvas-inline-h4-scale' as string]: `${rhythm.heading4to6.scale}`,
    ['--canvas-inline-h4-line-height' as string]: `${rhythm.heading4to6.lineHeight}`,
    ['--canvas-inline-h4-margin-top' as string]: `${rhythm.heading4to6.marginTopRem}rem`,
    ['--canvas-inline-h4-margin-bottom' as string]: `${rhythm.heading4to6.marginBottomRem}rem`,

    ['--canvas-inline-list-margin-top' as string]: `${rhythm.list.marginTopRem}rem`,
    ['--canvas-inline-list-margin-bottom' as string]: `${rhythm.list.marginBottomRem}rem`,
    ['--canvas-inline-list-margin-left' as string]: `${rhythm.list.marginLeftRem}rem`,
    ['--canvas-inline-list-padding-left' as string]: `${rhythm.list.paddingLeftRem}rem`,
    ['--canvas-inline-list-item-spacing' as string]: `${rhythm.list.itemSpacingRem}rem`,

    ['--canvas-inline-task-item-gap' as string]: `${rhythm.task.itemGapRem}rem`,
    ['--canvas-inline-task-item-spacing' as string]: `${rhythm.task.itemSpacingRem}rem`,
    ['--canvas-inline-task-checkbox-offset-top' as string]: `${rhythm.task.checkboxOffsetTopRem}rem`,

    ['--canvas-inline-hr-margin-top' as string]: `${rhythm.horizontalRule.marginTopRem}rem`,
    ['--canvas-inline-hr-margin-bottom' as string]: `${rhythm.horizontalRule.marginBottomRem}rem`,
  } as CSSProperties;
}
