// 积分换算与 tier-label 的单一真源(收敛 credit-purchase.tsx / credit-balance-card.tsx /
// PricingPageClient.tsx 各自重复的 toPoints / resolvePlanLabel)。
export const toPoints = (usd: number): number => Math.round(usd * 100);

export const formatPoints = (value: number): string =>
  value.toLocaleString(undefined, { maximumFractionDigits: 0, minimumFractionDigits: 0 });

export const formatPointsFromUsd = (usd: number): string => formatPoints(toPoints(usd));

// tier-id → 展示标签;充值模型下仅用于历史/兼容展示,不参与计费门控。
export const PLAN_LABELS: Readonly<Record<string, string>> = {
  free: 'Free',
  tier_2_20: 'Plus',
  tier_6_50: 'Pro',
  tier_25_200: 'MAX',
} as const;

export const resolvePlanLabel = (tierName?: string | null): string => {
  if (!tierName) return PLAN_LABELS.free;
  return PLAN_LABELS[tierName] ?? tierName;
};
