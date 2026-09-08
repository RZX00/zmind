# 支付系统收敛与架构优化设计 (Payment Convergence & Architecture Optimization)

> 日期:2026-06-21 · 分支:feat/canvas-read-contract(支付改造将另开分支) · 状态:设计待评审
> 参考实现:`E:\app\aip`(同一作者的双网关支付系统,Alipay + Stripe)
> 现状详图:`.tmp/arch-audit/payment-system-map.md`(zmind 现有支付全景)、`.tmp/aip-payment-map.json`(aip 参考)

---

## 1. 背景与目标

zmind 现有支付系统三代代码并存(详见现状图):
1. **LEGACY / 已死**:`core/services/billing.py`(2859 行,Stripe-on-Basejump,零导入、未挂载)。
2. **LIVE**:`core/billing/*`,预付费信用额度模型,支付商 **Creem**。
3. **DDD 切片**:`domains/application/infrastructure/billing` + `domain_outbox`(活的领域事件总线)。

**本次目标**:把支付路径收敛为两条 —— **支付宝(国内 CNY)** + **Stripe(国际 USD)**,移除 Creem 及一切多余/死代码,并按 aip 已验证的干净架构做**系统性优化**。

---

## 2. 已锁定决策(来自需求澄清)

| # | 维度 | 决定 |
|---|---|---|
| D1 | 计费模型 | **纯预付费充值**,去掉一切周期订阅(无 Alipay 周期扣款、无 Stripe subscription) |
| D2 | 网关选择 | **按地区/货币自动路由**(CN/CNY→Alipay,其余→Stripe),前端可显式覆盖 |
| D3 | 货币单位 | **Decimal USD 信用为规范锚** + CNY 入账时汇率快照;USD/CNY 汇率**管理员可改、默认 7**(存 `payment_settings`) |
| D4 | 模型门控 | **全部模型按用量从余额扣费**,去掉 tier/allowed_models/unlimited 的*计费*门控 |
| D5 | 退款 | **仅管理员信用调整**;PaymentGateway 暂不加 `refund()` |
| D6 | 订单建模 | **新建统一 `payment_orders` 表**(OrderRecord) |
| D7 | Creem 退场 | **一次性移除**(假定线上无活跃 Creem 付费数据;迁移前置须确认) |
| D8 | DDD/outbox | **保留**(核验:`run_outbox_relay.py` 为活 docker 服务,`projection_worker`/`audit_admin` 在消费;与支付正交) |
| D9 | provider_policy | **保留**(用户自选 AI 厂商开关,`agent_runs.py` 直接依赖;与支付正交,仅从 `subscription_service` 解耦) |

---

## 3. aip 参考架构提炼(要抄的东西)

aip 的支付核心其实**也是预付费钱包**(一次性充值 order),与 zmind 同源;它额外的"coding plan 订阅层"不迁移。可复用模式:

1. **小而全的 `PaymentGateway` 契约 + 归一化 DTO**:4 方法(checkout / query / cancel? / verify_notification),`paid/failed/cancelled` 三态在**一处**从原始状态串派生。
2. **26 行 registry resolver + 能力门控注册**:配了密钥才注册;路由策略放在 resolver 之上的薄层,resolver 本身只做纯查表。
3. **per-user 锁 + `credited_at`/`fulfilled_at` 幂等闸门**:webhook / 轮询 / sweeper 三入口走同一幂等结算路径。
4. **reconcile sweeper + 轮询兜底**:webhook 视为 best-effort,丢通知可自愈,永不双发。
5. **webhook 失败策略**:只有**签名错**返回 4xx,其余一律 5xx 让对方重试;限流在验签之前;Stripe 用**原始 body** 验签。
6. **USD 规范锚 + 每行 FX 快照**:CNY 在边界换算一次,汇率钉到行上,历史订单永不重定价。
7. **服务端权威充值目录 + 价格快照**:绝不信任 client 金额。
8. **窄 Protocol 注入 SDK**:测试用 fake,近 1:1 测试覆盖。

---

## 4. 目标模块布局

```
backend/core/billing/
  payments/                      # 🆕 全新支付层(仿 aip 分层)
    contract.py                  # PaymentGateway Protocol + DTO(冻结 dataclass)
    routing.py                   # 地区/货币 → gateway_id 自动路由(resolver 之上薄层)
    resolver.py                  # PaymentGatewayResolver:registry + 能力门控
    fx.py                        # USD/CNY 汇率解析器(live→cached→static)+ 快照
    catalog.py                   # 服务端权威充值目录(CNY/USD 档 + 受限自定义 + 价格快照)
    orders.py                    # OrderService:建单 + 幂等结算(credited/fulfilled 闸门)
    sweeper.py                   # reconcile 兜底(Dramatiq 周期任务)
    gateways/
      __init__.py
      alipay.py                  # AlipayGateway + AlipayClient Protocol(窄接口便于 fake)
      stripe.py                  # StripeGateway(一次性 mode="payment" Checkout)
  pricing.py                     # 🆕 calculate_token_cost 单一真源(从 api.py 抽出)
  entitlements.py                # 🆕 顶替 subscription_service 的统一限额 shim(见 §9)
  credit_manager.py              # ♻️ 瘦身为纯钱包引擎
  config.py                      # ♻️ 去 TIERS/订阅价,保留 token 定价 + 新增充值目录常量
  api.py                         # ♻️ 路由收敛
  admin.py                       # 基本不动(已是信用调额)
```

---

## 5. 支付契约 `payments/contract.py`

> 落地 aip #1(4 方法接口 + 归一化 DTO)+ #3(三态归一)。**替换** `providers/base.py`(订阅形错接口,返回裸 Dict)。

```python
class PaymentGatewayId(StrEnum):
    ALIPAY = "alipay"
    STRIPE = "stripe"

@dataclass(frozen=True)
class CheckoutResult:
    checkout_url: str
    qr_payload: str | None = None          # Alipay 扫码
    qr_code_data_url: str | None = None
    gateway_payment_id: str | None = None  # session_id / out_trade_no

@dataclass(frozen=True)
class PaymentNotification:
    order_id: str
    amount: Decimal                        # 原始支付币种金额
    currency: Literal["CNY", "USD"]
    trade_no: str | None                   # 网关交易号
    gateway_status: str                    # 原始状态串(审计)
    paid: bool                             # ← 三态由原始状态在「一处」派生
    failed: bool
    cancelled: bool
    payload: dict[str, Any]                # 原始报文逐字保留

class PaymentGateway(Protocol):
    gateway_id: PaymentGatewayId
    async def create_order_checkout(self, *, order_id, account_id, amount, currency,
                                    public_base_url, notify_base_url=None,
                                    flow="redirect", return_url=None) -> CheckoutResult: ...
    async def query_order_status(self, *, order_id, trade_no=None,
                                 gateway_payment_id=None) -> PaymentNotification | None: ...
    async def verify_notification(self, params: dict[str, Any]) -> PaymentNotification | None: ...
    # cancel_order 可选;refund 暂不加(D5)
```

**纪律**:`paid/failed/cancelled` 只在各 gateway 内 `_parse_status()` 里从原始串(`TRADE_SUCCESS` / `checkout.session.completed` …)映射**一次**;结算逻辑永不 string-match 网关码。

---

## 6. Resolver + 自动路由 `resolver.py` / `routing.py`

> 落地 aip #2。**替换** `providers/__init__.py`(三处硬编码 `'creem'`)。

```python
# resolver.py — 纯查表
class PaymentGatewayResolver:
    def __init__(self, gateways: list[PaymentGateway]):
        self._by_id = {g.gateway_id: g for g in gateways}
    def resolve(self, gid: PaymentGatewayId) -> PaymentGateway:
        if gid not in self._by_id:
            raise PaymentGatewayNotConfigured(gid)
        return self._by_id[gid]

# 组合根(api 启动):配了密钥才注册
gateways = []
if config.ALIPAY_APP_ID and config.ALIPAY_PRIVATE_KEY:
    gateways.append(AlipayGateway(...))
if config.STRIPE_SECRET_KEY and config.STRIPE_WEBHOOK_SECRET:
    gateways.append(StripeGateway(...))
resolver = PaymentGatewayResolver(gateways)
```

```python
# routing.py — 策略放在 resolver 之上(resolver 保持 dumb)
def route_gateway(account_region: str | None, currency_hint: str | None,
                  explicit: PaymentGatewayId | None) -> PaymentGatewayId:
    if explicit: return explicit
    if (account_region or "").upper() in CN_REGIONS or (currency_hint == "CNY"):
        return PaymentGatewayId.ALIPAY
    return PaymentGatewayId.STRIPE
```

地区来源优先级:前端显式 > 用户 profile > `Accept-Language`/IP。未配置网关自动缺席(本地无 Alipay 时只剩 Stripe,不报错)。

---

## 7. 两个网关 `gateways/alipay.py` & `gateways/stripe.py`

> 落地 aip #8(窄 Protocol 注入)+ #5(webhook 失败策略 + raw body)。

**AlipayGateway**(`alipay-sdk-python`):
- `create_order_checkout`:`flow="qr"`→`alipay.trade.precreate`(二维码串);`flow="redirect"`→`alipay.trade.page.pay`(PC 收银台)。金额=**元**,两位小数字符串。
- `verify_notification`:RSA2 验签(`notify_url` 异步通知);通知路由返回纯文本 `success`/`failure`。
- `query_order_status`:`alipay.trade.query`(轮询 + sweeper)。
- SDK 封装在窄 `AlipayClient` Protocol(`precreate`/`page_pay`/`query`/`verify` 4 法)后注入,测试用 fake。
- ⚠️ 密钥从 `config` 读(非 env-lazy)。公钥模式 vs 证书模式实现时确认(`ALIPAY_PUBLIC_KEY` vs `*_CERT_PATH`)。

**StripeGateway**(`stripe` SDK):
- `create_order_checkout`:**一次性 `mode="payment"` Checkout Session**,内联 `price_data`(USD),`client_reference_id=order_id`,`idempotency_key=f"checkout-{order_id}"`。**丢弃**现 `stripe_provider.py` 的 `mode="subscription"`/portal/get-cancel-reactivate。
- `verify_notification`:`stripe.Webhook.construct_event(raw_body, sig, secret)`;FastAPI 路由必须 `await request.body()` 取**原始字节**,不过 Pydantic。
- `query_order_status`:`cs_*`→`checkout.Session.retrieve`;只处理 `checkout.session.{completed,async_payment_succeeded,async_payment_failed,expired}`。
- 移植 `is_signature_error()`:**只有签名错→400**,其余→5xx 让 Stripe 重试。限流在验签前。

---

## 8. 订单 + 幂等结算 `orders.py`(系统心脏)

> 落地 aip #3。新建 **`payment_orders`** 表(D6)。

**`payment_orders` 列**:`id, account_id, gateway, status(pending|paid|failed|cancelled|expired), pay_currency(CNY|USD), pay_amount, credit_amount_usd, fx_rate_usd_cny(nullable), catalog_id, catalog_version, price_snapshot, gateway_payment_id, trade_no, gateway_status, notify_payload(jsonb), credited_at, fulfilled_at, created_at, updated_at, expires_at`

**建单** `create_order`:
```
校验 client 金额 vs catalog(±0.01)→ 快照 price + fx
→ INSERT payment_orders(pending)
→ gateway.create_order_checkout(...) → 回写 gateway_payment_id
→ 返回 CheckoutResult
```

**结算** `settle(notification)` —— webhook / sweeper / 轮询**三入口共用**:
```
1. 读 order;若 credited_at 已设 → 返回(幂等 no-op)
2. notification.paid:
     credit_manager.add_credits(account_id, credit_amount_usd, is_expiring=False,
         type='purchase', billing_dedup_key=f"order:{order_id}")
     → UPDATE order SET status=paid, trade_no, gateway_status,
                        credited_at=now, fulfilled_at=now
   notification.failed/cancelled → UPDATE status
```

**三重幂等护栏**:① `add_credits_idempotent` RPC(行锁 + `billing_dedup_key` 唯一)② `credited_at` 闸门 ③ 可选 `pg_advisory_xact_lock(hash(account_id))`。主保证靠 ①+②;若 RPC 内未持账户级锁,补 ③。**绝不可能双发信用。**

---

## 9. Entitlements `entitlements.py`(顶替 subscription_service)

> ⚠️ **关键约束(核验所得)**:`subscription_service.get_user_subscription_tier` 被 **6+ 个非计费文件**调用:
> `agent_runs.py:170`(allowed_models)、`files/api.py:227/402/581`(文件限额)、`knowledge_base/api.py:45`(KB 限额)、`ai_models/manager.py:196`(模型默认)、`core_utils.py:737`、`billing/api.py`(多处)、`payment_service.py:21`。
> 因此 `tier` 不止做计费门控,还驱动**文件/KB/项目等功能限额**。`subscription_service` **不能裸删**。

**方案**:新建 `entitlements.py`,提供与现 `tier_info` 兼容的返回形状,但对纯预付费模型返回**统一限额**:

```python
@dataclass(frozen=True)
class Entitlements:
    tier_name: str            # 恒为 "standard"(或按"是否充过值"分 free/standard)
    project_limit: int
    file_size_limit_mb: int
    kb_limit: int
    # ... 现有 tier_info 用到的字段一一对齐

async def get_account_entitlements(account_id) -> Entitlements: ...
# 兼容 shim:get_user_subscription_tier(account_id) → 返回上面映射出的 tier_info dict
```

- **计费门控(D4)**:移除 —— `get_allowed_models_for_user` 改为"所有启用模型,仅按 `provider_policy` 过滤";`is_unlimited_tier` 删除。
- **功能限额**:统一为一组 config 常量(全员同额),或按 free / paid(是否有 lifetime 充值)二档。
- 6 个调用点改为调用 `entitlements`(返回形状兼容,逻辑几乎不动)。
- ✅ **已确认**:统一限额**全员同额 `"standard"`**(无 free/paid 二档)。数值见 Plan 2 Task 4(`AGENT_LIMITS["standard"]`、文件 1GB/50MB)。

---

## 10. 汇率 `fx.py` + 充值目录 `catalog.py` + 钱包 `credit_manager.py`

### 10.1 FX(落地 aip #6,zmind 现完全缺失)
- USD/CNY 汇率**管理员可改**:单行 `payment_settings.usd_cny_rate`(默认 **7**),管理员经 `PUT /admin/billing/fx-rate` 改;`settings.get_usd_cny_rate` 缓存读取(回退 `config.USD_CNY_RATE_STATIC=7`)作为 `resolve_usd_cny_rate(live=...)` 注入;`fx_rate_provider` 为 async(Plan 1 Task 11b)。
- CNY 入账:`credit_usd = round(pay_cny / fx_rate, 4)`,`fx_rate` **快照到 order**,历史永不重定价。
- **Stripe lockstep**:Stripe/USD 订单**跳过** CNY 金额校验;只对 Alipay/CNY 做 ±0.01 容差。

### 10.2 充值目录(落地 aip #7,收编现 `monthly_credits*0.6` + 2次/月散逻辑)
- 版本化:`ALIPAY_TOPUP_TIERS`(CNY 档)+ `STRIPE_TOPUP_TIERS`(USD 档)+ 受限自定义额度区间。
- 建单时服务端校验金额属于目录(±0.01),`price_snapshot + catalog_version` 钉到 order。
- 充值→**non_expiring** 信用;赠送/promo/welcome→**expiring**(带 expiry)。

### 10.3 钱包瘦身 `credit_manager.py`
- **删** `add_credits` 的 20s 窗口兜底(58-74)+ 余额自愈(87-116)→ 统一走 `add_credits_idempotent` + `billing_dedup_key`。
- **删** `use_credits` 的 `is_unlimited_tier` 旁路(193)、tier/subscription_id 读取、余额自愈(206-216)。
- **删** `reset_expiring_credits`(月度续费,无订阅后无用)。
- 保留双桶(expiring=promo/welcome;non_expiring=充值);append-only ledger + `balance_after` 为真源。
- `use_credits` 继续经 `RecordUsageUseCase`(保留 DDD/outbox,D8)。
- ♻️ `core/credits.py`(CreditService,第二套信用引擎)→ 把缓存读 + welcome bonus 并入 `credit_manager`,然后弃用。

---

## 11. 预运行闸门 + 扣费热路径

- `billing_integration.check_model_and_billing_access` 从 4 件事**塌缩**为:
  - 删 `get_user_subscription_tier`、`get_allowed_models_for_user` 的 tier 门控。
  - 删 unlimited 旁路。
  - 保留 `provider_policy` 检查(D9,从 subscription_service 解耦)。
  - 保留余额 ≥ `MINIMUM_CREDIT_FOR_RUN` 检查;**统一阈值**(现 `check_billing_status` 要 >0、`check_status` 要 ≥0.01 不一致)。
- `billing_guard.deduct_once`(热路径)基本不动:继续 `deduct_credits_idempotent` RPC;`calculate_token_cost` 改从新 `pricing.py` 导入(不再依赖 `api.py`)。

---

## 12. 前端改造

> 现状:**双 API 客户端** `lib/api.ts`(旧 raw-fetch,9 函数)vs `lib/api/billing-v2.ts`(主,15 函数);页面 `/subscription` `/team/[slug]/subscription` `/admin/billing`;组件 `components/billing/*`;套餐来自静态 `siteConfig.cloudPricingItems`。

- **统一到 `billing-v2` + react-query**,删 `lib/api.ts` 的 9 个旧计费函数;`pricing-section.tsx`、`billing-modal.tsx` 改走 v2。
- **结账 UI**:订阅式定价页 → **充值页**(选档/自定义额度);按地区默认网关(D2),展示 Stripe Checkout 跳转 / Alipay 二维码或跳转。
- **支付确认**:从轮询 `/billing/subscription` 改为轮询**订单状态** `GET /billing/orders/{id}`(或 `/balance` 比对),复用 `PaymentPendingDialog`。
- 统一 transactions 三路径与 ×100 积分换算到共享 util;tier-id 魔法字符串随档位移除。
- 删订阅管理 UI(取消/续订/portal);保留 `credit-balance-card`、`credit-purchase`(改为充值)、`credit-transactions`、`daily-login-claim`、`usage-limit-alert`。

---

## 13. 删除 / 保留清单

**删除**(标注信心与前置):
| 文件/对象 | 依据 |
|---|---|
| `core/services/billing.py` | [已验证零导入、未挂载] 死代码 |
| `core/billing/creem_provider.py` / `creem_webhook_service.py` / `creem_subscription_service.py` | Creem 退场(D7) |
| `core/billing/webhook_service.py` + `utils/scripts/sync_stripe_subscriptions*.py` | Stripe 订阅 webhook(无 live 路由),无订阅后无用 |
| `core/billing/subscription_service.py` | **替换为 `entitlements.py`**(非裸删,§9);删订阅机制,保留限额 shim |
| `core/billing/providers/{base,stripe_provider,creem_provider,__init__}.py` | 由 `payments/` 取代 |
| `core/billing/migrate_existing_commitments_stripe.py` | Stripe commitment 迁移,过时 |
| `config.py` 的 `TIERS`/订阅价/commitment/trial 辅助 | 无订阅 |
| 旧 v1 表 `credit_balance` / `credit_usage` | [仅 dead services/billing.py 读] dormant |

**迁移后弃用**:
| `credit_purchases` 表 | **live**(payment_service/creem_webhook/api/users_admin 读)→ 先把充值跟踪迁到 `payment_orders`、刷新限额计数与 admin 视图,再弃用 |
| `core/credits.py`(CreditService) | 并入 `credit_manager` 后弃用 |

**保留**(核验后修正):
- DDD slice `domains/application/infrastructure/billing` + `domain_outbox` + `run_outbox_relay.py`(D8,活基础设施)。
- `provider_policy_service` + `ai_models/provider_policy.py`(D9,正交功能)。
- `credit_accounts` / `credit_ledger` / `add_credits_idempotent` / `deduct_credits_idempotent` / `credit_manager`(瘦身) / `admin.py` / `billing_guard` / `event_persister`。

**前置须确认**:线上 `credit_accounts` 中 `provider='creem'` 的活跃记录数(D7);`subscription_service` 全部调用点已切到 `entitlements`(§9 列出 6+ 处)。

---

## 14. DB 迁移

1. `create table payment_orders (...)`(§8 列)+ 索引(account_id, status, gateway_payment_id, created_at)+ RLS(`has_role_on_account(account_id)` 读;service_role 写)。
2. `credit_accounts` 去订阅列:`tier` / `provider_subscription_id` / `stripe_subscription_id` / `billing_provider` / `current_period_*`(先停读、后 drop,分两步)。
3. (可选)给 `credit_ledger` 加 `source_currency` / `fx_rate_usd_cny`(审计;或仅存 order 上,ledger 经 `reference_id` 关联 order)。
4. 充值跟踪迁移:从 `credit_purchases` → `payment_orders` 的回填脚本(若有历史)。
5. 删 v1 表 `credit_balance` / `credit_usage`(独立迁移,确认无读者后)。
6. 🔶 **RLS 修复**(顺带):团队计费下信用表 SELECT 现用 `auth.uid()=account_id`(团队成员读不到)→ 改 `basejump.has_role_on_account(account_id)`。

---

## 15. 测试策略(aip 式近 1:1,`uv run pytest`)

1. **resolver 契约测试**:按 id resolve、未配置抛错、能力门控注册。
2. **每网关归一化测试**(SDK fake 在窄 Protocol 后):checkout 形状、验签/重抛、**每个状态串** → `PaymentNotification`(paid/failed/cancelled);Stripe `is_signature_error` 回归守卫(只签名错=永久)。
3. **幂等/并发结算**:重复通知只发一次信用;并发结算不双发;`balance=expiring+non_expiring` 不变量成立。
4. **sweeper 测试**:只补未入账、跳过已入账、单单抛错继续、列单失败不抛。
5. **FX/money**:CNY→credits 定率换算、fx 快照持久化、Stripe/USD 跳过 CNY 校验。
6. **catalog**:client 金额校验(±0.01)、价格快照、自定义额度边界。
7. **entitlements**:统一限额返回、6 个调用点回归。
8. 内存仓 + 真 DB parity(`-pg` 后缀,无 `DATABASE_URL` 时跳过)。

---

## 16. 迁移与构建顺序(分阶段,先建新后删旧,可回滚)

- **P0 契约与脚手架**:`contract.py` + `resolver.py` + `routing.py` + `pricing.py`(抽出 calculate_token_cost)+ 契约/resolver 测试。**不接线**。
- **P1 网关 + FX + 目录**:`gateways/alipay.py`、`gateways/stripe.py`、`fx.py`、`catalog.py` + 各自测试(SDK fake)。
- **P2 订单与结算**:`payment_orders` 迁移 + `orders.py`(建单/幂等结算)+ webhook/notify 路由(raw body、失败策略)+ `sweeper.py`(Dramatiq)+ 幂等/并发测试。
- **P3 钱包与闸门瘦身**:`credit_manager` 瘦身、`entitlements.py` + 6 调用点切换、`billing_integration` 闸门塌缩、`credits.py` 并入。
- **P4 前端**:充值页 + v2 客户端统一 + 订单轮询 + 删订阅 UI。
- **P5 切换与清理**:feature flag 切到新网关 → 验证 → **一次性删** Creem/死 Stripe/subscription_service/providers/services.billing + DB 去订阅列 + v1 表。
- **P6 回归**:全量 `uv run pytest` + 关键路径手测(扫码支付到账、Stripe Checkout 到账、丢 webhook 经 sweeper 自愈、余额不足拦截)。

---

## 17. 风险与待办

- ✅ **统一限额**:已确认全员 `"standard"`(§9)。
- ✅ **汇率**:管理员可改、默认 7(`payment_settings` + `PUT /admin/billing/fx-rate`,Plan 1 Task 11b);无需接实时汇率 API。
- ✅ **Alipay 依赖**:`alipay-sdk-python` 已批准(Plan 1 Task 0)。
- ✅ **Creem 退场**:已确认直接 big-bang 退场(Plan 4),仅保留只读安全网核验。
- 🔶 **Alipay 密钥模式**(公钥 vs 证书)、沙箱/生产 gateway URL —— 实现时定。
- 🔶 **Alipay 资质**:`notify_url` 需公网可达 + 备案;当面付/电脑网站支付产品需开通。
- 退款(D5):后续若需原路退款,在 `PaymentGateway` 加可选 `refund()` 能力,不影响现有契约。
```
