// 镜像后端 catalog.py(CATALOG_VERSION/_ALL_OFFERS/CUSTOM_MIN/CUSTOM_MAX);
// 后端为权威,前端仅做展示与体验校验。档位 id 必须逐字一致。
import type { PaymentGatewayId, TopupCurrency } from '@/lib/api/billing-v2';

export interface TopupOffer {
  readonly id: string;
  readonly gateway: PaymentGatewayId;
  readonly currency: TopupCurrency;
  readonly amount: number; // 支付币种金额(CNY 元 / USD 美元)
}

export const TOPUP_OFFERS: readonly TopupOffer[] = [
  { id: 'cny_30', gateway: 'alipay', currency: 'CNY', amount: 30 },
  { id: 'cny_98', gateway: 'alipay', currency: 'CNY', amount: 98 },
  { id: 'cny_298', gateway: 'alipay', currency: 'CNY', amount: 298 },
  { id: 'usd_5', gateway: 'stripe', currency: 'USD', amount: 5 },
  { id: 'usd_15', gateway: 'stripe', currency: 'USD', amount: 15 },
  { id: 'usd_50', gateway: 'stripe', currency: 'USD', amount: 50 },
] as const;

export const GATEWAY_CURRENCY: Readonly<Record<PaymentGatewayId, TopupCurrency>> = {
  alipay: 'CNY',
  stripe: 'USD',
} as const;

export const CUSTOM_BOUNDS: Readonly<Record<TopupCurrency, { min: number; max: number }>> = {
  CNY: { min: 10, max: 5000 },
  USD: { min: 2, max: 1000 },
} as const;

export const offersForGateway = (gateway: PaymentGatewayId): readonly TopupOffer[] =>
  TOPUP_OFFERS.filter((o) => o.gateway === gateway);

export const gatewayForCurrency = (currency: TopupCurrency): PaymentGatewayId =>
  currency === 'CNY' ? 'alipay' : 'stripe';

export const defaultGatewayForLocale = (locale?: string | null): PaymentGatewayId =>
  (locale ?? '').toLowerCase().startsWith('zh') ? 'alipay' : 'stripe';

export const isCustomAmountValid = (currency: TopupCurrency, amount: number): boolean => {
  const b = CUSTOM_BOUNDS[currency];
  return Number.isFinite(amount) && amount >= b.min && amount <= b.max;
};
