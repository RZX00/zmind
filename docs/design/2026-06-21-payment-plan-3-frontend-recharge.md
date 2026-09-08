# 支付收敛 Plan 3:前端充值改造 (P4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把前端从「订阅式定价页 + 双 API 客户端」收敛为「纯预付费充值页 + 单一 `billing-v2` + react-query」。新增订单充值 API(`createTopupOrder` / `getOrderStatus`,对齐 Plan 1 的 `POST /billing/orders/checkout`、`GET /billing/orders/{id}`),把定价页改为「选档/自定义额度 + 按地区默认网关」的充值页,支付确认从轮询 `/billing/subscription` 改为轮询订单状态,删订阅管理 UI(取消/续订/portal/档位展示),并删 `lib/api.ts` 的 6 个旧计费函数 + 2 个旧订阅 hook 文件。

**Architecture:** 单一数据访问层 `lib/api/billing-v2.ts`(`billingApiV2` 对象 + 顶层导出函数);单一 react-query 层 `hooks/react-query/use-billing-v2.ts`(`billingKeys` + query/mutation hooks)。新增订单档位资源在 `lib/api/billing-v2.ts` 内定义(`TopupCheckoutRequest` / `TopupCheckoutResponse` / `OrderStatusResponse`),目录/网关枚举在新 `lib/billing/topup-catalog.ts`(与 Plan 1 `catalog.py` 档位字符串镜像)。充值视图 `components/billing/topup-section.tsx`(替代 `pricing-section.tsx` 的 checkout 角色),复用既有 `PaymentPendingDialog`。积分换算(×100)与 tier-label 收敛到共享 util `lib/billing/format.ts`。本计划纯前端;后端删订阅端点在 Plan 4,这里只**停用/移除**对订阅端点的调用。

**Tech Stack:** Next.js 15(App Router)/ TypeScript 严格模式 / TanStack Query v5(`@tanstack/react-query`)/ next-intl / sonner / lucide-react / shadcn-ui(Dialog/Card/Button/Alert/Input/RadioGroup)。包管理与脚本一律 **bun**(`bun run type-check` / `bun run lint`),禁用 npm。无既有前端测试框架(无 vitest/jest),故 TDD 以「先写最小可编译契约 + 类型断言文件,`bun run type-check` 失败→实现→通过」为节奏;无法跑组件测试的步骤给出明确手测脚本。

## Global Constraints

- 语言/工具:前端一律 **bun**;类型检查 `cd frontend && bun run type-check`(= `tsc --noEmit --skipLibCheck`,无 `typecheck` 别名);lint `cd frontend && bun run lint`(会连带跑 4 个 contract 检查)。**不要用 npm**。
- 🚨 项目级限制:**绝不** `bun run dev` / `bun run build` / `bun run start`;只跑 `type-check` / `lint`,且执行前征得用户同意。
- TypeScript 严格模式:不用 `any`(用 `unknown` + type guard);默认 `readonly` / `as const`;新接口给精确类型。
- 钱包规范单位:**Decimal USD 信用**为锚;前端展示用「积分=USD×100」,换算只在共享 util `toPoints` 一处。
- 网关/币种约束(对齐 Plan 1 `catalog.py`):Alipay↔CNY,Stripe↔USD;档位 id 字符串必须与后端 `_ALL_OFFERS`(`cny_30/cny_98/cny_298/usd_5/usd_15/usd_50`)逐字一致;自定义额度边界 CNY `[10,5000]`、USD `[2,1000]`(与后端 `CUSTOM_MIN/CUSTOM_MAX` 一致,前端只做体验校验,后端权威)。
- 默认网关路由(对齐 D2 / Plan 1 `routing.py`):`zh*` locale 或显式 CNY → Alipay,其余 → Stripe;用户可在 UI 显式覆盖。
- 支付确认:三入口幂等由后端保证;前端只轮询 `GET /billing/orders/{id}` 直到 `status==='paid'`,复用 `PaymentPendingDialog`,3s 轮询 / 2 分钟超时 + focus/visibility 复查(沿用现有常量 `PAYMENT_POLL_INTERVAL_MS=3000` / `PAYMENT_POLL_TIMEOUT_MS=120000`)。
- 本计划纯**新增/迁移/删前端**;不改后端;删订阅端点在 Plan 4——这里把前端对 `create-checkout-session`/`create-portal-session`/`subscription`(轮询用途)/`cancel-subscription`/`reactivate-subscription`/`check-status` 的调用移除或改道。
- 提交粒度:每个 Task 末尾一次 commit;信息以 `feat(payments):` / `refactor(payments):` / `chore(payments):` 开头。

## 4-Plan 拆解(本文件为 Plan 3)

- Plan 1(P0–P2):后端支付基础层(契约→网关→订单/结算→路由/sweeper)。**前置**。
- Plan 2(P3):钱包瘦身 + `entitlements.py` shim + 闸门塌缩。
- **Plan 3(本文件,P4)**:前端充值改造 + v2 客户端统一 + 订单轮询 + 删订阅 UI。
- Plan 4(P5–P6):feature flag 切换 → 一次性删 Creem/死代码 + 删订阅端点 → DB 去订阅列 → 回归。

执行前请用 `superpowers:using-git-worktrees` 在新分支(建议 `feat/payments-frontend-recharge`)隔离工作区,并先 `git fetch && git log origin/main --oneline -10` 确认本计划改动未被其它会话先做。

---

## Task 1: 充值订单 API 接入(billing-v2 + 共享目录/格式 util)

**Files:**
- Modify: `frontend/src/lib/api/billing-v2.ts:195`(在 `billingApiV2` 对象内新增两方法)+ `:391`(在文件末尾顶层导出后追加两个包装函数)
- Create: `frontend/src/lib/billing/topup-catalog.ts`
- Create: `frontend/src/lib/billing/format.ts`
- Test: `frontend/src/lib/billing/topup-catalog.contract.ts`(类型契约断言文件,编译期校验)

**Interfaces:**
- Consumes:`backendApi`(`@/lib/api-client`)、`getSessionAccessToken`(file-local,`billing-v2.ts:185`)。
- Produces:
  - `lib/api/billing-v2.ts`:`PaymentGatewayId = 'alipay' | 'stripe'`、`TopupCurrency = 'CNY' | 'USD'`、`TopupCheckoutRequest { gateway: PaymentGatewayId; currency: TopupCurrency; amount: number; offer_id: string | null; return_url: string; }`(字段名 `return_url` 必须与 Plan 1 后端 `CreateOrderRequest.return_url` 逐字一致——后端无 `success_url` 字段,Pydantic 会静默丢弃,导致回跳 URL 丢失)、`TopupCheckoutResponse { order_id: string; gateway: PaymentGatewayId; checkout_url: string; qr_payload: string | null; gateway_payment_id: string | null; }`、`OrderStatusResponse { order_id: string; status: 'pending'|'paid'|'failed'|'cancelled'|'expired'; credit_amount_usd: number; credited_at: string | null; }`、`billingApiV2.createTopupOrder(request) => Promise<TopupCheckoutResponse>`、`billingApiV2.getOrderStatus(orderId) => Promise<OrderStatusResponse>`,以及顶层 `export const createTopupOrder` / `getOrderStatus`。
  - `lib/billing/topup-catalog.ts`:`TOPUP_OFFERS`(`readonly TopupOffer[]`)、`offersForGateway(g)`、`gatewayForCurrency(c)`、`defaultGatewayForLocale(locale)`、`CUSTOM_BOUNDS`、`isCustomAmountValid(currency, amount)`。
  - `lib/billing/format.ts`:`toPoints(usd)`、`formatPoints(value)`、`PLAN_LABELS`(tier-id → label map,收敛魔法串)。

- [ ] **Step 1: 写编译期契约断言文件(先失败)**

```ts
// frontend/src/lib/billing/topup-catalog.contract.ts
// 编译期契约:确保 catalog/format 导出齐全且与 Plan 1 档位字符串一致。
// 该文件不在运行时被引用,仅供 `bun run type-check` 校验;若实现缺失则 tsc 报错。
import {
  TOPUP_OFFERS,
  offersForGateway,
  gatewayForCurrency,
  defaultGatewayForLocale,
  CUSTOM_BOUNDS,
  isCustomAmountValid,
  type TopupOffer,
} from './topup-catalog';
import { toPoints, formatPoints, PLAN_LABELS } from './format';
import type {
  PaymentGatewayId,
  TopupCurrency,
  TopupCheckoutRequest,
  TopupCheckoutResponse,
  OrderStatusResponse,
} from '@/lib/api/billing-v2';
import { createTopupOrder, getOrderStatus } from '@/lib/api/billing-v2';

// 档位 id 必须逐字匹配后端 catalog.py 的 _ALL_OFFERS
const _ids = TOPUP_OFFERS.map((o) => o.id);
const _expectedIds: readonly string[] = [
  'cny_30', 'cny_98', 'cny_298', 'usd_5', 'usd_15', 'usd_50',
] as const;
void (_ids as readonly string[]);
void _expectedIds;

const _alipay: readonly TopupOffer[] = offersForGateway('alipay');
const _stripe: readonly TopupOffer[] = offersForGateway('stripe');
const _g1: PaymentGatewayId = gatewayForCurrency('CNY');
const _g2: PaymentGatewayId = defaultGatewayForLocale('zh-CN');
const _bounds = CUSTOM_BOUNDS.CNY.min + CUSTOM_BOUNDS.USD.max;
const _ok: boolean = isCustomAmountValid('USD', 5);
const _pts: number = toPoints(5);
const _ptsStr: string = formatPoints(500);
const _label: string = PLAN_LABELS.tier_2_20;
const _cur: TopupCurrency = 'USD';

const _req: TopupCheckoutRequest = {
  gateway: 'stripe', currency: 'USD', amount: 5, offer_id: 'usd_5', return_url: '/x',
};
const _checkout: (r: TopupCheckoutRequest) => Promise<TopupCheckoutResponse> = createTopupOrder;
const _status: (id: string) => Promise<OrderStatusResponse> = getOrderStatus;

void [_alipay, _stripe, _g1, _g2, _bounds, _ok, _pts, _ptsStr, _label, _cur, _req, _checkout, _status];
```

- [ ] **Step 2: 运行确认失败**

Run(经用户同意后):`cd frontend && bun run type-check`
Expected: FAIL — `Cannot find module './topup-catalog'` / `'./format'`,以及 `billing-v2` 缺少 `createTopupOrder` 等导出。

- [ ] **Step 3: 实现共享 format util**

```ts
// frontend/src/lib/billing/format.ts
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
```

- [ ] **Step 4: 实现充值目录**

```ts
// frontend/src/lib/billing/topup-catalog.ts
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
```

- [ ] **Step 5: 在 billing-v2 新增类型 + 两方法 + 顶层导出**

在 `frontend/src/lib/api/billing-v2.ts` 顶部(`import` 之后、`CreditBalance` interface 之前,约 `:3`)新增类型块:

```ts
export type PaymentGatewayId = 'alipay' | 'stripe';
export type TopupCurrency = 'CNY' | 'USD';

export interface TopupCheckoutRequest {
  gateway: PaymentGatewayId;
  currency: TopupCurrency;
  amount: number;
  offer_id: string | null;
  return_url: string; // 对齐 Plan 1 后端 CreateOrderRequest.return_url(非 success_url)
}

export interface TopupCheckoutResponse {
  order_id: string;
  gateway: PaymentGatewayId;
  checkout_url: string;
  qr_payload: string | null;
  gateway_payment_id: string | null;
}

export interface OrderStatusResponse {
  order_id: string;
  status: 'pending' | 'paid' | 'failed' | 'cancelled' | 'expired';
  credit_amount_usd: number;
  credited_at: string | null;
}
```

在 `billingApiV2` 对象内、`claimDailyLogin()` 方法之后(`:369` 的 `}` 之前)新增两方法:

```ts
  ,

  async createTopupOrder(request: TopupCheckoutRequest) {
    const token = await getSessionAccessToken();
    const response = await backendApi.post<TopupCheckoutResponse>(
      '/billing/orders/checkout',
      request,
      token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
    );
    if (response.error) throw response.error;
    return response.data!;
  },

  async getOrderStatus(orderId: string) {
    const token = await getSessionAccessToken();
    const response = await backendApi.get<OrderStatusResponse>(
      `/billing/orders/${encodeURIComponent(orderId)}`,
      {
        showErrors: false,
        ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
      },
    );
    if (response.error) throw response.error;
    return response.data!;
  }
```

在文件末尾(`:391` 现有 `claimDailyLogin` 顶层导出之后)追加:

```ts
export const createTopupOrder = (request: TopupCheckoutRequest) =>
  billingApiV2.createTopupOrder(request);
export const getOrderStatus = (orderId: string) => billingApiV2.getOrderStatus(orderId);
```

- [ ] **Step 6: 运行确认通过**

Run:`cd frontend && bun run type-check`
Expected: PASS(无 error;`topup-catalog.contract.ts` 全部解析通过)。

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/api/billing-v2.ts frontend/src/lib/billing/topup-catalog.ts frontend/src/lib/billing/format.ts frontend/src/lib/billing/topup-catalog.contract.ts
git commit -m "feat(payments): topup order API in billing-v2 + shared catalog/format util"
```

---

## Task 2: 订单充值 react-query hooks

**Files:**
- Modify: `frontend/src/hooks/react-query/use-billing-v2.ts:39`(在 `billingKeys` 内加 `order`)+ `:168`(在 `usePurchaseCredits` 之后新增两 hook)
- Test: `frontend/src/hooks/react-query/use-billing-v2.contract.ts`(编译期断言)

**Interfaces:**
- Consumes:`billingApiV2.createTopupOrder` / `billingApiV2.getOrderStatus`(Task 1)、`openCheckoutInNewTab`(file-local,`use-billing-v2.ts:12`)、`billingKeys`。
- Produces:`billingKeys.order(orderId)`、`useCreateTopupOrder()`(mutation,Stripe 成功开新标签;返回 `TopupCheckoutResponse` 交由调用方决定 Alipay 展示二维码)、`useOrderStatus(orderId, enabled)`(query,2 入参,`refetchInterval=3000` 当 `pending`)。

- [ ] **Step 1: 写编译期契约断言文件(先失败)**

```ts
// frontend/src/hooks/react-query/use-billing-v2.contract.ts
import { billingKeys, useCreateTopupOrder, useOrderStatus } from './use-billing-v2';

const _key = billingKeys.order('o1');
void _key;
// 仅做类型存在性断言(hooks 不在此处调用)。
type _C = typeof useCreateTopupOrder;
type _S = typeof useOrderStatus;
const _c: _C = useCreateTopupOrder;
const _s: _S = useOrderStatus;
void [_c, _s];
```

- [ ] **Step 2: 运行确认失败**

Run:`cd frontend && bun run type-check`
Expected: FAIL — `Module '"./use-billing-v2"' has no exported member 'useCreateTopupOrder'`(及 `useOrderStatus`、`billingKeys.order`)。

- [ ] **Step 3: 实现**

在 `use-billing-v2.ts` 顶部 import 块补充类型(`:9` 现有 import 内追加):

```ts
import {
  billingApiV2,
  CreateCheckoutSessionRequest,
  CreatePortalSessionRequest,
  PurchaseCreditsRequest,
  TokenUsage,
  CancelSubscriptionRequest,
  TopupCheckoutRequest,
} from '@/lib/api/billing-v2';
```

在 `billingKeys`(`:30`)内 `inviteCodes` 之后加一行:

```ts
  order: (orderId: string) => [...billingKeys.all, 'order', orderId] as const,
```

在 `usePurchaseCredits`(`:168` 的 `};` 之后)新增:

```ts
export const useCreateTopupOrder = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: TopupCheckoutRequest) => billingApiV2.createTopupOrder(request),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: billingKeys.balance() });
      // Stripe:开新标签去 hosted Checkout。
      // Alipay:checkout_url 多为二维码串,展示交给调用方(topup-section)处理,不在此自动跳转。
      if (data.gateway === 'stripe' && data.checkout_url) {
        openCheckoutInNewTab(data.checkout_url);
      }
    },
  });
};

export const useOrderStatus = (orderId: string | null, enabled: boolean) => {
  return useQuery({
    queryKey: billingKeys.order(orderId ?? '__none__'),
    queryFn: () => billingApiV2.getOrderStatus(orderId as string),
    enabled: enabled && !!orderId,
    refetchInterval: (query) =>
      query.state.data?.status === 'pending' ? 3000 : false,
    staleTime: 0,
  });
};
```

- [ ] **Step 4: 运行确认通过**

Run:`cd frontend && bun run type-check`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/react-query/use-billing-v2.ts frontend/src/hooks/react-query/use-billing-v2.contract.ts
git commit -m "feat(payments): topup order react-query hooks (create + status polling)"
```

---

## Task 3: 充值视图组件 `topup-section.tsx`(选档/自定义/网关/二维码)

**Files:**
- Create: `frontend/src/components/billing/topup-section.tsx`
- Consumes(已存在,需 Read 确认):`PaymentPendingDialog`(`components/billing/payment-pending-dialog.tsx`,props 见下)、`useCreateTopupOrder` / `useOrderStatus`(Task 2)、`offersForGateway` / `defaultGatewayForLocale` / `isCustomAmountValid` / `CUSTOM_BOUNDS` / `GATEWAY_CURRENCY`(Task 1)、`formatPointsFromUsd`(Task 1)。

**Interfaces:**
- Produces:`export function TopupSection({ returnUrl, onTopupComplete }: TopupSectionProps)`。
- `PaymentPendingDialog` props(逐字,来自 `payment-pending-dialog.tsx:8`):`{ open, title, description, statusText?, errorText?, checking?, confirmLabel?, cancelLabel?, onConfirm, onCancel }`。

> 设计要点:网关由 locale 默认(`defaultGatewayForLocale(useLocale())`),用户可显式切换;选中网关决定币种与可见档位;支持「自定义额度」输入(体验校验用 `isCustomAmountValid`,`offer_id=null`);Stripe → mutation 自动开新标签;Alipay → 用 `qr_payload` 渲染二维码图(原生 `<img>` 指向 `https://api.qrserver.com/v1/create-qr-code/?data=<encoded>` 占位,不用 `next/image` 以免触发 remotePatterns 运行时报错,生产可换内嵌库,见 🔶);两条路径都打开 `PaymentPendingDialog` 并启动 `useOrderStatus` 轮询。

- [ ] **Step 1: 实现组件(给完整真实代码)**

```tsx
// frontend/src/components/billing/topup-section.tsx
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { PaymentPendingDialog } from '@/components/billing/payment-pending-dialog';
import { useCreateTopupOrder, useOrderStatus } from '@/hooks/react-query/use-billing-v2';
import type { PaymentGatewayId, TopupCurrency } from '@/lib/api/billing-v2';
import {
  offersForGateway,
  defaultGatewayForLocale,
  isCustomAmountValid,
  CUSTOM_BOUNDS,
  GATEWAY_CURRENCY,
} from '@/lib/billing/topup-catalog';
import { formatPointsFromUsd } from '@/lib/billing/format';

const PAYMENT_POLL_TIMEOUT_MS = 2 * 60 * 1000;
// USD 充值 1:1 → 信用;CNY 充值的最终信用由后端按快照汇率换算,这里仅做粗略展示。
const STATIC_USD_CNY = 7; // 仅前端粗略展示;真实信用由后端按 payment_settings 汇率(默认 7)换算

interface TopupSectionProps {
  returnUrl: string;
  onTopupComplete?: () => void;
}

const estimateUsd = (currency: TopupCurrency, amount: number): number =>
  currency === 'USD' ? amount : amount / STATIC_USD_CNY;

export function TopupSection({ returnUrl, onTopupComplete }: TopupSectionProps) {
  const t = useTranslations();
  const locale = useLocale();

  const [gateway, setGateway] = useState<PaymentGatewayId>(() => defaultGatewayForLocale(locale));
  const currency = GATEWAY_CURRENCY[gateway];
  const offers = useMemo(() => offersForGateway(gateway), [gateway]);

  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(offers[0]?.id ?? null);
  const [customAmount, setCustomAmount] = useState<string>('');
  const isCustom = selectedOfferId === null;

  const customNumber = Number(customAmount);
  const effectiveAmount = isCustom
    ? customNumber
    : offers.find((o) => o.id === selectedOfferId)?.amount ?? 0;
  const customValid = isCustom ? isCustomAmountValid(currency, customNumber) : true;

  // 订单 / 轮询状态
  const [orderId, setOrderId] = useState<string | null>(null);
  const [qrPayload, setQrPayload] = useState<string | null>(null);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [paymentChecking, setPaymentChecking] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const startRef = useRef<number>(0);

  const createOrder = useCreateTopupOrder();
  const { data: orderStatus, refetch: refetchOrder } = useOrderStatus(orderId, paymentDialogOpen);

  // 当网关切换:重置选档/自定义。
  useEffect(() => {
    setSelectedOfferId(offers[0]?.id ?? null);
    setCustomAmount('');
  }, [offers]);

  const resetPayment = useCallback(() => {
    setPaymentDialogOpen(false);
    setPaymentChecking(false);
    setPaymentError(null);
    setOrderId(null);
    setQrPayload(null);
  }, []);

  // 订单到账 → 收尾。
  useEffect(() => {
    if (!paymentDialogOpen || !orderStatus) return;
    if (orderStatus.status === 'paid') {
      resetPayment();
      toast.success(
        t('billing.paymentPending.successToast', {
          default: 'Payment confirmed. Updating your account.',
        }),
      );
      onTopupComplete?.();
    } else if (orderStatus.status === 'failed' || orderStatus.status === 'cancelled' || orderStatus.status === 'expired') {
      setPaymentError(
        t('billing.paymentPending.error', {
          default: "We couldn't verify the payment yet. Please try again.",
        }),
      );
    }
  }, [orderStatus, paymentDialogOpen, resetPayment, onTopupComplete, t]);

  // focus/visibility 复查。
  useEffect(() => {
    if (!paymentDialogOpen) return;
    startRef.current = Date.now();
    const handleFocus = () => {
      if (Date.now() - startRef.current <= PAYMENT_POLL_TIMEOUT_MS) refetchOrder();
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') handleFocus();
    };
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [paymentDialogOpen, refetchOrder]);

  const handleConfirmCheck = useCallback(async () => {
    setPaymentChecking(true);
    setPaymentError(null);
    try {
      await refetchOrder();
    } finally {
      setPaymentChecking(false);
    }
  }, [refetchOrder]);

  const handleTopup = async () => {
    if (!customValid || effectiveAmount <= 0) {
      const b = CUSTOM_BOUNDS[currency];
      setPaymentError(
        t('billing.topup.amountOutOfRange', {
          min: b.min,
          max: b.max,
          currency,
          default: `Amount must be between ${b.min} and ${b.max} ${currency}`,
        }),
      );
      return;
    }
    setPaymentError(null);
    try {
      const res = await createOrder.mutateAsync({
        gateway,
        currency,
        amount: effectiveAmount,
        offer_id: selectedOfferId,
        return_url: returnUrl,
      });
      setOrderId(res.order_id);
      if (res.gateway === 'alipay') {
        setQrPayload(res.qr_payload ?? res.checkout_url ?? null);
      }
      setPaymentDialogOpen(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start payment';
      setPaymentError(message);
      toast.error(message);
    }
  };

  return (
    <section className="flex w-full flex-col gap-6">
      {/* 网关切换 */}
      <div className="flex items-center gap-2">
        {(['alipay', 'stripe'] as const).map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => setGateway(g)}
            className={cn(
              'rounded-full border px-4 py-1.5 text-sm transition-colors',
              gateway === g
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            {g === 'alipay'
              ? t('billing.topup.gateway.alipay', { default: 'Alipay (CNY)' })
              : t('billing.topup.gateway.stripe', { default: 'Card (USD)' })}
          </button>
        ))}
      </div>

      {/* 预设档位 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {offers.map((offer) => {
          const active = selectedOfferId === offer.id;
          return (
            <Card
              key={offer.id}
              onClick={() => setSelectedOfferId(offer.id)}
              className={cn(
                'cursor-pointer transition-all',
                active ? 'ring-2 ring-primary' : 'hover:-translate-y-0.5',
              )}
            >
              <CardContent className="flex flex-col gap-1 p-4">
                <span className="text-2xl font-semibold">
                  {currency === 'USD' ? `$${offer.amount}` : `¥${offer.amount}`}
                </span>
                <span className="text-xs text-muted-foreground">
                  ≈ {formatPointsFromUsd(estimateUsd(currency, offer.amount))}{' '}
                  {t('billing.balanceCard.pointsUnit', { default: 'points' })}
                </span>
              </CardContent>
            </Card>
          );
        })}
        {/* 自定义额度 */}
        <Card
          onClick={() => setSelectedOfferId(null)}
          className={cn('cursor-pointer transition-all', isCustom ? 'ring-2 ring-primary' : 'hover:-translate-y-0.5')}
        >
          <CardContent className="flex flex-col gap-2 p-4">
            <span className="text-xs text-muted-foreground">
              {t('billing.topup.custom', { default: 'Custom amount' })}
            </span>
            <Input
              type="number"
              inputMode="decimal"
              value={customAmount}
              onChange={(e) => {
                setSelectedOfferId(null);
                setCustomAmount(e.target.value);
              }}
              placeholder={`${CUSTOM_BOUNDS[currency].min} – ${CUSTOM_BOUNDS[currency].max}`}
            />
            {isCustom && customAmount.length > 0 && !customValid && (
              <span className="text-xs text-destructive">
                {t('billing.topup.amountOutOfRange', {
                  min: CUSTOM_BOUNDS[currency].min,
                  max: CUSTOM_BOUNDS[currency].max,
                  currency,
                  default: `Amount must be between ${CUSTOM_BOUNDS[currency].min} and ${CUSTOM_BOUNDS[currency].max} ${currency}`,
                })}
              </span>
            )}
          </CardContent>
        </Card>
      </div>

      {paymentError && !paymentDialogOpen && (
        <Alert variant="destructive">
          <AlertDescription>{paymentError}</AlertDescription>
        </Alert>
      )}

      <Button
        className="w-full sm:w-auto"
        disabled={createOrder.isPending || !customValid || effectiveAmount <= 0}
        onClick={handleTopup}
      >
        {createOrder.isPending
          ? t('billing.topup.processing', { default: 'Processing…' })
          : t('billing.topup.pay', {
              amount: currency === 'USD' ? `$${effectiveAmount}` : `¥${effectiveAmount}`,
              default: `Pay ${currency === 'USD' ? '$' : '¥'}${effectiveAmount}`,
            })}
      </Button>

      <PaymentPendingDialog
        open={paymentDialogOpen}
        title={t('billing.paymentPending.title', { default: 'Payment in progress' })}
        description={
          gateway === 'alipay'
            ? t('billing.topup.alipayScan', { default: 'Scan the QR code with Alipay to complete payment.' })
            : t('billing.paymentPending.description', {
                default: 'Complete payment in the new tab. We will update this page when it is confirmed.',
              })
        }
        statusText={
          orderStatus?.status === 'pending'
            ? t('billing.paymentPending.status.waiting', { default: 'Waiting for payment confirmation...' })
            : undefined
        }
        errorText={paymentError}
        checking={paymentChecking}
        confirmLabel={t('billing.paymentPending.actions.confirm', { default: 'I have completed payment' })}
        cancelLabel={t('billing.paymentPending.actions.cancel', { default: 'Cancel payment' })}
        onConfirm={handleConfirmCheck}
        onCancel={resetPayment}
      />

      {/* Alipay 二维码渲染在对话框内容下方(对话框打开且有 payload 时) */}
      {paymentDialogOpen && gateway === 'alipay' && qrPayload && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center pointer-events-none">
          <div className="rounded-lg bg-background p-4 shadow-lg pointer-events-auto">
            {/* 用原生 <img>(非 next/image):二维码是外部动态 URL,next/image 需在 next.config.ts
                的 images.remotePatterns 里 allowlist 主机,否则运行时抛 "hostname not configured";
                本仓 next.config.ts 无 remotePatterns,且 ESLint `@next/next/no-img-element` 为 warn(不阻断 lint)。 */}
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(qrPayload)}`}
              alt="Alipay QR"
              width={220}
              height={220}
            />
          </div>
        </div>
      )}
    </section>
  );
}
```

> 🔶 二维码渲染:此处用原生 `<img>` 指向外部 `api.qrserver.com` 占位以零依赖落地(故意不用 `next/image`——见上方注释)。生产建议改用内嵌库(`qrcode.react`,需经用户同意新增依赖)或后端返回 `qr_code_data_url`(Plan 1 `CheckoutResult` 已含该可选字段,但当前 `POST /billing/orders/checkout` 路由响应只透传了 `checkout_url`/`qr_payload`/`gateway_payment_id`,**未含** `qr_code_data_url`——若要走 data-url 需先在 Plan 1 路由 §的返回 dict 与本计划 `TopupCheckoutResponse` 同步加 `qr_code_data_url: string | null`,再把 `src` 改为 `res.qr_code_data_url`);data-url 方案下可删外部主机依赖。

- [ ] **Step 2: 运行确认通过**

Run:`cd frontend && bun run type-check`
Expected: PASS。

> 手测脚本(待 Plan 4 切流量后,本步骤先记录,不在本计划执行 `dev`):
> 1. 在 `/subscription` 选 Stripe `$5` → 点 Pay → 新标签打开 Stripe Checkout,本页弹 `PaymentPendingDialog`。
> 2. 沙箱付款 → 2 分钟内对话框自动关闭 + toast「Payment confirmed」+ 余额刷新。
> 3. 切 Alipay → 选 `¥30` → Pay → 弹二维码 + 轮询;扫码付款后自动收尾。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/billing/topup-section.tsx
git commit -m "feat(payments): topup section (offer/custom/gateway + order polling)"
```

---

## Task 4: 充值页接线 — `PricingPageClient` 用 `TopupSection` 取代 `PricingSection`,删订阅档位/管理入口

**Files:**
- Modify: `frontend/src/components/pricing/PricingPageClient.tsx`(`:6` import、`:122-153` 渲染块、`:210-217` Manage 按钮)

**Interfaces:**
- Consumes:`TopupSection`(Task 3)、`useSubscriptionContext`(`contexts/SubscriptionContext.tsx:79`,保留只读余额展示)、`formatPoints`(改用 Task 1 `lib/billing/format` 的 `formatPoints`)。
- 移除:`PricingSection` import 与渲染、`BillingModal` import 与渲染(取消/续订/portal 入口随之消失)、`CreditPurchaseModal` 的「restore monthly」语义改由 `TopupSection` 承担(本页不再渲染 `CreditPurchaseModal`)。

- [ ] **Step 1: 改 import**

把 `PricingPageClient.tsx:6-9` 的
```tsx
import { PricingSection } from '@/components/home/sections/pricing-section';
import { BillingModal } from '@/components/billing/billing-modal';
import { CreditPurchaseModal } from '@/components/billing/credit-purchase';
import CreditTransactions from '@/components/billing/credit-transactions';
```
改为
```tsx
import { TopupSection } from '@/components/billing/topup-section';
import CreditTransactions from '@/components/billing/credit-transactions';
```

并删除本文件内 `:19-25` 的本地 `toPoints` / `formatPoints` 定义,改从共享 util 导入(在 import 区追加):
```tsx
import { toPoints, formatPoints as formatPointsValue } from '@/lib/billing/format';
```
并把文件内对 `formatPoints(format, x)` 的调用统一替换为 `formatPointsValue(toPoints(x))`(**共 5 处**:`:226` totalAvailable、`:237` periodTotal、`:264` used、`:265` total、`:272` extra/amount)。删除本地 `formatPoints` 后,`useFormatter` 的 `format` 变量(`:54`)仅剩 `format.dateTime`(`:112`、`nextRefreshText`)使用,故 `format` 与 `useFormatter` import 保留。

- [ ] **Step 2: 删订阅档位渲染 + BillingModal/CreditPurchaseModal,挂 TopupSection**

把 `:122-138` 的 `<BillingModal .../>` 与 `<CreditPurchaseModal .../>` 两块整体删除。
把 `:140-153` 的
```tsx
        {canManageBillingMutations && (
          <div className="w-full max-w-5xl mx-auto">
            <PricingSection
              returnUrl={returnUrl}
              showTitleAndTabs={false}
              showInfo={false}
              variant="dashboard"
              noPadding
              onSubscriptionUpdate={() => {
                // After successful subscription update, we remain on the page.
              }}
            />
          </div>
        )}
```
改为
```tsx
        {canManageBillingMutations && (
          <div className="w-full max-w-5xl mx-auto">
            <TopupSection
              returnUrl={returnUrl}
              onTopupComplete={() => {
                refetch();
                refetchBalance();
              }}
            />
          </div>
        )}
```

- [ ] **Step 3: 删「Manage Subscription」按钮**

把 `:210-217` 的
```tsx
                {canManageBillingMutations && (
                  <Button
                    onClick={() => setShowBillingModal(true)}
                    className="mt-6 bg-primary hover:bg-primary/90 shadow-md hover:shadow-lg transition-all"
                  >
                    {t('manageSubscription', { default: 'Manage Subscription' })}
                  </Button>
                )}
```
整块删除。随后删除现已未使用的 state:`:62-63` 的 `const [showBillingModal, setShowBillingModal] = useState(false);` 与 `const [showCreditPurchaseModal, setShowCreditPurchaseModal] = useState(false);`,以及 `:110` 的 `canPurchaseCredits`(若仅被已删块引用——Read 确认 `:241` 仍引用则保留;`:241` 的「Buy points」按钮一并删除,因充值统一走顶部 `TopupSection`)。删 `:240-250` 的 `<div className="flex flex-wrap ...">` Buy-points 块。

- [ ] **Step 4: 运行确认通过**

Run:`cd frontend && bun run type-check && bun run lint`
Expected: PASS(无未使用变量 / 无悬空 import;`Button` 若不再被引用则一并删 import)。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/pricing/PricingPageClient.tsx
git commit -m "refactor(payments): recharge page uses TopupSection, drop subscription tiers/manage UI"
```

---

## Task 5: 充值确认轮询统一 — `credit-purchase.tsx` 改用订单 API

**Files:**
- Modify: `frontend/src/components/billing/credit-purchase.tsx`(`:30-45` 本地格式函数、`:47-214` 手写轮询闭包、`:216-261` `handleConfirmPurchase`(内含 `:233` `backendApi.post('/billing/purchase-credits')` 与 `:113` `backendApi.get('/billing/subscription')`)、`:73-76` `refillCredits`/`refillPoints`/`refillPrice`/`canRefill` 推导、JSX 内 `:358` 的 `!canRefill` 与 `:400` 的 `formatPointsFromAmount`)

> 背景:`CreditPurchaseModal` 仍被 `credit-balance-card.tsx:159` 与 `usage-limit-alert.tsx`(子弹窗)使用,故不删,但把其支付流从「purchase-credits + 轮询 /billing/subscription 比对余额」改为「订单 API + 轮询订单状态」,与 `TopupSection` 同源。

**Interfaces:**
- Consumes:`useCreateTopupOrder` / `useOrderStatus`(Task 2)、`defaultGatewayForLocale` / `GATEWAY_CURRENCY`(Task 1)、`formatPointsFromUsd` / `resolvePlanLabel`(Task 1 `lib/billing/format`)、`useLocale`(next-intl)。
- 移除:`backendApi`(`@/lib/api-client`)直连;本地 `toPoints`/`formatPointsValue`/`formatPointsFromAmount`/`resolvePlanLabel`。

- [ ] **Step 1: 替换格式函数为共享 util**

删 `credit-purchase.tsx:30-45` 的本地 `toPoints` / `formatPointsValue` / `formatPointsFromAmount` / `formatMoney` / `resolvePlanLabel`,在 import 区(`:16` 之后)加:
```tsx
import { useLocale } from 'next-intl';
import { formatPointsFromUsd, resolvePlanLabel } from '@/lib/billing/format';
import { useCreateTopupOrder, useOrderStatus } from '@/hooks/react-query/use-billing-v2';
import { defaultGatewayForLocale, GATEWAY_CURRENCY } from '@/lib/billing/topup-catalog';
```
把**全部三处** `formatPointsFromAmount(x)` 调用(均在 return JSX 区,不在 Step 2 要删的 `:59-261` 组件体内)替换为 `formatPointsFromUsd(x)`:
- `:319` `Current credits: <strong>{formatPointsFromAmount(currentBalance)} points</strong>` → `formatPointsFromUsd(currentBalance)`;
- `:331` `<span className="font-medium">{refillPoints} points</span>` 中的 `refillPoints` 来源在 Step 2 重建为 `formatPointsFromUsd(...)`,本行无需改函数名,只需 Step 2 提供同名常量;
- `:400`(文件底部 `CreditBalanceDisplay`,`:395-433`)`const points = formatPointsFromAmount(balance);` → `const points = formatPointsFromUsd(balance);`(此处虽不在 modal 里,但同样依赖被删的本地函数,必须一并改,否则 `tsc` 报 `Cannot find name 'formatPointsFromAmount'`)。

`resolvePlanLabel(tierName)` 调用不变(改为共享导入;共享版签名 `(tierName?: string | null)` 与本地 `(tierName?: string)` 兼容)。`:73-76` 的 `refillCredits` / `refillPoints` / `refillPrice` / `canRefill` 推导随 Step 2 的 `:59-261` 整段替换消失,本 Step 不单独处理。

- [ ] **Step 2: 把 purchase-credits + 余额轮询改为订单 API + 订单状态轮询**

删除组件体顶部到 `handleConfirmPurchase` 末尾的**整段**(`:59-261`,即从 `const t = useTranslations();` 到 `handleConfirmPurchase` 的收尾 `};`):含 `:60-70` 全部 state/ref(`isProcessing`/`error`/`paymentDialogOpen`/`paymentStatusText`/`paymentError`/`paymentChecking`/`paymentWindowRef`/`pollingTimerRef`/`pollingStartRef`/`pollingInFlightRef`/`startingBalanceRef`)、`:72-76` 的 `planLabel`/`refillCredits`/`refillPoints`/`refillPrice`/`canRefill` 推导、`:78-214` 的手写轮询闭包(`stopPolling`/`resetPaymentState`/`checkPaymentStatus`/`schedulePolling` 及三个 `useEffect`)、`:216-261` 的 `handleConfirmPurchase`。用以下基于 hooks 的实现整体替换(此块即新的唯一 state/派生/handler 来源,不会与残留声明重复):

```tsx
    const t = useTranslations();
    const locale = useLocale();
    const [error, setError] = useState<string | null>(null);
    const [orderId, setOrderId] = useState<string | null>(null);
    const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
    const [paymentChecking, setPaymentChecking] = useState(false);

    const gateway = defaultGatewayForLocale(locale);
    const currency = GATEWAY_CURRENCY[gateway];
    const createOrder = useCreateTopupOrder();
    const { data: orderStatus, refetch: refetchOrder } = useOrderStatus(orderId, paymentDialogOpen);

    const planLabel = resolvePlanLabel(tierName);
    // 用所在网关的最小预设档位作为「快速充值」金额(替代旧的 monthlyCredits*0.6)。
    const quickAmount = currency === 'USD' ? 5 : 30;
    const refillPoints = formatPointsFromUsd(currency === 'USD' ? quickAmount : quickAmount / 7);

    const resetPayment = useCallback(() => {
      setPaymentDialogOpen(false);
      setPaymentChecking(false);
      setOrderId(null);
    }, []);

    useEffect(() => {
      if (!paymentDialogOpen || !orderStatus) return;
      if (orderStatus.status === 'paid') {
        resetPayment();
        toast.success(
          t('billing.paymentPending.successToast', { default: 'Payment confirmed. Updating your account.' }),
        );
        onPurchaseComplete?.();
      }
    }, [orderStatus, paymentDialogOpen, resetPayment, onPurchaseComplete, t]);

    const handleConfirmPurchase = async () => {
      setError(null);
      try {
        const buildReturnUrl = (status: string) => {
          if (typeof window === 'undefined') return `/dashboard?credit_refill=${status}`;
          const url = new URL(window.location.href);
          url.searchParams.set('credit_refill', status);
          return url.toString();
        };
        const res = await createOrder.mutateAsync({
          gateway,
          currency,
          amount: quickAmount,
          offer_id: null,
          return_url: buildReturnUrl('success'),
        });
        setOrderId(res.order_id);
        onOpenChange(false);
        setPaymentDialogOpen(true);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create checkout session';
        setError(message);
        toast.error(message);
      }
    };
```

把组件返回 JSX 内对 `isProcessing` 的引用统一改为 `createOrder.isPending`,且**同时去掉对已删 `canRefill` 的引用**,精确为:
- `:352` `disabled={isProcessing}` → `disabled={createOrder.isPending}`;
- `:358` `disabled={isProcessing || !canRefill}` → `disabled={createOrder.isPending}`(删 `!canRefill`,因 `canRefill` 已删);
- `:360` `{isProcessing ? (` → `{createOrder.isPending ? (`;
- `:368` `Pay ${refillPrice}` → `Pay ${currency === 'USD' ? '$' : '¥'}${quickAmount}`;
- `:333-336` `Price` / `${refillPrice}` 展示块整体删除(`refillPrice` 已删);`:330-332` 的 `Credits added` 行 `{refillPoints} points` 中的 `refillPoints` 改用 Step 2 重建的同名常量(值为 `formatPointsFromUsd(...)`)。

把底部 `PaymentPendingDialog`(`:375-390`)的 `onConfirm={() => checkPaymentStatus('manual')}` 改为 `onConfirm={async () => { setPaymentChecking(true); await refetchOrder(); setPaymentChecking(false); }}`,`onCancel={() => resetPaymentState()}` 改为 `onCancel={resetPayment}`,`checking={paymentChecking}` 保持,`statusText={paymentStatusText || undefined}` 改为 `statusText={orderStatus?.status === 'pending' ? t('billing.paymentPending.status.waiting', { default: 'Waiting for payment confirmation...' }) : undefined}`,`errorText={paymentError}` 改为 `errorText={error}`(`paymentError` state 已删,复用通用 `error`)。

所有旧 state/ref(`isProcessing`/`paymentStatusText`/`paymentError`/`paymentWindowRef`/`pollingTimerRef`/`pollingStartRef`/`pollingInFlightRef`/`startingBalanceRef`)与 `if (!canRefill)` 守卫已随 `:59-261` 整段替换而消失,无需单独处理。另删两处文件级声明:`:3` import 中已不用的 `useRef`(保留 `useCallback`/`useEffect`/`useState`);`:47-48` 的 `PAYMENT_POLL_INTERVAL_MS`/`PAYMENT_POLL_TIMEOUT_MS` 常量(轮询交给 `useOrderStatus`)。

- [ ] **Step 3: 运行确认通过**

Run:`cd frontend && bun run type-check && bun run lint`
Expected: PASS(无未使用 ref / 无 `backendApi` 悬空 import — 删 `:16` 的 `import { backendApi }`)。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/billing/credit-purchase.tsx
git commit -m "refactor(payments): credit-purchase uses order API + order-status polling"
```

---

## Task 6: 删旧栈调用方 1 — `pricing-section.tsx` 停用订阅 checkout

> `pricing-section.tsx` 是旧栈 checkout 起点(import `createCheckoutSession`/`getSubscription`/`SubscriptionStatus`/`CreateCheckoutSessionResponse` from `@/lib/api`,`useSubscription` from `@/hooks/react-query` 旧栈)。充值改造后它的「订阅」职责消失;但 `PricingSection` 仍被 `billing-modal.tsx`(将于 Task 7 删该入口)、`sidebar/zmind-enterprise-modal` 引用。本计划**保留组件作为静态营销展示**(`siteConfig.cloudPricingItems`),但**移除其一切订阅 API 调用与轮询**,按钮统一引导到 `/subscription` 充值页或 `/invite`。

**Files:**
- Modify: `frontend/src/components/home/sections/pricing-section.tsx`(`:26-37` import、`:399-539` 轮询闭包、`:542-645` `handleSubscribe`、`:996` `useSubscription`)

**Interfaces:**
- 移除:`createCheckoutSession`/`getSubscription`/`CreateCheckoutSessionResponse` from `@/lib/api`;`useSubscription` from `@/hooks/react-query`;`PaymentPendingDialog` 渲染;全部 `payment*`/`polling*` ref/state/effect。
- 保留:`SubscriptionStatus` 类型(用于 prop 形状)—— 改从 `@/lib/api` 仍可,但 Task 8 删该类型;为切断依赖,本 Task 在文件内定义本地最小 `type CurrentPlan = { price_id?: string; tier?: { name?: string }; has_purchase_qualification?: boolean } | null` 取代 prop 类型。

- [ ] **Step 1: 切断旧 API import,引入 AuthProvider-only**

把 `:26-31`
```tsx
import {
  createCheckoutSession,
  getSubscription,
  SubscriptionStatus,
  CreateCheckoutSessionResponse,
} from '@/lib/api';
```
删除。把 `:37` `import { useSubscription } from '@/hooks/react-query';` 删除。在文件顶部类型区新增:
```tsx
type CurrentPlan = {
  price_id?: string;
  plan_name?: string;
  tier?: { name?: string };
  has_purchase_qualification?: boolean;
} | null;
```
把 `PricingTierProps.currentSubscription: SubscriptionStatus | null`(`:101`)与 `PricingSectionProps` 内相关引用改为 `CurrentPlan`。删 `:49-50` 的 `PAYMENT_POLL_*` 常量与 `:40` 的 `PaymentPendingDialog` import。

- [ ] **Step 2: 删轮询闭包 + 改 handleSubscribe 为导流**

删 `:399-539` 全部 payment ref/state/`stopPolling`/`resetPaymentState`/`checkPaymentStatus`/`schedulePolling` 与三个 `useEffect`。把 `handleSubscribe`(`:542-645`)整体替换为:
```tsx
  const handleSubscribe = (_planStripePriceId: string) => {
    if (!isAuthenticated) {
      window.location.href = '/auth?mode=signup';
      return;
    }
    if (!hasPurchaseAccess) {
      window.location.href = '/invite';
      return;
    }
    // 充值模型:统一引导到充值页;不再创建订阅 checkout。
    window.location.href = '/subscription';
  };
```
删文件末尾 `PricingTier` return 内的 `<PaymentPendingDialog ... />`(`:949-965`)。

- [ ] **Step 3: 容器去 useSubscription**

`PricingSection`(`:981-1130`)把 `:996-999` **整段四行**(`useSubscription` 解构 `:996`、`:998` 的 `const isAuthenticated = isUserAuthenticated && !!subscriptionData && subscriptionQueryError === null;`、`:999` 的 `const currentSubscription = subscriptionData || null;`)替换为:
```tsx
  const currentSubscription: CurrentPlan = null;
  const isAuthenticated = isUserAuthenticated;
  const isFetchingPlan = false;
```
(必须连删 `:998`/`:999`,否则它们引用已删的 `subscriptionData` / `subscriptionQueryError`,且会与新 `isAuthenticated` / `currentSubscription` 重复声明。)`useSubscription` import 已在 Step 1 删除。再删 `:1034` 的 `refetchSubscription();` 调用(`handleSubscriptionUpdate` 仅保留清 loading + 调 `onSubscriptionUpdate`);`:1035` 的相关注释一并删。`getDefaultBillingPeriod`(`:1001-1020`)内对 `currentSubscription.price_id` 的引用在 `currentSubscription === null` 时进 `if (!isAuthenticated || !currentSubscription) return 'yearly';`(`:1002`)早返回,后续分支不会执行,保持不变。

- [ ] **Step 4: 运行确认通过**

Run:`cd frontend && bun run type-check && bun run lint`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/home/sections/pricing-section.tsx
git commit -m "refactor(payments): pricing-section becomes static marketing, drop subscription checkout"
```

---

## Task 7: 删旧栈调用方 2 — `billing-modal.tsx` 删订阅管理 UI

> `billing-modal.tsx` 是唯一调用 `getSubscription`/`createPortalSession`/`cancelSubscription`/`reactivateSubscription`(均来自 `@/lib/api` 旧栈)的组件,承载取消/续订/portal UI。充值模型下整块删除。它被 `usage-limit-alert.tsx`(`upgrade` 分支)、`PricingPageClient`(Task 4 已删该入口)、`zmind-enterprise-modal` 引用。

**Files:**
- Modify: `frontend/src/components/billing/billing-modal.tsx`(整文件重写为薄壳:仅 `PricingSection` 静态展示 + `CreditPurchaseModal`,删 `@/lib/api` 依赖与订阅状态/取消/续订/portal)
- Grep 确认调用方:`usage-limit-alert.tsx`、`sidebar/zmind-enterprise-modal.tsx`

- [ ] **Step 1: 重写 billing-modal 为薄壳**

```tsx
// frontend/src/components/billing/billing-modal.tsx
'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { TopupSection } from '@/components/billing/topup-section';
import { isLocalMode } from '@/lib/config';
import { useTranslations } from 'next-intl';

interface BillingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnUrl?: string;
  showUsageLimitAlert?: boolean;
}

export function BillingModal({
  open,
  onOpenChange,
  returnUrl = typeof window !== 'undefined' ? window?.location?.href || '/' : '/',
}: BillingModalProps) {
  const t = useTranslations();

  if (isLocalMode()) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('billing.modal.title', { default: 'Add credits' })}</DialogTitle>
          </DialogHeader>
          <div className="p-4 bg-muted/30 border border-border rounded-lg text-center">
            <p className="text-sm text-muted-foreground">
              Running in local development mode - billing features are disabled
            </p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('billing.modal.title', { default: 'Add credits' })}</DialogTitle>
        </DialogHeader>
        <TopupSection returnUrl={returnUrl} onTopupComplete={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: 验证调用方不依赖被删 props**

Run:`cd frontend && grep -rn "BillingModal" src/ --include=*.tsx`
Expected: 所有用法只传 `open`/`onOpenChange`/`returnUrl`(±`showUsageLimitAlert`);`showUsageLimitAlert` 在新壳保留为可选未用 prop(签名不变,故调用方不报错)。

- [ ] **Step 3: 运行确认通过**

Run:`cd frontend && bun run type-check && bun run lint`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/billing/billing-modal.tsx
git commit -m "refactor(payments): billing-modal drops subscription management, embeds TopupSection"
```

---

## Task 8: 删旧栈源 — `lib/api.ts` 6 个旧计费函数 + 类型 + 旧订阅 hooks

> 现在没有任何组件再依赖旧栈计费函数。删源并切断 `hooks/react-query/index.ts` re-export。

**Files:**
- Modify: `frontend/src/lib/api.ts`(删以下,精确符号):
  - `getSubscription`(`:2669`)、`createCheckoutSession`(`:2554`)、`createPortalSession`(`:2620`)、`checkBillingStatus`(`:2856`,旧 GET `/billing/check-status`)、`cancelSubscription`(`:2898`)、`reactivateSubscription`(`:2940`)。
  - 类型 `SubscriptionStatus`(`:2303`)、`BillingStatusResponse`(`:2411`)、`CreateCheckoutSessionResponse`(`:2502`)、`CreateCheckoutSessionRequest`(`:2290`)、`CreatePortalSessionRequest`(`:2298`)、`CancelSubscriptionResponse`(`:2531`)、`ReactivateSubscriptionResponse`(`:2543`)——均只被上述 6 函数引用。
  - **保留**:`getAvailableModels`(`:2724`)、`getProviderPolicy`(`:2767`)、`updateProviderPolicy`(`:2809`)——非订阅,v2 无对应。
- Delete: `frontend/src/hooks/react-query/subscriptions/use-subscriptions.ts`、`frontend/src/hooks/react-query/subscriptions/use-billing.ts`、`frontend/src/hooks/react-query/subscriptions/keys.ts`(`subscriptionKeys`,仅前两者引用)
- Modify: `frontend/src/hooks/react-query/index.ts:17-18`(删两行 re-export)
- Modify: `frontend/src/contexts/BillingContext.tsx`(`BillingStatusResponse` 来自 `@/lib/api` → 改为本地最小类型或 `threads/use-billing-status` 已有类型)

- [ ] **Step 1: 删两个旧 hook 文件 + 去 re-export**

```bash
git rm frontend/src/hooks/react-query/subscriptions/use-subscriptions.ts frontend/src/hooks/react-query/subscriptions/use-billing.ts frontend/src/hooks/react-query/subscriptions/keys.ts
```
> `subscriptions/keys.ts`(`subscriptionKeys`)仅被 `use-subscriptions.ts:9` 引用(已 `grep -rn "subscriptions/keys" src/` 确认无其它 importer),两个 hook 删后即成孤儿,故一并 `git rm`;整个 `subscriptions/` 目录随之清空。
把 `hooks/react-query/index.ts:17-18`
```ts
export * from './subscriptions/use-subscriptions';
export * from './subscriptions/use-billing';
```
删除。

- [ ] **Step 2: 删 lib/api.ts 6 函数 + 3 类型**

逐个删除 `lib/api.ts` 内 6 个函数(均为 `export const ... = async`):`createCheckoutSession`(`:2554`)、`createPortalSession`(`:2620`)、`getSubscription`(`:2669`)、`checkBillingStatus`(`:2856`)、`cancelSubscription`(`:2898`)、`reactivateSubscription`(`:2940`);以及随之只被这 6 函数引用的类型:`SubscriptionStatus`(`:2303` 起的 interface,被 `getSubscription` 返回 + pricing-section prop——Task 6 已改本地 `CurrentPlan`,故安全)、`BillingStatusResponse`(`:2411`,被 `checkBillingStatus` 返回 + BillingContext——Task 8 Step 3 改本地)、`CreateCheckoutSessionResponse`(`:2502`)、`CreateCheckoutSessionRequest`(`:2290`,经 `grep -rn "CreateCheckoutSessionRequest" src/` 确认仅 `lib/api.ts` 自身 + 已删的 `subscriptions/use-billing.ts:7` 引用,安全删)、`CreatePortalSessionRequest`(`:2298`,仅 `createPortalSession` 用)、`CancelSubscriptionResponse`(`:2531`,仅 `cancelSubscription` 用)、`ReactivateSubscriptionResponse`(`:2543`,仅 `reactivateSubscription` 用)。**保留**:`getAvailableModels`(`:2724`)、`getProviderPolicy`(`:2767`)、`updateProviderPolicy`(`:2809`)——非订阅,v2 无对应。注意 billing-v2.ts 内同名的 `CreateCheckoutSessionRequest` / `CancelSubscriptionRequest` 等是独立定义,**不要动**(use-billing-v2 旧订阅 hook 仍在,直到 Plan 4 删端点;本计划不删 billing-v2 的订阅类型/方法)。

- [ ] **Step 3: 修 BillingContext 类型来源**

Read `frontend/src/contexts/BillingContext.tsx` 确认 `BillingStatusResponse` 引用点;把 `import { BillingStatusResponse } from '@/lib/api'` 改为从 `@/hooks/react-query/threads/use-billing-status`(`useBillingStatusQuery` 的返回类型)导出的类型,或在 BillingContext 内本地定义:
```ts
type BillingStatusResponse = { can_run: boolean; message: string; balance?: number };
```

- [ ] **Step 4: 全仓校验无悬空引用**

Run:`cd frontend && grep -rn "from '@/lib/api'" src/ | grep -iE "getSubscription|createCheckoutSession|createPortalSession|checkBillingStatus|cancelSubscription|reactivateSubscription|SubscriptionStatus|BillingStatusResponse|CreateCheckoutSessionResponse"`
Expected: 无输出(无残留旧栈引用)。

- [ ] **Step 5: 运行确认通过**

Run:`cd frontend && bun run type-check && bun run lint`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/hooks/react-query/index.ts frontend/src/contexts/BillingContext.tsx
git commit -m "chore(payments): remove legacy billing api fns + subscription hooks"
```

---

## Task 9: 删死代码 + 统一 transactions hook + 验收

> §5 报告 4 个 `Personal*/Team*Billing*.tsx` 在 `components/billing/` 外无引用(死代码),且依赖将被删的 `useSharedSubscription` 旧组合。`useTransactions` 三重命名:收敛到 `billing/use-transactions.ts`(组件实际用、返回 `{transactions,pagination,current_balance}`),删 v2 的同名 `useTransactions`(无组件用 v2 版,见 §3)。

**Files:**
- Delete: `frontend/src/components/billing/PersonalBillingClient.tsx`、`PersonalBillingUnified.tsx`、`TeamBillingClient.tsx`、`TeamBillingUnified.tsx`
- Modify: `frontend/src/hooks/react-query/use-billing-v2.ts`(删 `useTransactions`(`:72-80`)+ `billingKeys.transactions`(`:35-36`)若无其它引用;Read `billing-v2.ts` 顶层 `getTransactions` 保留供 admin/usage 用,仅删 hook 包装)

- [ ] **Step 1: 删死代码前再确认无引用**

Run:`cd frontend && grep -rn "PersonalBillingClient\|PersonalBillingUnified\|TeamBillingClient\|TeamBillingUnified" src/ --include=*.tsx | grep -v "components/billing/"`
Expected: 无输出 → 安全删除。

```bash
git rm frontend/src/components/billing/PersonalBillingClient.tsx frontend/src/components/billing/PersonalBillingUnified.tsx frontend/src/components/billing/TeamBillingClient.tsx frontend/src/components/billing/TeamBillingUnified.tsx
```

- [ ] **Step 2: 收敛 transactions hook**

Run:`cd frontend && grep -rn "useTransactions" src/ --include=*.tsx --include=*.ts | grep -v "billing/use-transactions"`
Expected: 仅 `use-billing-v2.ts` 自身定义行(无组件从 v2 import `useTransactions`)。确认后删 `use-billing-v2.ts:72-80` 的 `useTransactions` hook 与 `billingKeys.transactions`(`:35-36`);保留 `usePurchaseCredits` 内 `billingKeys.transactions()` 失效调用 → 改为 `queryClient.invalidateQueries({ queryKey: ['billing', 'transactions'] })`(与 `useClaimDailyLogin:177` 同款字面量 key,匹配 `billing/use-transactions.ts` 的 `['billing','transactions',...]`)。

- [ ] **Step 3: 运行确认通过**

Run:`cd frontend && bun run type-check && bun run lint`
Expected: PASS。

- [ ] **Step 4: 验收清单(手测,Plan 4 切流量后执行;本步骤记录为验收标准)**

- [ ] `cd frontend && bun run type-check` 通过(0 error)。
- [ ] `cd frontend && bun run lint` 通过(含 4 个 contract 检查)。
- [ ] `/subscription`(个人)与 `/team/[slug]/subscription`(团队 owner)渲染充值页:档位 + 自定义 + 网关切换,无「取消/续订/Manage Subscription/订阅档位」UI。
- [ ] Stripe `$5` → 新标签 Checkout → 沙箱付款 → 2 分钟内对话框自动关闭 + 余额刷新(轮询 `GET /billing/orders/{id}` 命中 `paid`)。
- [ ] Alipay `¥30` → 二维码 + 轮询 → 扫码付款后自动收尾。
- [ ] `credit-balance-card` 的 Restore 按钮、`usage-limit-alert` 的 purchase 分支均打开新充值流(`CreditPurchaseModal` → 订单 API),无对 `/billing/subscription`/`purchase-credits` 的调用(DevTools Network 核验)。
- [ ] 全仓 `grep` 无对已删订阅端点/旧栈函数的引用(Task 8 Step 4)。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(payments): delete dead billing pages, converge transactions hook"
```

---

## ANCHORS(本计划新增的前端符号,后续 Plan/会话引用以此为准)

- `lib/api/billing-v2.ts`:`PaymentGatewayId`、`TopupCurrency`、`TopupCheckoutRequest`、`TopupCheckoutResponse`、`OrderStatusResponse`、`billingApiV2.createTopupOrder` / `.getOrderStatus`、顶层 `createTopupOrder` / `getOrderStatus`。
- `lib/billing/topup-catalog.ts`:`TopupOffer`、`TOPUP_OFFERS`、`GATEWAY_CURRENCY`、`CUSTOM_BOUNDS`、`offersForGateway` / `gatewayForCurrency` / `defaultGatewayForLocale` / `isCustomAmountValid`。
- `lib/billing/format.ts`:`toPoints` / `formatPoints` / `formatPointsFromUsd` / `PLAN_LABELS` / `resolvePlanLabel`。
- `hooks/react-query/use-billing-v2.ts`:`billingKeys.order(orderId)`、`useCreateTopupOrder` / `useOrderStatus(orderId, enabled)`。
- `components/billing/topup-section.tsx`:`TopupSection({ returnUrl, onTopupComplete })`。
- 端点对齐 Plan 1:`POST /billing/orders/checkout`、`GET /billing/orders/{order_id}`。
