// Map model IDs to icon slugs and URL paths in `public/model-icons`

const MODEL_ICON_SLUGS: Array<{ match: RegExp; slug: string }> = [
  { match: /(claude|anthropic)/i, slug: 'claude' },
  { match: /(gpt|openai)/i, slug: 'gpt' },
  { match: /(moonshotai|kimi)/i, slug: 'kimi' },
  { match: /(gemini|google)/i, slug: 'gemini' },
  { match: /(grok|x-?ai)/i, slug: 'grok' },
  { match: /deepseek/i, slug: 'deepseek' },
  { match: /qwen/i, slug: 'qwen' },
  { match: /glm/i, slug: 'GLM' },
  { match: /minimax/i, slug: 'minimax' },
];

export function getModelIconSlug(modelId: string | undefined | null): string | null {
  if (!modelId) return null;
  const entry = MODEL_ICON_SLUGS.find(({ match }) => match.test(modelId));
  return entry ? entry.slug : null;
}

export function getModelIconUrl(modelId: string | undefined | null): string | null {
  const slug = getModelIconSlug(modelId);
  if (!slug) return null;
  // MiniMax icon is jpg; others are svg
  const extension = slug.toLowerCase() === 'minimax' ? 'jpg' : 'svg';
  return `/model-icons/${slug}.${extension}`;
}
