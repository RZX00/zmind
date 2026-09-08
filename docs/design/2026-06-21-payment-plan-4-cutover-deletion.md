# 支付收敛 Plan 4:切换与删除 (P5–P6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Plan 1(新支付层 `payments/*` + `payment_orders`)、Plan 2(钱包瘦身 + `entitlements.py` 顶替 `subscription_service`,6 调用点已切走)、Plan 3(前端充值页 + 订单轮询,已停用订阅端点调用)全部落地之后,执行最后的「切换 → 删除 → 去 DB 残留 → 回归」:把后端默认网关从 Creem 切到新支付层(feature flag),灰度验证后**一次性删除** Creem 全栈 / 死 Stripe 订阅栈 / `subscription_service` / `providers/*` / 死代码 `core/services/billing.py` / 过时迁移脚本 / 被 `payment_orders` 取代的 `payment_service.py`,清理 `core/billing/__init__.py` 与 `api.py` 的 import 与订阅路由,再用 DB 迁移把 `credit_accounts` 去订阅列(保留 `tier`)、把充值跟踪从 `credit_purchases` 迁到 `payment_orders`、删 v1 表 `credit_balance`/`credit_usage`,并同步改写 `add_credits_idempotent` RPC 去掉 `tier` 写入,最后全量回归。

**Architecture:** 严格「先停读、后删码、再删 DB」三相安全顺序(对齐 §16 P5–P6 与删除影响面侦察报告的 Phase A–D)。切换仅改一个配置默认值(`BILLING_PROVIDER_DEFAULT`)+ `_get_account_billing_provider` 短路,可秒级回滚。删除每个模块前先用 grep 证明「外部引用已清零」(期望空输出),再删文件 + 清 import。DB 改动分两段:Plan 2/4 已把代码对订阅列的读全部切走,本计划只 `DROP COLUMN`;`tier` 列因仍驱动 entitlements 兼容层(返回 `name="standard"`)与 admin 视图,**不删**。所有删除走 git rm + 测试回归,无占位、无 TODO。

**Tech Stack:** Python 3.11 / FastAPI / Supabase(Postgres)/ `pytest`(`cd backend && uv run pytest`,`asyncio_mode=auto`,`testpaths=tests`)/ 前端 bun(仅 `type-check`/`lint`)。本计划**无新增第三方依赖**;反向移除 Creem 相关代码(env 变量保留、仅标注弃用)。

## Global Constraints

- 语言/工具:Python 用 `uv`;测试 `cd backend && uv run pytest <path> -v`;前端用 **bun**(`cd frontend && bun run type-check` / `bun run lint`),禁用 npm。严格类型注解,公共契约返回用 frozen dataclass,不用裸 `Dict[str, Any]`。
- 🚨 项目级限制:**绝不** `npm run dev/build/start`、`python api.py`、`docker-compose up` 等启动/构建命令;只跑测试/lint/grep/文件操作,执行前征得用户同意。
- 删除安全顺序(不可逆,严格按相位):**Phase A 切换 + 灰度** → **Phase B 清 importer/路由(断引用)** → **Phase C 删模块(引用已零)** → **Phase D drop 列/表** → **Phase E 回归**。每删一个模块前**必须**先跑「确认无引用」grep 并得到**空输出**;非空则停下先处理引用方。
- **绝不能删**(核验所得,删了全站崩):`credit_accounts.tier` 列、`provider_policy_service` + `provider-policy` 路由(`api.py:1297+`)、`billing_integration`、config tier 体系(`Tier/TIERS/get_tier_by_*/is_model_allowed`)、`credit_manager`/`credit_ledger`/`add_credits_idempotent`/`deduct_credits_idempotent`、DDD slice + `domain_outbox`。
- 前置依赖(本计划假定已完成,Step 0 会校验):Plan 2 已使 `subscription_service` 在 `core/`/`knowledge_base/`/`api.py` 中**仅剩 `billing_integration` 之外的内部 import**(实际 Plan 2 后唯一外部读者是 `api.py` 的订阅/Creem 路由 —— 本计划 Phase B 删它们);Plan 2 已把 `credit_service.get_balance`/`ensure_welcome_bonus` 切到 `credit_manager`,仅 `get_account_summary` 留待本计划。
- D7 前置(线上数据):**用户已确认 Creem 直接退场**(big-bang,无双轨)。删 Creem 前仍跑 Task 1 Step 0 的只读确认 SQL 作安全网;若意外发现活跃 `billing_provider='creem'` 付费数据 / `credit_purchases` 待回填,先跑回填再继续。
- 提交粒度:每个 Task 末尾一次 commit;信息以 `feat(payments):` / `refactor(payments):` / `chore(payments):` / `test(payments):` 开头。

## 4-Plan 拆解(本文件为 Plan 4)

- Plan 1(P0–P2):后端支付基础层(契约→网关→订单/结算→路由/sweeper)。**前置**。
- Plan 2(P3):钱包瘦身 + `entitlements.py` shim + 6 调用点切换 + 闸门塌缩 + `credits.py` 部分并入。**前置**。
- Plan 3(P4):前端充值改造 + v2 客户端统一 + 订单轮询 + 删订阅 UI。**前置**。
- **Plan 4(本文件,P5–P6)**:feature flag 切换 → 一次性删 Creem/死 Stripe/`subscription_service`/`providers`/死代码 → DB 去订阅列 + 弃 `credit_purchases` + 删 v1 表 → 全量回归。

执行前请用 `superpowers:using-git-worktrees` 在 Plan 1–3 分支上继续。开 Edit 前先 `git fetch && git log origin/main --oneline -10` 确认本计划改动未被别的会话先做完;发现重复立即告诉用户,不要闷头覆盖。

---

## Task 0: 前置校验(确认 Plan 1–3 已落地,不改任何东西)

**Files:**
- Test: 无(纯 grep/import 冒烟校验)

**Interfaces:**
- Consumes:`payments/*`、`entitlements.py`、新路由。

- [ ] **Step 1: 确认新支付层与新路由存在**

Run: `cd backend && ls core/billing/payments/ && grep -n '@router.post("/orders/checkout")\|@router.post("/webhook/stripe")\|@router.post("/notify/alipay")\|@router.get("/orders/{order_id}")' core/billing/api.py`
Expected: 列出 `bootstrap.py contract.py orders.py resolver.py routing.py sweeper.py ...` 且 4 条新路由都命中(Plan 1 Task 13 已加)。

- [ ] **Step 2: 确认 6 调用点已切到 entitlements(Plan 2 Task 5)**

Run: `cd backend && grep -rn "subscription_service\b" core/agent_runs.py core/files/api.py knowledge_base/api.py core/ai_models/manager.py core/core_utils.py core/billing/payment_service.py`
Expected: **无输出**(Plan 2 已切走)。若有输出,先回到 Plan 2 Task 5 完成切换再继续。

- [ ] **Step 3: 确认 `subscription_service` 的剩余外部读者只在 api.py 的待删订阅路由内**

Run: `cd backend && grep -rn "subscription_service\b" core/ knowledge_base/ api.py --include=*.py | grep -v "core/billing/subscription_service.py" | grep -v "core/billing/api.py"`
Expected: **无输出**(除 `api.py`(本计划 Phase B 删)与自身定义外,无人引用)。

> 注:`billing_integration.py` 在 Plan 2 Task 6 已重写为不再 import `subscription_service`,故这里不应再命中它。若仍命中 `billing_integration.py`,说明 Plan 2 Task 6 未完成,先补完。

- [ ] **Step 4: 确认 entitlements + credit_manager 新能力就绪**

Run: `cd backend && uv run python -c "from core.billing import entitlements; from core.billing.credit_manager import credit_manager; assert hasattr(credit_manager,'ensure_welcome_bonus') and hasattr(credit_manager,'get_cached_balance'); assert not hasattr(credit_manager,'reset_expiring_credits'); print('plan2-ok')"`
Expected: 打印 `plan2-ok`。

- [ ] **Step 5: 基线全量回归(记录当前绿/红基线)**

Run: `cd backend && uv run pytest tests/payments/ tests/test_billing_owner_rbac.py -v`
Expected: `tests/payments/` 全绿;`tests/test_billing_owner_rbac.py` 仍是旧 Creem 断言(本计划 Task 9 改)—— 记录当前结果作基线。若 `tests/payments/` 不全绿,先修 Plan 1–2 再继续。

> 本 Task 不 commit(纯校验)。任一 Step 不达期望即停下回到对应前置 Plan。

---

## Task 1: D7 数据前置确认 + Feature flag 切换(Creem → 新支付层)

> Phase A。本 Task 只改一个默认值 + 短路一个 helper,使「默认网关」从 Creem 变为新支付层。秒级可回滚(改回默认值即恢复)。**不删任何代码**。

**Files:**
- Modify: `backend/core/utils/config.py:339`(`BILLING_PROVIDER_DEFAULT` 默认值 + 标注弃用)
- Modify: `backend/core/billing/api.py:82-85`(`_get_account_billing_provider` 切为返回固定 `'payments'` 哨兵 / 灰度短路)
- Test: `backend/tests/payments/test_cutover_flag.py`

**Interfaces:**
- Produces:`config.BILLING_PROVIDER_DEFAULT` 默认 `"payments"`;`_get_account_billing_provider` 在切换后恒返回新支付标识(灰度可回退 `"creem"`)。

- [ ] **Step 0: D7 线上数据确认(只读,经用户同意后跑;无 DB 则人工确认)**

Run(经同意,指向生产只读副本):
```sql
SELECT count(*) FROM credit_accounts WHERE billing_provider = 'creem' AND provider_subscription_id IS NOT NULL;
SELECT count(*) FROM credit_purchases WHERE status = 'completed' AND created_at > now() - interval '90 days';
```
Expected: 第一条为 `0`(无活跃 Creem 订阅);第二条若 > 0,记录数量并在 Task 7(`credit_purchases` 弃用)前确认这些行已可由 `payment_orders` 或 ledger 表达。**若有活跃 Creem 订阅,停止本计划,先与产品确认迁移/退款策略**(D7 前置)。用户已确认直接退场,预期两条均满足「可一次性退场」;此 Step 为安全网核验。

- [ ] **Step 1: 写失败测试**

```python
# backend/tests/payments/test_cutover_flag.py
from __future__ import annotations
import pytest
from core.billing import api as billing_api


def test_default_billing_provider_is_payments():
    from core.utils.config import config
    assert config.BILLING_PROVIDER_DEFAULT == "payments"


async def test_get_account_billing_provider_returns_payments(monkeypatch):
    # 切换后:无论账户历史 provider 如何,默认走新支付层标识。
    got = await billing_api._get_account_billing_provider("acct-1")
    assert got == "payments"


async def test_get_account_billing_provider_respects_explicit_creem(monkeypatch):
    # 灰度回退:显式请求 creem 时仍可临时回退(回滚开关)。
    got = await billing_api._get_account_billing_provider("acct-1", requested_provider="creem")
    assert got == "creem"
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && uv run pytest tests/payments/test_cutover_flag.py -v`
Expected: 2 failed, 1 passed — `test_default_billing_provider_is_payments` FAIL(`assert "creem" == "payments"`,默认值未改);`test_get_account_billing_provider_returns_payments` FAIL(无 `requested_provider` 时旧实现返回 `"creem"`,断言期望 `"payments"`);`test_get_account_billing_provider_respects_explicit_creem` 已 PASS(旧实现对 `requested_provider="creem"` 本就返回 `"creem"`,符合回退语义,实现后仍 PASS)。

- [ ] **Step 3: 切默认值**

先 Read `backend/core/utils/config.py:339` 确认当前为 `BILLING_PROVIDER_DEFAULT: str = "creem"`。改为:

```python
    # [DEPRECATED] Creem 退场(D7);默认切到新支付层(Alipay/Stripe via payments/*)。
    # 灰度回滚:临时改回 "creem" 即恢复旧路径(旧代码删除前可回退;Task 2+ 删除后不可回退)。
    BILLING_PROVIDER_DEFAULT: str = "payments"
```

- [ ] **Step 4: 短路 `_get_account_billing_provider`**

先 Read `backend/core/billing/api.py:82-85` 确认当前实现(它原本按账户 `billing_provider` 列 / 请求参数解析出 `'creem'`)。整体替换为:

```python
async def _get_account_billing_provider(account_id: str, requested_provider: Optional[str] = None) -> str:
    # 切换后默认走新支付层;仅当显式请求 "creem" 时回退(灰度回滚开关,Task 2 删 Creem 后此分支变 dead,随调用方一并清理)。
    if requested_provider:
        return requested_provider
    return config.BILLING_PROVIDER_DEFAULT
```

> 该 helper 当前被 `/purchase-credits`/`/subscription`/`create-checkout-session` 等订阅路由调用(`api.py:499,746,843,868,889,908,930`);这些路由将在 Task 5 整段删除,届时该 helper 也随之删除(Task 5 Step 末)。本 Task 仅让它在删除前不再触达 Creem 解析逻辑。

- [ ] **Step 5: 运行确认通过 + import 冒烟**

Run: `cd backend && uv run pytest tests/payments/test_cutover_flag.py -v && uv run python -c "import core.billing.api; print('ok')"`
Expected: PASS(3 passed)+ 打印 `ok`。

- [ ] **Step 6: Commit**

```bash
git add backend/core/utils/config.py backend/core/billing/api.py backend/tests/payments/test_cutover_flag.py
git commit -m "feat(payments): cut over default billing provider to new payments layer (creem deprecated, rollback flag kept)"
```

> 🔶 **灰度/回滚说明**:本 Task 后线上「默认网关」即为新支付层。回滚 = 把 `BILLING_PROVIDER_DEFAULT` 改回 `"creem"`(在 Task 2 删除 Creem 代码之前有效)。建议灰度窗口:切换后观察 1–2 天 `payment_orders` 入账成功率 + `credit_ledger` 的 `purchase` 行 + Stripe/Alipay 回调 5xx 率,确认无异常再进入 Task 2(删代码,过此点不可回退)。

---

## Task 2: 删 Creem 全栈(creem_subscription_service / creem_webhook_service / providers/creem_provider)

> Phase C 起点。前置:Task 5 会删 api.py 里对 Creem 的 import/路由——但删模块需 import 先清零。**调整执行次序**:本 Task 先做「确认引用、删 api.py 的 Creem import + 4 条 Creem/订阅路由(`/purchase-credits`/`/webhook/creem` 这两条 Creem 专属)」,再删 Creem 模块文件。其余订阅路由(create-checkout-session 等)在 Task 5 处理。

**Files:**
- Modify: `backend/core/billing/api.py:25-26`(删 Creem service import)+ `:493-518`(删 `/purchase-credits`)+ `:520-522`(删 `/webhook/creem`)
- Delete: `backend/core/billing/creem_subscription_service.py`、`backend/core/billing/creem_webhook_service.py`、`backend/core/billing/providers/creem_provider.py`
- Test: 复用 grep 确认 + import 冒烟

**Interfaces:**
- 移除:`creem_subscription_service`、`creem_webhook_service`、`CreemProvider`、路由 `/purchase-credits`、`/webhook/creem`。

- [ ] **Step 1: 确认 Creem service 的外部引用面**

Run: `cd backend && grep -rn "creem_subscription_service\|creem_webhook_service\|CreemProvider\|creem_provider" core/ --include=*.py | grep -vE "core/billing/creem_subscription_service.py|core/billing/creem_webhook_service.py|core/billing/providers/creem_provider.py"`
Expected: 命中点应**仅在** `core/billing/api.py`(import `:25,:26` + `/subscription`/`create-checkout-session`/cancel/reactivate 等路由用 `creem_subscription_service`,`/webhook/creem` 用 `creem_webhook_service`)与 `core/billing/payment_service.py`(`providers` 间接,Task 3 处理)。记下这些行,确认无其他文件依赖。

- [ ] **Step 2: 删 api.py 的 Creem 专属路由 `/purchase-credits` 与 `/webhook/creem`**

先 Read `backend/core/billing/api.py:493-522` 确认两段。`/purchase-credits`(`:493-518`,调用 `payment_service.create_credit_purchase_checkout`)整段删除;`/webhook/creem`(`:520-522`,调用 `creem_webhook_service.process_creem_webhook`)整段删除。

> 充值入口已由 Plan 1 `POST /billing/orders/checkout` + Plan 3 前端 `TopupSection` 接管;Creem webhook 入口已无前端/网关投递(切换后 Creem 不再被使用)。

- [ ] **Step 3: 删 api.py 顶层 Creem service import**

Read `backend/core/billing/api.py:25-26`,删除这两行:
```python
from .creem_subscription_service import creem_subscription_service
from .creem_webhook_service import creem_webhook_service
```

> 此时 `creem_subscription_service` 仍被 `/subscription`/`create-checkout-session`/cancel/reactivate(Task 5 删)引用 —— 故本 Step 暂**不能**删 import,否则 Task 5 之前 api.py 报 NameError。**调整**:本 Step 仅删 `creem_webhook_service` 那一行(`:26`,其唯一用法 `/webhook/creem` 已在 Step 2 删除);`creem_subscription_service`(`:25`)的删除挪到 Task 5(随订阅路由一并删)。

修正后本 Step 只删:
```python
from .creem_webhook_service import creem_webhook_service
```

- [ ] **Step 4: 确认 `creem_webhook_service` 已零引用并删除**

Run: `cd backend && grep -rn "creem_webhook_service\|CreemProvider" core/ --include=*.py | grep -vE "core/billing/creem_webhook_service.py|core/billing/providers/creem_provider.py|core/billing/creem_subscription_service.py"`
Expected: **无输出**(`creem_webhook_service` 已无人引用;`CreemProvider` 仍被 `creem_subscription_service.py` 自身 import —— 该文件 Task 5 删)。

Run: `cd backend && git rm core/billing/creem_webhook_service.py`
Expected: 删除该文件。

> `creem_subscription_service.py` 与 `providers/creem_provider.py` 延后到 Task 5(订阅路由删完后 `creem_subscription_service` 才零引用;`creem_provider` 在 `providers/` 整体删除时一并删,见 Task 4)。本 Task 仅完成 `creem_webhook_service` 的删除 + 两条 Creem 专属路由删除。

- [ ] **Step 5: import 冒烟 + 回归**

Run: `cd backend && uv run python -c "import core.billing.api; print('ok')" && uv run pytest tests/payments/ -v`
Expected: 打印 `ok`(无 ImportError;`creem_subscription_service` 仍 import 存在,合法)+ payments 全绿。

- [ ] **Step 6: Commit**

```bash
git add backend/core/billing/api.py backend/core/billing/creem_webhook_service.py
git commit -m "refactor(payments): drop /purchase-credits + /webhook/creem routes and creem_webhook_service"
```

---

## Task 3: 删 `payment_service.py`(被 payment_orders 取代)

> Phase C。`payment_service.create_credit_purchase_checkout` 的唯一调用方 `/purchase-credits` 已于 Task 2 删除;Plan 2 已把它默认拿 tier 的 shim 切到 entitlements。它还经 `providers.get_billing_provider("creem")` 建 Creem 客户端 + 写 `credit_purchases` —— 全部被新支付层取代。

**Files:**
- Modify: `backend/core/billing/api.py:24`(删 `from .payment_service import payment_service`)
- Modify: `backend/core/billing/__init__.py:19, 39`(删 `payment_service` 导出)
- Delete: `backend/core/billing/payment_service.py`
- Test: grep 确认 + import 冒烟

**Interfaces:**
- 移除:`payment_service`、包级导出 `payment_service`。

- [ ] **Step 1: 确认 `payment_service` 外部引用面**

Run: `cd backend && grep -rn "payment_service\b" core/ knowledge_base/ api.py --include=*.py | grep -v "core/billing/payment_service.py" | grep -v "provider_policy_service\|creem_subscription_service\|creem_webhook_service"`
Expected: 命中**仅** `core/billing/api.py:24`(import)与 `core/billing/__init__.py:19,39`(导出)。`/purchase-credits` 路由内的 `payment_service.create_credit_purchase_checkout`(原 `:506`)已随 Task 2 删除,故不应再命中路由体。

> 若仍命中 `tests/test_billing_owner_rbac.py:136`(`billing_api.payment_service.create_credit_purchase_checkout`),那是测试对已删路由的断言 —— Task 9 改写;此处忽略 tests 命中。

- [ ] **Step 2: 删 api.py import**

Read `backend/core/billing/api.py:24`,删除:
```python
from .payment_service import payment_service
```

- [ ] **Step 3: 删 __init__.py 导出**

Read `backend/core/billing/__init__.py:18-19, 38-39`。删除 `:19` 的 `from .payment_service import payment_service` 与 `__all__` 中 `:39` 的 `'payment_service'`。

> `:18`/`:38` 的 `subscription_service` 导出延后到 Task 6(删 `subscription_service.py` 时一并删)。本 Step 只动 `payment_service`。删 `:39` 后注意 `__all__` 列表语法(原 `:38,:39` 是最后两项,删 `:39` 后 `:38` 末尾的逗号需保持合法 —— Read 确认后处理尾逗号)。

- [ ] **Step 4: 确认零引用并删除文件**

Run: `cd backend && grep -rn "payment_service\b" core/ --include=*.py | grep -v "core/billing/payment_service.py" | grep -v "provider_policy_service\|creem_subscription_service\|creem_webhook_service"`
Expected: **无输出**。

Run: `cd backend && git rm core/billing/payment_service.py`
Expected: 删除文件。

- [ ] **Step 5: import 冒烟 + 回归**

Run: `cd backend && uv run python -c "import core.billing, core.billing.api; print('ok')" && uv run pytest tests/payments/ -v`
Expected: 打印 `ok` + payments 全绿。

- [ ] **Step 6: Commit**

```bash
git add backend/core/billing/api.py backend/core/billing/__init__.py backend/core/billing/payment_service.py
git commit -m "refactor(payments): drop payment_service (superseded by payment_orders/OrderService)"
```

---

## Task 4: 删 `providers/`(base / stripe_provider / creem_provider / __init__)

> Phase C。`get_billing_provider` 的唯一调用方 `payment_service` 已于 Task 3 删除;`creem_provider` 仅被 `creem_subscription_service`(Task 6 删)与 `creem_webhook_service`(已删)引用;`stripe_provider`/`base` 零外部引用(死代码,侦察报告已验证)。**次序**:本 Task 在 Task 6 之前会撞上 `creem_subscription_service.py` 仍 import `creem_provider` —— 故调整为先删 `base.py`/`stripe_provider.py`(已零引用)+ 改 `providers/__init__.py` 不再实例化 Creem;`creem_provider.py` 与整目录删除挪到 Task 6 之后。

**Files:**
- Delete: `backend/core/billing/providers/stripe_provider.py`、`backend/core/billing/providers/base.py`
- Modify: `backend/core/billing/providers/__init__.py`(删 `CreemProvider` import/实例化 + `get_billing_provider`,降为空/最小)
- Test: grep 确认 + import 冒烟

**Interfaces:**
- 移除:`StripeProvider`、`BillingProvider`(base)、`get_billing_provider`。

- [ ] **Step 1: 确认 `stripe_provider`/`base`/`get_billing_provider` 零外部引用**

Run: `cd backend && grep -rn "stripe_provider\|StripeProvider\|providers.base\|from .base import\|get_billing_provider\|BillingProvider\b" core/ --include=*.py | grep -vE "core/billing/providers/"`
Expected: **无输出**(`payment_service` 已删,`get_billing_provider` 无外部调用;`StripeProvider`/`BillingProvider` 无外部引用)。

- [ ] **Step 2: 删死文件 stripe_provider.py + base.py**

先确认 base 仅被 providers 内部引用:
Run: `cd backend && grep -rn "from .base import\|from .creem_provider import\|from .stripe_provider import" core/billing/providers/`
Expected: `__init__.py` import base/creem;`creem_provider.py`/`stripe_provider.py` 各自 import `from .base import BillingProvider`。

删 stripe_provider(零引用):`cd backend && git rm core/billing/providers/stripe_provider.py`

> `base.py` 仍被 `creem_provider.py`(Task 6 后删)引用,**本 Step 暂不删 base.py**;改到 Task 6 删 `creem_provider` 后,base 才零引用。本 Step 只删 `stripe_provider.py`。

- [ ] **Step 3: 改 `providers/__init__.py` 不再造 Creem**

先 Read `backend/core/billing/providers/__init__.py`(侦察:`:7 from .base import BillingProvider`、`:8 from .creem_provider import CreemProvider`、`:20` 实例化 + `get_billing_provider`)。整体替换为最小占位(保留模块存在,避免 import 链断裂;Task 6 后整目录删):

```python
# [DEPRECATED] 旧 BillingProvider 抽象已被 core/billing/payments/* 取代。
# get_billing_provider/CreemProvider/StripeProvider 已移除;本文件待整目录删除(Task 6 后)。
```

> 即清空 `__init__.py` 内的 import 与 `get_billing_provider` 定义。删除后 `from core.billing.providers import get_billing_provider` 必然报错 —— 已于 Task 3 删除其唯一调用方,故安全。

- [ ] **Step 4: import 冒烟**

Run: `cd backend && uv run python -c "import core.billing.api; print('ok')"`
Expected: 打印 `ok`(`creem_subscription_service` 仍 import `creem_provider`,合法;`api.py` 不再触达 `get_billing_provider`)。

- [ ] **Step 5: Commit**

```bash
git add backend/core/billing/providers/__init__.py backend/core/billing/providers/stripe_provider.py
git commit -m "refactor(payments): gut providers package (drop StripeProvider + get_billing_provider; creem_provider follows)"
```

---

## Task 5: 删订阅路由 + `creem_subscription_service` + helper(api.py 收敛)

> Phase B+C。删 5 条订阅路由(`/subscription`/`create-checkout-session`/`create-portal-session`/`sync-subscription`/`cancel-subscription`/`reactivate-subscription`)、改写 `/check`/`/check-status`/`/claim-daily-login`/`/available-models` 走新 resolver、删 `_get_account_billing_provider`、删 `creem_subscription_service` import + 文件。

**Files:**
- Modify: `backend/core/billing/api.py:23`(删顶层 `from .subscription_service import subscription_service` import)、`:25`(删 `creem_subscription_service` import)、`:82-85`(删 `_get_account_billing_provider`)、`:741-835`(删 `/subscription`)、`:837-941`(删 5 条订阅路由)、`:233-257`(`/check` 去 lazy `subscription_service`)、`:259-312`(`/check-status`)、`:313-374`(`/claim-daily-login`,**用顶层 `subscription_service`**,非 lazy)、`:1250-1265`(`/available-models` 去 `subscription_service`)
- Delete: `backend/core/billing/creem_subscription_service.py`、`backend/core/billing/providers/creem_provider.py`、`backend/core/billing/providers/base.py`
- Test: `backend/tests/payments/test_billing_routes_collapsed.py`

**Interfaces:**
- 移除路由:`/subscription`、`/create-checkout-session`、`/create-portal-session`、`/sync-subscription`、`/cancel-subscription`、`/reactivate-subscription`。
- 保留路由(改写内部 tier 解析源):`/check`、`/check-status`、`/claim-daily-login`、`/available-models`。
- Produces:`/available-models` 改用 `entitlements.get_user_subscription_tier` + `model_manager.list_available_models`,不再 string-match Creem。

- [ ] **Step 1: 写失败测试**(确认订阅路由消失 + 保留路由仍工作)

```python
# backend/tests/payments/test_billing_routes_collapsed.py
from __future__ import annotations
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from core.billing import api as billing_api


def _client():
    app = FastAPI()
    app.include_router(billing_api.router)
    return TestClient(app)


def test_subscription_routes_removed():
    routes = {r.path for r in billing_api.router.routes}
    for gone in ("/subscription", "/create-checkout-session", "/create-portal-session",
                 "/sync-subscription", "/cancel-subscription", "/reactivate-subscription",
                 "/purchase-credits", "/webhook/creem"):
        assert gone not in routes, f"{gone} must be removed"


def test_provider_policy_route_kept():
    routes = {r.path for r in billing_api.router.routes}
    assert "/provider-policy" in routes
    assert "/orders/checkout" in routes  # 新支付路由仍在


def test_helper_removed():
    assert not hasattr(billing_api, "_get_account_billing_provider")


def test_no_subscription_service_import():
    import core.billing.api as m
    src = __import__("inspect").getsource(m)
    assert "subscription_service" not in src, "api.py must not reference subscription_service"
    assert "creem_subscription_service" not in src
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && uv run pytest tests/payments/test_billing_routes_collapsed.py -v`
Expected: FAIL — `/subscription` 等仍在 routes;`_get_account_billing_provider` 仍存在;`subscription_service` 仍在源码。

- [ ] **Step 3: 删 5 条订阅路由 + `/subscription`**

先 Read `backend/core/billing/api.py:741-941` 确认边界。整段删除:
- `/subscription` `:741-835`
- `/create-checkout-session` `:837-860`
- `/create-portal-session` `:862-882`
- `/sync-subscription` `:884-900`
- `/cancel-subscription` `:902-923`
- `/reactivate-subscription` `:925-941`

> `/subscription`(订阅状态查询)前端已于 Plan 3 停用(改轮询 `/billing/orders/{id}`);其余四条是订阅管理(取消/续订/portal/同步),纯预付费下无意义(D1)。删除后 `/transactions`(`:943`)成为该段后的第一个路由。

- [ ] **Step 4: 删 `_get_account_billing_provider` helper**

Read `backend/core/billing/api.py:82-85`(Task 1 已改写为短路版),整个函数删除。其调用方均在 Step 3 删除的路由内(`:499` 已随 Task 2 `/purchase-credits` 删;`:746,843,868,889,908,930` 随 Step 3 删),故现已零调用。

Run: `cd backend && grep -n "_get_account_billing_provider" core/billing/api.py`
Expected: **无输出**(删干净)。

- [ ] **Step 5: `/check` / `/check-status` / `/claim-daily-login` 去 lazy `subscription_service`**

Read `backend/core/billing/api.py:233-374` 三条路由,定位 lazy import 与 tier 用法(已核实真实行号):
- `/check` `:240` lazy `from .subscription_service import subscription_service` + `:242` 用 `get_user_subscription_tier`
- `/check-status` `:276` lazy import + `:279` 用 tier
- `/claim-daily-login` `:328` 直接用**顶层** `subscription_service.get_user_subscription_tier`(此处**无** lazy import,用的是 `:23` 顶层 import)

`/check` 与 `/check-status`:把 lazy `from .subscription_service import subscription_service` 改为 `from . import entitlements`,把 `subscription_service.get_user_subscription_tier(...)` 改为 `entitlements.get_user_subscription_tier(...)`。
`/claim-daily-login`(`:328`):无 lazy import,直接把 `subscription_service.get_user_subscription_tier(account_id)` 改为 `entitlements.get_user_subscription_tier(account_id)`,并在该路由函数内加 lazy `from . import entitlements`(或依赖 Step 7 删顶层 import 后改走模块级 `entitlements`)。三处签名兼容(Plan 2 已保证返回形状),tier 解析走统一 `"standard"` 档,逻辑不变。

> 若某条路由还读 `tier['credits']`/`tier['models']` 等字段:`entitlements.get_user_subscription_tier` 已提供 `credits=0.0`/`models=None`,Read 确认调用方不依赖具体值即可(Plan 2 §设计依据已核验)。

- [ ] **Step 6: `/available-models` 去 `subscription_service`**

Read `backend/core/billing/api.py:1250-1267`(实读:`:1250` 读 `credit_accounts.tier`(保留)、`:1256` lazy import + `:1257` `get_user_subscription_tier`、`:1259` `list_available_models`、`:1260` `logger.debug(f"Found {len(all_models)} total models available")`(**必须保留,勿误删**)、`:1262` `get_allowed_models_for_user`、`:1263` `allowed_model_ids = set(allowed_models)`、`:1267` provider_policy 保留)。

精确 Edit ①(`:1256-1257`):
```python
        from .subscription_service import subscription_service
        tier = await subscription_service.get_user_subscription_tier(account_id)
```
→
```python
        from . import entitlements
        tier = await entitlements.get_user_subscription_tier(account_id)
```

精确 Edit ②(`:1262`,保持上方 `:1259-1260` 的 `list_available_models` + `logger.debug(... total models available)` 原样不动):
```python
        allowed_models = await subscription_service.get_allowed_models_for_user(account_id, client)
```
→
```python
        # D4:去 tier 模型门控,allowed = 全部启用模型(provider-policy 过滤在下方 :1267+ 保留)。
        allowed_models = [m["id"] for m in all_models if m.get("id")]
```

> `:1263` 的 `allowed_model_ids = set(allowed_models)` 不变(`allowed_models` 现为 list[str],`set(...)` 仍合法)。`:1250` 的 `client.from_('credit_accounts').select('tier')` 与 `:1265` 的 `logger.debug(f"User tier: {tier['name']}")` 保持不变(`tier['name']` 现为 `"standard"`;tier 列保留)。`:1267` 起的 `provider_policy_service.get_policy_bundle` 完全保留。

- [ ] **Step 7: 删顶层 `subscription_service` + `creem_subscription_service` import**

Read `backend/core/billing/api.py:23` 与 `:25`,删除这两行:
```python
from .subscription_service import subscription_service
from .creem_subscription_service import creem_subscription_service
```

> ⚠️ `:23` 顶层 `subscription_service` import 必须删:它原被 `/claim-daily-login`(`:328`)与 `/subscription`(`:748` `has_purchase_qualification`)使用——前者已于 Step 5 切到 `entitlements`,后者已于 Step 3 随 `/subscription` 删除,故此时 `:23` 已零用法。若漏删,下方 grep 仍会命中 `:23`。

Run: `cd backend && grep -n "subscription_service" core/billing/api.py`
Expected: **无输出**(`subscription_service` 与 `creem_subscription_service` 在 api.py 全部清除)。

- [ ] **Step 8: 删 `creem_subscription_service.py` + `providers/creem_provider.py` + `providers/base.py`**

Run: `cd backend && grep -rn "creem_subscription_service\|CreemProvider\|creem_provider" core/ --include=*.py | grep -vE "core/billing/creem_subscription_service.py|core/billing/providers/creem_provider.py"`
Expected: **无输出**(api.py 已删 import;`creem_provider` 仅被自身 + 待删的 `creem_subscription_service` 引用)。

Run:
```bash
cd backend && git rm core/billing/creem_subscription_service.py core/billing/providers/creem_provider.py
```

再确认 `base.py` 现已零引用并删:
Run: `cd backend && grep -rn "from .base import\|providers.base\|BillingProvider\b" core/ --include=*.py | grep -v "core/billing/providers/base.py"`
Expected: **无输出**。
Run: `cd backend && git rm core/billing/providers/base.py`

- [ ] **Step 9: 运行确认通过 + import 冒烟**

Run: `cd backend && uv run python -c "import core.billing.api; print('ok')" && uv run pytest tests/payments/test_billing_routes_collapsed.py tests/payments/ -v`
Expected: 打印 `ok` + 全绿(`test_billing_routes_collapsed` 4 passed)。

- [ ] **Step 10: Commit**

```bash
git add backend/core/billing/api.py backend/core/billing/creem_subscription_service.py backend/core/billing/providers/creem_provider.py backend/core/billing/providers/base.py backend/tests/payments/test_billing_routes_collapsed.py
git commit -m "refactor(payments): remove subscription routes + creem_subscription_service + providers base/creem; available-models off subscription_service"
```

---

## Task 6: 删 `subscription_service.py` + 清 __init__ 导出 + 删空 providers 包

> Phase C 收尾。Plan 2 已切走 6 调用点;Task 5 已清 api.py。此时 `subscription_service` 应零外部引用。

**Files:**
- Modify: `backend/core/billing/__init__.py:18, 38`(删 `subscription_service` 导出)
- Delete: `backend/core/billing/subscription_service.py`、`backend/core/billing/providers/__init__.py`(整目录)
- Test: grep 确认 + import 冒烟

**Interfaces:**
- 移除:`subscription_service`、包级导出 `subscription_service`、`core.billing.providers` 包。

- [ ] **Step 1: 确认 `subscription_service` 全局零引用**

Run: `cd backend && grep -rn "subscription_service\b" core/ knowledge_base/ api.py --include=*.py | grep -v "core/billing/subscription_service.py"`
Expected: 命中**仅** `core/billing/__init__.py:18,38`(导出)。无其他文件。

> `provider_policy_service` 含子串 `_service` 但不含 `subscription_service`,不会误命中。

- [ ] **Step 2: 删 __init__.py 的 `subscription_service` 导出**

Read `backend/core/billing/__init__.py:18, 38`。删 `:18` 的 `from .subscription_service import subscription_service`,删 `__all__` 中 `:38` 的 `'subscription_service'`(注意尾逗号:Task 3 已删 `'payment_service'`,此时 `__all__` 末尾结构需 Read 后保持合法)。

- [ ] **Step 3: 删文件 + 删空 providers 包**

Run:
```bash
cd backend && git rm core/billing/subscription_service.py core/billing/providers/__init__.py
```
(若 `providers/` 删除后目录变空,git 自动忽略空目录;`__pycache__` 非追踪文件无需处理。)

确认 providers 包整体无残留引用:
Run: `cd backend && grep -rn "core.billing.providers\|from .providers\|from core.billing import providers" core/ --include=*.py`
Expected: **无输出**。

- [ ] **Step 4: import 冒烟 + 回归**

Run: `cd backend && uv run python -c "import core.billing, core.billing.api; from core.billing import entitlements, credit_manager; print('ok')" && uv run pytest tests/payments/ -v`
Expected: 打印 `ok` + payments 全绿。

- [ ] **Step 5: Commit**

```bash
git add backend/core/billing/__init__.py backend/core/billing/subscription_service.py backend/core/billing/providers/__init__.py
git commit -m "refactor(payments): delete subscription_service + providers package (zero callers post-plan2)"
```

---

## Task 7: 删死/旧文件(services/billing.py / webhook_service.py / 脚本 / migrate_*)

> Phase C。一次性清侦察报告确认的零导入死代码 + 过时脚本。每个文件删前给确认 grep。

**Files:**
- Delete: `backend/core/services/billing.py`、`backend/core/billing/webhook_service.py`、`backend/core/billing/migrate_existing_commitments_stripe.py`、`backend/core/utils/scripts/sync_stripe_subscriptions.py`、`backend/core/utils/scripts/check_purchases.py`
- Test: grep 确认 + import 冒烟

**Interfaces:**
- 移除:`core.services.billing`(legacy Stripe-on-Basejump,2859 行死码)、`webhook_service`(死 Stripe webhook)、两个过时脚本、Stripe commitment 迁移脚本。

- [ ] **Step 1: 确认 `core/services/billing.py` 零导入**

Run: `cd backend && grep -rn "from core.services.billing\|import core.services.billing\|services\.billing import" . --include=*.py | grep -v "core/services/billing.py"`
Expected: **无输出**(侦察报告:零 importer)。

- [ ] **Step 2: 确认 `webhook_service` 零导入**

Run: `cd backend && grep -rn "webhook_service\b" core/ knowledge_base/ api.py --include=*.py | grep -v "core/billing/webhook_service.py" | grep -v "creem_webhook_service\|stripe_webhook\|process_creem_webhook"`
Expected: 命中**仅** `core/utils/scripts/sync_stripe_subscriptions.py:18`(`from billing.webhook_service import webhook_service`)—— 该脚本本 Task 一并删,故视为零有效引用。

- [ ] **Step 3: 确认 `migrate_existing_commitments_stripe` 零导入**

Run: `cd backend && grep -rn "migrate_existing_commitments_stripe" core/ --include=*.py | grep -v "core/billing/migrate_existing_commitments_stripe.py"`
Expected: **无输出**(仅自身 docstring 自引用)。

- [ ] **Step 4: 确认两脚本无被调用方 / 仅读将弃用的 credit_purchases**

Run: `cd backend && grep -rn "sync_stripe_subscriptions\|check_purchases" core/ --include=*.py | grep -vE "core/utils/scripts/(sync_stripe_subscriptions|check_purchases).py"`
Expected: **无输出**(独立脚本,无被 import)。`check_purchases.py` 仅读 `credit_purchases`(Task 8 弃用该表),`sync_stripe_subscriptions.py` 是死 Stripe 同步脚本 + 读 `credit_purchases` —— 两者均无保留价值。

- [ ] **Step 5: 一次性删除**

Run:
```bash
cd backend && git rm core/services/billing.py core/billing/webhook_service.py core/billing/migrate_existing_commitments_stripe.py core/utils/scripts/sync_stripe_subscriptions.py core/utils/scripts/check_purchases.py
```

- [ ] **Step 6: import 冒烟 + 全量 payments 回归**

Run: `cd backend && uv run python -c "import core.billing.api, core.billing.credit_manager, core.billing.entitlements, core.billing.billing_integration; print('ok')" && uv run pytest tests/payments/ -v`
Expected: 打印 `ok` + payments 全绿。

- [ ] **Step 7: Commit**

```bash
git add -A backend/core/services/billing.py backend/core/billing/webhook_service.py backend/core/billing/migrate_existing_commitments_stripe.py backend/core/utils/scripts/sync_stripe_subscriptions.py backend/core/utils/scripts/check_purchases.py
git commit -m "chore(payments): delete dead legacy billing.py + stripe webhook_service + obsolete scripts/migrations"
```

---

## Task 8: `credits.py` 残留收尾(get_account_summary 迁移并弃用 CreditService 死方法)

> Phase C。Plan 2 已把 `get_balance`/`ensure_welcome_bonus` 切到 `credit_manager`,api.py 仅剩两处 `credit_service.get_account_summary`(`:278,:751`)。本 Task 把 summary 也迁入 `credit_manager`,使 `core/credits.py` 零外部调用,然后删除该文件(其 `add_credits`/`deduct_credits`/`grant_tier_credits` 是旧 RPC/订阅死路径)。

**Files:**
- Modify: `backend/core/billing/credit_manager.py`(新增 `get_account_summary`)
- Modify: `backend/core/billing/api.py:6, 278, 751`(`credit_service` → `credit_manager`)
- Delete: `backend/core/credits.py`
- Test: `backend/tests/payments/test_credit_manager_summary.py`

**Interfaces:**
- Produces:`CreditManager.get_account_summary(account_id: str) -> dict`(聚合余额双桶 + 最近 ledger,形状对齐旧 `credit_service.get_account_summary`)。

- [ ] **Step 0: 确认 `credit_service` 仅剩 summary 引用**

Run: `cd backend && grep -rn "credit_service\b\|from core.credits\|core\.credits import" core/ knowledge_base/ api.py --include=*.py | grep -v "core/credits.py"`
Expected: 命中**仅** `core/billing/api.py:6`(import)与 `:278,:751`(`get_account_summary`)。`credit_service.get_balance`/`ensure_welcome_bonus` 已不再出现(Plan 2 Task 7 切走)。若出现其他调用,先按 Plan 2 切到 `credit_manager`。

- [ ] **Step 1: 写失败测试**

```python
# backend/tests/payments/test_credit_manager_summary.py
from __future__ import annotations
from decimal import Decimal
import pytest
from core.billing.credit_manager import CreditManager


class _Resp:
    def __init__(self, data): self.data = data


class _Query:
    def __init__(self, behavior): self._b = behavior; self._table = None
    def select(self, *a, **k): return self
    def eq(self, *a, **k): return self
    def order(self, *a, **k): return self
    def limit(self, n): return self
    async def execute(self): return _Resp(self._b)


class _FakeClient:
    def __init__(self, account_rows, ledger_rows):
        self._account = account_rows; self._ledger = ledger_rows
    def from_(self, table):
        return _Query(self._account if table == "credit_accounts" else self._ledger)


class _DB:
    def __init__(self, c): self._c = c
    @property
    async def client(self): return self._c


def _cm(account_rows, ledger_rows):
    cm = CreditManager.__new__(CreditManager)
    cm.db = _DB(_FakeClient(account_rows, ledger_rows))
    return cm


async def test_summary_shape():
    cm = _cm(
        [{"balance": 12, "expiring_credits": 2, "non_expiring_credits": 10, "tier": "standard"}],
        [{"amount": -1.0, "type": "usage", "description": "run", "created_at": "2026-06-21T00:00:00Z"}],
    )
    s = await cm.get_account_summary("a1")
    assert s["balance"] == 12.0
    assert s["expiring_credits"] == 2.0 and s["non_expiring_credits"] == 10.0
    assert isinstance(s["recent_transactions"], list) and len(s["recent_transactions"]) == 1


async def test_summary_no_account():
    cm = _cm([], [])
    s = await cm.get_account_summary("a1")
    assert s["balance"] == 0.0 and s["recent_transactions"] == []
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && uv run pytest tests/payments/test_credit_manager_summary.py -v`
Expected: FAIL — `AttributeError: 'CreditManager' object has no attribute 'get_account_summary'`。

- [ ] **Step 3: 实现 `get_account_summary`**

在 `backend/core/billing/credit_manager.py` 的 `get_cached_balance`(Plan 2 Task 7 新增)之后、`credit_manager = CreditManager()` 之前新增:

```python
    async def get_account_summary(self, account_id: str, recent_limit: int = 20) -> Dict:
        """聚合余额双桶 + 最近 ledger 流水(替代 core.credits.CreditService.get_account_summary)。"""
        client = await self.db.client
        acct = await client.from_('credit_accounts').select(
            'balance, expiring_credits, non_expiring_credits, tier'
        ).eq('account_id', account_id).execute()
        if not acct.data:
            return {
                'balance': 0.0, 'expiring_credits': 0.0, 'non_expiring_credits': 0.0,
                'tier': None, 'recent_transactions': [],
            }
        row = acct.data[0]
        ledger = await client.from_('credit_ledger').select(
            'amount, type, description, created_at'
        ).eq('account_id', account_id).order('created_at', desc=True).limit(recent_limit).execute()
        return {
            'balance': float(row.get('balance') or 0),
            'expiring_credits': float(row.get('expiring_credits') or 0),
            'non_expiring_credits': float(row.get('non_expiring_credits') or 0),
            'tier': row.get('tier'),
            'recent_transactions': list(ledger.data or []),
        }
```

> 测试 fake 的 `order(...)` 接受任意参数,真实 supabase client 用 `order('created_at', desc=True)`。fake 忽略 `desc` kwarg,断言不依赖排序。

- [ ] **Step 4: 把 api.py 两处 summary 改源 + 删 credit_service import**

Read `backend/core/billing/api.py:6, 278, 751`。
- `:6` 删除 `from core.credits import credit_service`(确认 `from .credit_manager import credit_manager` 已存在于 `:22`;若无则保留 import 行直至确认)。
- `:278` `summary = await credit_service.get_account_summary(account_id)` → `summary = await credit_manager.get_account_summary(account_id)`
- `:751` 同样替换。

Run: `cd backend && grep -n "credit_service" core/billing/api.py`
Expected: **无输出**。

- [ ] **Step 5: 确认 `core/credits.py` 零引用并删除**

Run: `cd backend && grep -rn "from core.credits\|core\.credits import\|credit_service\b" core/ knowledge_base/ api.py --include=*.py | grep -v "core/credits.py"`
Expected: **无输出**。

Run: `cd backend && git rm core/credits.py`
Expected: 删除文件。

- [ ] **Step 6: 运行确认通过 + import 冒烟**

Run: `cd backend && uv run pytest tests/payments/test_credit_manager_summary.py -v && uv run python -c "import core.billing.api; from core.billing.credit_manager import credit_manager; assert hasattr(credit_manager,'get_account_summary'); print('ok')"`
Expected: PASS(2 passed)+ 打印 `ok`。

- [ ] **Step 7: Commit**

```bash
git add backend/core/billing/credit_manager.py backend/core/billing/api.py backend/core/credits.py backend/tests/payments/test_credit_manager_summary.py
git commit -m "refactor(payments): fold get_account_summary into credit_manager; delete core/credits.py (CreditService)"
```

---

## Task 9: 改写会失败的测试 `test_billing_owner_rbac.py`

> Phase B 收尾。实读 `tests/test_billing_owner_rbac.py`:① 参数化用例 `test_billing_mutations_require_workspace_owner`(`:34-74`)的 `@pytest.mark.parametrize` 列表含 **6 条已删路由** + 1 条保留路由 `/provider-policy`(`:62-65`);删路由后那 6 条会返回 404 而非 403 → 用例失败,**必须从 parametrize 列表删掉这 6 项**。② `test_workspace_member_can_still_read_team_subscription`(`:77-120`,测 `GET /subscription`)+ 5 个 `test_workspace_owner_can_*`(`:123/152/186/215/247`)整函数 setattr 已删符号(`creem_subscription_service`/`subscription_service`/`payment_service`/`_get_account_billing_provider`),整函数删。③ `test_workspace_owner_can_update_provider_policy`(`:279`,setattr `provider_policy_service.update_policy` 在 `:295`)**保留**。

**Files:**
- Modify: `backend/tests/test_billing_owner_rbac.py:34-74`(从 parametrize 列表删 6 条已删路由,留 `/provider-policy`)+ 删 6 个订阅测试函数(`:77-120`、`:123`、`:152`、`:186`、`:215`、`:247` 起各整函数)
- Test: 该文件自身

**Interfaces:**
- 保留:参数化用例的 `/provider-policy` PUT case + `test_workspace_owner_can_update_provider_policy`(`provider_policy_service.update_policy` RBAC,`:279/:295`)。

- [ ] **Step 1: 先 Read 全文,识别每个被删路由对应的测试函数**

Run: `cd backend && grep -n "^def test_\|^async def test_\|monkeypatch.setattr\|client.request\|client.post\|client.get\|/billing/" tests/test_billing_owner_rbac.py`
Read 输出,定位:
- `:34-74` 参数化 `test_billing_mutations_require_workspace_owner` —— 列表前 6 项是已删路由(`/purchase-credits :39`、`/create-checkout-session :44`、`/create-portal-session :55`、`/sync-subscription :58`、`/cancel-subscription :59`、`/reactivate-subscription :60`),第 7 项 `/provider-policy`(`:62-65`)保留。
- `:77-120` `test_workspace_member_can_still_read_team_subscription`(测 `/subscription`,含 `:92` 局部 `_has_purchase_qualification` + `:108` setattr `_get_account_billing_provider` + `:109-110` creem/subscription setattr —— 整函数删)
- `:123` `test_workspace_owner_can_purchase_credits`(setattr `payment_service.create_credit_purchase_checkout` `:136`,测 `/purchase-credits` —— 已删)
- `:152/:186/:215/:247` `test_workspace_owner_can_*`(setattr `creem_subscription_service.*`:checkout/portal/cancel/reactivate —— 已删)
- `:279` `test_workspace_owner_can_update_provider_policy`(setattr `provider_policy_service.update_policy` `:295`,测 `/provider-policy` —— **保留**)

- [ ] **Step 2: 从 parametrize 列表删 6 条已删路由(留 `/provider-policy`)**

把 `:34-66` 的 `@pytest.mark.parametrize(("method", "path", "kwargs"), [ ... ])` 列表整体替换为只剩 `/provider-policy` 一项:

```python
@pytest.mark.parametrize(
    ("method", "path", "kwargs"),
    [
        (
            "PUT",
            "/billing/provider-policy",
            {"json": {"enabled_providers": ["openai"], "default_provider": "openai"}},
        ),
    ],
)
def test_billing_mutations_require_workspace_owner(method: str, path: str, kwargs: dict) -> None:
    client = _build_client(owner_dependency=_reject_member_owner_gate)

    response = client.request(method, path, **kwargs)

    assert response.status_code == 403
    assert response.json() == {"detail": "Only workspace owners can manage team billing"}
```

> 函数体(`:68-74`)不变,仅删 parametrize 列表前 6 项;`/provider-policy` PUT 路由(`api.py:1310`,owner-gate)仍受 RBAC 保护,该用例继续守卫。

- [ ] **Step 3: 删除 6 个测已删路由的订阅/Creem 测试函数**

整函数删除以下 6 个(它们 setattr 已删符号、测已删路由):`test_workspace_member_can_still_read_team_subscription`(`:77-120`,含其局部 `_has_purchase_qualification`/`_get_subscription`/`_get_balance`/`_get_summary` helper)、`test_workspace_owner_can_purchase_credits`(`:123`)、`test_workspace_owner_can_create_checkout_session`(`:152`)、`test_workspace_owner_can_create_portal_session`(`:186`)、`test_workspace_owner_can_cancel_subscription`(`:215`)、`test_workspace_owner_can_reactivate_subscription`(`:247`)。

> 删除原则:函数体内 `monkeypatch.setattr(billing_api.creem_subscription_service, ...)` / `billing_api.payment_service` / `billing_api.subscription_service` / `billing_api._get_account_billing_provider` 的,整函数删(目标路由 + 被 setattr 的符号都已不存在,无法再测)。模块顶部 `_allow_owner_account`/`_allow_member_account`/`_reject_member_owner_gate`/`_build_client` helper 仍被保留用例与参数化用例使用,**不删**。

- [ ] **Step 4: 保留并校验 provider-policy RBAC 用例**

确认 `test_workspace_owner_can_update_provider_policy`(`:279`,setattr `provider_policy_service.update_policy` `:295`)完整保留(`/provider-policy` PUT 路由 `api.py:1310` 未动)。

- [ ] **Step 5: 确认无悬空引用**

Run: `cd backend && grep -n "creem_subscription_service\|subscription_service\|payment_service\b\|_get_account_billing_provider\|credit_service\|/subscription\|/purchase-credits\|/create-checkout-session\|/create-portal-session\|/sync-subscription\|/cancel-subscription\|/reactivate-subscription" tests/test_billing_owner_rbac.py`
Expected: **无输出**(订阅/Creem setattr + 已删路由路径全部清净;`provider_policy_service` 不含这些子串)。

- [ ] **Step 6: 运行确认通过**

Run: `cd backend && uv run pytest tests/test_billing_owner_rbac.py -v`
Expected: PASS —— 仅剩 `test_billing_mutations_require_workspace_owner[PUT-/billing/provider-policy-...]`(1 个参数化用例)+ `test_workspace_owner_can_update_provider_policy` 全绿;无 ImportError/AttributeError/404。

- [ ] **Step 7: Commit**

```bash
git add backend/tests/test_billing_owner_rbac.py
git commit -m "test(payments): drop subscription/creem RBAC cases (routes removed), keep provider-policy"
```

---

## Task 10: DB 迁移 1 — drop `credit_accounts` 订阅列(保留 tier)

> Phase D。代码已无任何读者(Plan 2 切 use_credits/add_credits 去 tier/subscription 读;本计划删 subscription_service/creem/payment_service)。本 Task 仅 `DROP COLUMN`。**保留 `tier`、`balance`、双桶、`daily_login_remaining`。**

**Files:**
- Create: `backend/supabase/migrations/20260621120000_drop_subscription_columns.sql`
- Test: `backend/tests/payments/test_drop_subscription_columns_migration.py`

**Interfaces:**
- Produces:迁移 drop `billing_provider, provider_customer_id, provider_subscription_id, provider_product_id, last_processed_transaction_id, stripe_subscription_id, commitment_type, commitment_start_date, commitment_end_date, commitment_price_id, can_cancel_after` + 相关索引 + `commitment_history` 表。

- [ ] **Step 0: 确认代码无任何订阅列读者**

Run: `cd backend && grep -rn "provider_subscription_id\|stripe_subscription_id\|billing_provider\|provider_customer_id\|provider_product_id\|last_processed_transaction_id\|commitment_type\|commitment_start_date\|commitment_end_date\|commitment_price_id\|can_cancel_after" core/ knowledge_base/ api.py --include=*.py`
Expected: **无输出**(全部读者已随 Task 2–8 删除)。**若有输出,先把该读者处理掉再建迁移**(否则 drop 后运行时报列不存在)。

- [ ] **Step 1: 写失败测试**(静态校验迁移文本)

```python
# backend/tests/payments/test_drop_subscription_columns_migration.py
from __future__ import annotations
from pathlib import Path

_SQL = (Path(__file__).resolve().parents[1].parent / "supabase" / "migrations"
        / "20260621120000_drop_subscription_columns.sql")


def test_migration_drops_all_subscription_columns():
    text = _SQL.read_text(encoding="utf-8").lower()
    for col in ["billing_provider", "provider_customer_id", "provider_subscription_id",
                "provider_product_id", "last_processed_transaction_id", "stripe_subscription_id",
                "commitment_type", "commitment_start_date", "commitment_end_date",
                "commitment_price_id", "can_cancel_after"]:
        assert f"drop column if exists {col}" in text, f"missing drop for {col}"


def test_migration_keeps_tier_and_balance():
    text = _SQL.read_text(encoding="utf-8").lower()
    # 绝不能 drop tier / balance / 双桶
    for kept in ["drop column if exists tier", "drop column if exists balance",
                 "drop column if exists expiring_credits", "drop column if exists non_expiring_credits"]:
        assert kept not in text, f"must NOT drop: {kept}"


def test_migration_drops_commitment_history_and_indexes():
    text = _SQL.read_text(encoding="utf-8").lower()
    assert "drop table if exists" in text and "commitment_history" in text
    assert "drop index if exists idx_credit_accounts_billing_provider" in text
    assert "drop index if exists idx_credit_accounts_provider_subscription_id" in text
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && uv run pytest tests/payments/test_drop_subscription_columns_migration.py -v`
Expected: FAIL — 文件不存在。

- [ ] **Step 3: 写迁移**

```sql
-- backend/supabase/migrations/20260621120000_drop_subscription_columns.sql
-- 纯预付费收敛(D1/D7):移除 credit_accounts 的订阅/Creem/Stripe-订阅/commitment 列。
-- 保留:tier(驱动 entitlements 兼容层 + admin 视图)、balance、expiring/non_expiring、daily_login_remaining。
-- 前置:所有代码读者已删除(Plan 4 Task 2–8)。
BEGIN;

-- 索引先删(列删除会级联,但显式 drop 更清晰可回看)
DROP INDEX IF EXISTS idx_credit_accounts_billing_provider;
DROP INDEX IF EXISTS idx_credit_accounts_provider_subscription_id;
DROP INDEX IF EXISTS idx_credit_accounts_stripe_subscription_id;
DROP INDEX IF EXISTS idx_credit_accounts_commitment;

-- Creem/通用 provider 列(20251220090000_add_billing_provider_fields.sql)
ALTER TABLE credit_accounts DROP COLUMN IF EXISTS billing_provider;
ALTER TABLE credit_accounts DROP COLUMN IF EXISTS provider_customer_id;
ALTER TABLE credit_accounts DROP COLUMN IF EXISTS provider_subscription_id;
ALTER TABLE credit_accounts DROP COLUMN IF EXISTS provider_product_id;
ALTER TABLE credit_accounts DROP COLUMN IF EXISTS last_processed_transaction_id;

-- Stripe 订阅列(20250906100512_remove_redundant_stuff.sql 等)
ALTER TABLE credit_accounts DROP COLUMN IF EXISTS stripe_subscription_id;

-- commitment 列(20250923070217_commitment_tracking.sql)
ALTER TABLE credit_accounts DROP COLUMN IF EXISTS commitment_type;
ALTER TABLE credit_accounts DROP COLUMN IF EXISTS commitment_start_date;
ALTER TABLE credit_accounts DROP COLUMN IF EXISTS commitment_end_date;
ALTER TABLE credit_accounts DROP COLUMN IF EXISTS commitment_price_id;
ALTER TABLE credit_accounts DROP COLUMN IF EXISTS can_cancel_after;

-- commitment 历史表(无订阅后无用)
DROP TABLE IF EXISTS commitment_history CASCADE;

COMMIT;
```

> 注:`current_period_start/current_period_end` 不是 `credit_accounts` 列(侦察报告:仅 webhook/subscription service 内存 dict 字段 + `basejump.billing_subscriptions`),故不在此 drop。`basejump.billing_subscriptions` 属 Basejump 基础设施,本计划不动。

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && uv run pytest tests/payments/test_drop_subscription_columns_migration.py -v`
Expected: PASS(3 passed)。

- [ ] **Step 5: Commit**

```bash
git add backend/supabase/migrations/20260621120000_drop_subscription_columns.sql backend/tests/payments/test_drop_subscription_columns_migration.py
git commit -m "feat(payments): migration drop credit_accounts subscription columns (keep tier/balance) + commitment_history"
```

---

## Task 11: DB 迁移 2 — 改写 `add_credits_idempotent` RPC 去 tier 写入

> Phase D。侦察报告:RPC 内 `INSERT INTO credit_accounts (... tier)` 在新账户首次入账时写 `tier`(`migrations/20260201101500_add_credits_idempotent.sql:42`)。tier 列**保留**(entitlements 兼容层 + admin 读),但其值应由 entitlements 统一为 `"standard"` 语义,RPC 不再硬写。本 Task 给新版 RPC:INSERT 时不再设置 tier(让列走默认值或 NULL,entitlements 已不依赖具体值)。

**Files:**
- Create: `backend/supabase/migrations/20260621123000_add_credits_idempotent_no_tier.sql`
- Test: `backend/tests/payments/test_add_credits_rpc_no_tier_migration.py`

**Interfaces:**
- Produces:`add_credits_idempotent`(签名不变,见 ANCHORS:`p_account_id, p_amount, p_type, p_description, p_is_expiring, p_expires_at, p_billing_dedup_key`)新版,INSERT 不写 tier。

- [ ] **Step 0: 取现有 RPC 全文作改写基线**

Run: `cd backend && cat supabase/migrations/20260201101500_add_credits_idempotent.sql`
Read 全文(它定义 `CREATE OR REPLACE FUNCTION add_credits_idempotent(...)`,含 `:42-44` `INSERT INTO credit_accounts (... tier) VALUES (p_account_id, 0, 0, 0, 'free')`、`:84` `v_type` 派生、`:50` FOR UPDATE 行锁 + `:36-39/:52-62` `billing_dedup_key` 去重、`:108` RETURN)。新迁移将 `CREATE OR REPLACE` 同名函数,**逐字复制原体**,唯一改动:`INSERT INTO credit_accounts` 列清单去掉 `tier` 列、`VALUES` 去掉 `'free'` 值(Step 3 给完整迁移)。

> ⚠️ 务必基于真实现有函数体改写(保留行锁 / 去重 / 返回列 / `v_type` 逻辑),不可凭空重写签名或语义 —— 改动面**仅** INSERT 列列表。

- [ ] **Step 1: 写失败测试**(静态校验:新迁移存在、签名一致、INSERT 不含 tier)

```python
# backend/tests/payments/test_add_credits_rpc_no_tier_migration.py
from __future__ import annotations
from pathlib import Path

_DIR = Path(__file__).resolve().parents[1].parent / "supabase" / "migrations"
_SQL = _DIR / "20260621123000_add_credits_idempotent_no_tier.sql"


def test_migration_exists_and_redefines_rpc():
    text = _SQL.read_text(encoding="utf-8")
    low = text.lower()
    assert "create or replace function" in low
    assert "add_credits_idempotent" in text
    # 签名锚:7 个参数名必须保留
    for p in ["p_account_id", "p_amount", "p_type", "p_description",
              "p_is_expiring", "p_expires_at", "p_billing_dedup_key"]:
        assert p in text, f"missing param {p}"


def test_insert_no_longer_writes_tier():
    low = _SQL.read_text(encoding="utf-8").lower()
    # 新 INSERT 的列清单不得包含 tier(行锁/去重逻辑保留)
    assert "for update" in low, "row lock must be preserved"
    # 找到 INSERT INTO credit_accounts (...) 片段,断言其列列表无 tier
    idx = low.find("insert into credit_accounts")
    assert idx != -1
    cols = low[idx: idx + 200]
    assert "tier" not in cols, "INSERT into credit_accounts must NOT set tier"
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && uv run pytest tests/payments/test_add_credits_rpc_no_tier_migration.py -v`
Expected: FAIL — 文件不存在。

- [ ] **Step 3: 写迁移(`CREATE OR REPLACE` 同名函数,逐字复制原体,仅改 INSERT 列)**

新建 `backend/supabase/migrations/20260621123000_add_credits_idempotent_no_tier.sql`。基于 Step 0 实读(`20260201101500_add_credits_idempotent.sql`),**唯一改动**是把原 `:42-44` 的 `INSERT INTO credit_accounts (... tier) VALUES (p_account_id, 0, 0, 0, 'free') ...` 去掉 `tier` 列与其 `'free'` 值。完整迁移如下(逐字保留行锁 / 去重 / `v_type` 派生 / 全部 RETURN 列):

```sql
-- backend/supabase/migrations/20260621123000_add_credits_idempotent_no_tier.sql
-- 纯预付费收敛(D4):add_credits_idempotent 在新账户首次入账时不再硬写 tier。
-- tier 列保留(entitlements 兼容层 + admin 读),其值由 entitlements 统一为 "standard" 语义。
-- 唯一改动:INSERT INTO credit_accounts 去掉 tier 列与 'free' 值;签名 / 行锁 / 去重 / 返回列逐字不变。
BEGIN;

CREATE OR REPLACE FUNCTION public.add_credits_idempotent(
    p_account_id UUID,
    p_amount DECIMAL,
    p_type TEXT DEFAULT NULL,
    p_description TEXT DEFAULT 'Credit added',
    p_is_expiring BOOLEAN DEFAULT true,
    p_expires_at TIMESTAMPTZ DEFAULT NULL,
    p_billing_dedup_key TEXT DEFAULT NULL
)
RETURNS TABLE (
    success BOOLEAN,
    duplicate BOOLEAN,
    expiring_credits DECIMAL,
    non_expiring_credits DECIMAL,
    new_balance DECIMAL,
    transaction_id UUID,
    error TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_existing_id UUID;
    v_existing_balance DECIMAL;
    v_current_expiring DECIMAL;
    v_current_non_expiring DECIMAL;
    v_current_total DECIMAL;
    v_new_expiring DECIMAL;
    v_new_non_expiring DECIMAL;
    v_new_total DECIMAL;
    v_tx_id UUID;
    v_type TEXT;
BEGIN
    IF p_billing_dedup_key IS NULL OR length(trim(p_billing_dedup_key)) = 0 THEN
        RETURN QUERY SELECT FALSE, FALSE, NULL::DECIMAL, NULL::DECIMAL, NULL::DECIMAL, NULL::UUID, 'billing_dedup_key_required';
        RETURN;
    END IF;

    -- Ensure account row exists to allow row locking. (tier 不再硬写,走列默认值/NULL)
    INSERT INTO credit_accounts (account_id, expiring_credits, non_expiring_credits, balance)
    VALUES (p_account_id, 0, 0, 0)
    ON CONFLICT (account_id) DO NOTHING;

    SELECT ca.expiring_credits, ca.non_expiring_credits, ca.balance
    INTO v_current_expiring, v_current_non_expiring, v_current_total
    FROM credit_accounts ca
    WHERE ca.account_id = p_account_id
    FOR UPDATE;

    SELECT id, balance_after
    INTO v_existing_id, v_existing_balance
    FROM credit_ledger
    WHERE billing_dedup_key = p_billing_dedup_key
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
        RETURN QUERY SELECT TRUE, TRUE, v_current_expiring, v_current_non_expiring,
            COALESCE(v_existing_balance, v_current_total), v_existing_id, NULL::TEXT;
        RETURN;
    END IF;

    v_current_expiring := COALESCE(v_current_expiring, 0);
    v_current_non_expiring := COALESCE(v_current_non_expiring, 0);

    IF p_is_expiring THEN
        v_new_expiring := v_current_expiring + p_amount;
        v_new_non_expiring := v_current_non_expiring;
    ELSE
        v_new_expiring := v_current_expiring;
        v_new_non_expiring := v_current_non_expiring + p_amount;
    END IF;

    v_new_total := v_new_expiring + v_new_non_expiring;

    UPDATE credit_accounts
    SET expiring_credits = v_new_expiring,
        non_expiring_credits = v_new_non_expiring,
        balance = v_new_total,
        updated_at = NOW()
    WHERE account_id = p_account_id;

    v_type := COALESCE(p_type, CASE WHEN p_is_expiring THEN 'tier_grant' ELSE 'purchase' END);

    INSERT INTO credit_ledger (
        account_id,
        amount,
        balance_after,
        type,
        description,
        is_expiring,
        expires_at,
        billing_dedup_key
    )
    VALUES (
        p_account_id,
        p_amount,
        v_new_total,
        v_type,
        p_description,
        p_is_expiring,
        p_expires_at,
        p_billing_dedup_key
    )
    RETURNING id INTO v_tx_id;

    RETURN QUERY SELECT TRUE, FALSE, v_new_expiring, v_new_non_expiring, v_new_total, v_tx_id, NULL::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_credits_idempotent(
    UUID,
    DECIMAL,
    TEXT,
    TEXT,
    BOOLEAN,
    TIMESTAMPTZ,
    TEXT
) TO service_role;

COMMIT;
```

> 与原迁移逐字一致,**仅** `INSERT INTO credit_accounts` 列清单 `(account_id, expiring_credits, non_expiring_credits, balance, tier)` → `(account_id, expiring_credits, non_expiring_credits, balance)` 且 `VALUES (p_account_id, 0, 0, 0, 'free')` → `VALUES (p_account_id, 0, 0, 0)`。签名 / `FOR UPDATE` 行锁 / `billing_dedup_key` 去重 / `v_type := COALESCE(...)` / 7 个 RETURN 列 / `GRANT EXECUTE` 全部保留。

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && uv run pytest tests/payments/test_add_credits_rpc_no_tier_migration.py -v`
Expected: PASS(2 passed)。

- [ ] **Step 5: Commit**

```bash
git add backend/supabase/migrations/20260621123000_add_credits_idempotent_no_tier.sql backend/tests/payments/test_add_credits_rpc_no_tier_migration.py
git commit -m "feat(payments): redefine add_credits_idempotent to stop writing tier on account insert"
```

---

## Task 12: DB 迁移 3 — 弃用 `credit_purchases` + 删 v1 表 `credit_balance`/`credit_usage`

> Phase D 收尾。`credit_purchases` 的活跃读者(payment_service / creem_webhook / check_purchases / sync_stripe)已随 Task 2–7 全删;充值跟踪改由 `payment_orders` + `credit_ledger` 表达。v1 表 `credit_balance`/`credit_usage` 唯一读者是已删的 `core/services/billing.py`。

**Files:**
- Create: `backend/supabase/migrations/20260621130000_retire_legacy_credit_tables.sql`
- Test: `backend/tests/payments/test_retire_legacy_tables_migration.py`

**Interfaces:**
- Produces:迁移 `DROP TABLE credit_balance` / `credit_usage`;`credit_purchases` 处理(见 Step 0 决策)。

- [ ] **Step 0: 确认所有旧表读者已清零**

Run: `cd backend && grep -rn "credit_balance\b\|credit_usage\b\|credit_purchases\b" core/ knowledge_base/ api.py --include=*.py`
Expected: **无输出**(api.py 的 `credit_balance` 是 JSON response key 不算表名 —— 若命中需 Read 确认是 response key 而非 `.from_('credit_balance')`;`credit_purchases` 读者已全删)。逐条核对命中确为表访问才阻塞。

> 处置决策:`credit_balance`/`credit_usage` 无任何代码读者 → 直接 `DROP TABLE`。`credit_purchases` 若 D7 Step 0 确认无需保留历史 → `DROP TABLE`;若需保历史审计 → 仅注释弃用(不 drop)。**本计划默认 D7 无活跃数据 → 一并 drop**;若有历史需留,把 `credit_purchases` 的 drop 改为 `COMMENT ON TABLE credit_purchases IS '[DEPRECATED] superseded by payment_orders'` 并从迁移移除其 drop。

- [ ] **Step 1: 写失败测试**

```python
# backend/tests/payments/test_retire_legacy_tables_migration.py
from __future__ import annotations
from pathlib import Path

_SQL = (Path(__file__).resolve().parents[1].parent / "supabase" / "migrations"
        / "20260621130000_retire_legacy_credit_tables.sql")


def test_drops_v1_tables():
    low = _SQL.read_text(encoding="utf-8").lower()
    assert "drop table if exists credit_balance" in low
    assert "drop table if exists credit_usage" in low


def test_handles_credit_purchases():
    low = _SQL.read_text(encoding="utf-8").lower()
    # 要么 drop,要么显式标注弃用(二选一,不得遗漏)
    assert ("drop table if exists credit_purchases" in low
            or "deprecated" in low and "credit_purchases" in low)


def test_keeps_live_tables():
    low = _SQL.read_text(encoding="utf-8").lower()
    for kept in ["drop table if exists credit_accounts",
                 "drop table if exists credit_ledger",
                 "drop table if exists payment_orders"]:
        assert kept not in low, f"must NOT drop live table: {kept}"
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && uv run pytest tests/payments/test_retire_legacy_tables_migration.py -v`
Expected: FAIL — 文件不存在。

- [ ] **Step 3: 写迁移**

```sql
-- backend/supabase/migrations/20260621130000_retire_legacy_credit_tables.sql
-- 退役 v1 信用表(credit_balance/credit_usage:唯一读者 core/services/billing.py 已删)
-- 弃用 credit_purchases(充值跟踪迁至 payment_orders + credit_ledger;读者已全删)。
-- 绝不动 live 表:credit_accounts / credit_ledger / payment_orders。
BEGIN;

-- v1 dormant 表
DROP TABLE IF EXISTS credit_balance CASCADE;
DROP TABLE IF EXISTS credit_usage CASCADE;

-- credit_purchases:充值跟踪已由 payment_orders 取代(D6/D7)。
-- 默认假定无需保留历史(D7 Step 0 已确认)→ 直接 drop。
-- 若需保留历史审计:删除下一行,改用 COMMENT 标注弃用。
DROP TABLE IF EXISTS credit_purchases CASCADE;

COMMIT;
```

> 若 D7 Step 0 显示 `credit_purchases` 有需保留的历史:把上面 `DROP TABLE IF EXISTS credit_purchases CASCADE;` 替换为 `COMMENT ON TABLE credit_purchases IS '[DEPRECATED] superseded by payment_orders (2026-06-21); read-only history';`,测试 `test_handles_credit_purchases` 仍通过(命中 deprecated 分支)。

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && uv run pytest tests/payments/test_retire_legacy_tables_migration.py -v`
Expected: PASS(3 passed)。

- [ ] **Step 5: Commit**

```bash
git add backend/supabase/migrations/20260621130000_retire_legacy_credit_tables.sql backend/tests/payments/test_retire_legacy_tables_migration.py
git commit -m "feat(payments): retire v1 credit_balance/credit_usage + credit_purchases (superseded by payment_orders)"
```

---

## Task 12b: DB 迁移 4 — 修复既有信用表团队 RLS(SPEC §14.6)

> Phase D。既有 `credit_accounts` / `credit_ledger` 的 SELECT 策略是 `USING (auth.uid() = account_id)`(列由 `user_id` 重命名而来,policy 表达式自动跟随)。团队计费迁移(`20251230090000_team_billing_accounts.sql`)把 FK 重指向 `basejump.accounts` 后,团队账户的 `account_id` ≠ 成员 `auth.uid()`,导致**团队成员读不到团队信用余额/流水**。本 Task 把两条 SELECT 策略改用 `basejump.has_role_on_account(account_id)`(与 Plan 1 `payment_orders` 的 RLS 一致)。纯 RLS 修复:不动数据、不动 `service_role` 写策略、不动 `tier`/余额列。

**Files:**
- Create: `backend/supabase/migrations/20260621133000_fix_credit_tables_team_rls.sql`
- Test: `backend/tests/payments/test_credit_tables_rls_migration.py`

**Interfaces:**
- Produces:`credit_accounts` / `credit_ledger` 的 SELECT 策略改用 `basejump.has_role_on_account(account_id)`。

- [ ] **Step 0: 核对既有策略名(迁移历史以防不同)**

Run: `cd backend && grep -rn "Users can view own credit account\|Users can view own ledger\|has_role_on_account" supabase/migrations/`
Expected: 命中 `20250905102928_credit_system_refactor.sql` 定义的两条 SELECT 策略(`"Users can view own credit account"` ON credit_accounts、`"Users can view own ledger"` ON credit_ledger,`USING (auth.uid() = user_id)`,列已 rename 为 `account_id`)。若策略名与此不同,以实际名替换 Step 3 的 `DROP POLICY` 名。

- [ ] **Step 1: 写失败测试**(静态校验迁移文本)

```python
# backend/tests/payments/test_credit_tables_rls_migration.py
from __future__ import annotations
from pathlib import Path

_SQL = (Path(__file__).resolve().parents[1].parent / "supabase" / "migrations"
        / "20260621133000_fix_credit_tables_team_rls.sql")


def test_uses_has_role_on_account():
    low = _SQL.read_text(encoding="utf-8").lower()
    assert "has_role_on_account(account_id)" in low
    assert low.count("create policy") >= 2  # credit_accounts + credit_ledger 各一条 SELECT


def test_replaces_old_select_policies():
    low = _SQL.read_text(encoding="utf-8").lower()
    assert 'drop policy if exists "users can view own credit account" on credit_accounts' in low
    assert 'drop policy if exists "users can view own ledger" on credit_ledger' in low


def test_does_not_touch_service_role_or_drop_tables():
    low = _SQL.read_text(encoding="utf-8").lower()
    assert "service role manages" not in low      # 不重建/不动 service_role 写策略
    assert "drop table" not in low                  # 纯 RLS,不删表
    assert "drop column" not in low                 # 不删列
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && uv run pytest tests/payments/test_credit_tables_rls_migration.py -v`
Expected: FAIL — 文件不存在。

- [ ] **Step 3: 写迁移**

```sql
-- backend/supabase/migrations/20260621133000_fix_credit_tables_team_rls.sql
-- SPEC §14.6:团队计费(20251230090000)把 credit_accounts/credit_ledger 的 FK 重指向
-- basejump.accounts 后,旧 SELECT 策略 auth.uid()=account_id 对团队账户失效(account_id 是
-- 团队 id,非成员 uid)→ 团队成员读不到团队信用。改用 basejump.has_role_on_account(account_id)。
-- 纯 RLS:不动数据/列/service_role 写策略。
BEGIN;

-- credit_accounts:成员可读所属账户(个人或团队)的信用账户
DROP POLICY IF EXISTS "Users can view own credit account" ON credit_accounts;
CREATE POLICY "Members can view account credit account" ON credit_accounts
    FOR SELECT USING (basejump.has_role_on_account(account_id));

-- credit_ledger:成员可读所属账户的信用流水
DROP POLICY IF EXISTS "Users can view own ledger" ON credit_ledger;
CREATE POLICY "Members can view account ledger" ON credit_ledger
    FOR SELECT USING (basejump.has_role_on_account(account_id));

COMMIT;
```

> `basejump.has_role_on_account(account_id)` 与 Plan 1 `payment_orders` RLS 同一函数(basejump 基础设施提供);第二参数(role)省略表示「任意成员角色」,与「成员可查看团队余额」语义一致。`service_role` 的 `FOR ALL` 写策略(`"Service role manages ..."`)保持不变 —— 所有写入仍只走 service_role RPC。

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && uv run pytest tests/payments/test_credit_tables_rls_migration.py -v`
Expected: PASS(3 passed)。

- [ ] **Step 5: Commit**

```bash
git add backend/supabase/migrations/20260621133000_fix_credit_tables_team_rls.sql backend/tests/payments/test_credit_tables_rls_migration.py
git commit -m "fix(payments): credit tables team RLS via has_role_on_account (SPEC §14.6)"
```

---

## Task 13: 全量回归与收尾校验(P6)

> Phase E。删除完成后的「无 import 错误 + 全量测试 + 残留 grep」回归,并给关键路径手测清单。

**Files:**
- Test: 无新文件(运行既有套件 + 冒烟 + grep)

- [ ] **Step 1: 全 backend import 冒烟(确认无 import 错误)**

Run: `cd backend && uv run python -c "import core.billing.api, core.billing.credit_manager, core.billing.entitlements, core.billing.billing_integration, core.billing.pricing, core.agent_runs, core.files.api, knowledge_base.api, core.ai_models.manager, core.core_utils; import core.billing.payments.bootstrap, core.billing.payments.orders, core.billing.payments.sweeper_task; print('all-imports-ok')"`
Expected: 打印 `all-imports-ok`(无 ModuleNotFoundError —— 验证所有删除未留悬空 import)。

- [ ] **Step 2: 确认所有目标模块已删**

Run: `cd backend && ls core/services/billing.py core/billing/webhook_service.py core/billing/subscription_service.py core/billing/creem_subscription_service.py core/billing/creem_webhook_service.py core/billing/payment_service.py core/billing/migrate_existing_commitments_stripe.py core/credits.py core/billing/providers/ 2>&1`
Expected: 全部 `No such file or directory`。

- [ ] **Step 3: 残留引用 grep(全为空)**

Run:
```bash
cd backend && grep -rn "subscription_service\b\|creem_subscription_service\|creem_webhook_service\|from core.credits\|credit_service\b\|get_billing_provider\|from core.services.billing\|stripe_subscription_id\|provider_subscription_id\|billing_provider\b\|reset_expiring_credits\|is_unlimited_tier" core/ knowledge_base/ api.py --include=*.py | grep -v "def is_unlimited_tier"
```
Expected: **无输出**(所有删除符号 / 订阅列读者 / Plan 2 已删的 helper 全部清零)。

> `is_unlimited_tier` 的定义可能仍留在 `config.py`(若它是 config tier 体系的一部分且 ANCHORS「保留 config tier 体系」)—— `grep -v "def is_unlimited_tier"` 排除定义行;若它真的无人调用且不属保留集,可在此 Task 顺手删,但**不强制**(本计划聚焦支付删除,config tier 体系保留)。

- [ ] **Step 4: 后端全量测试**

Run(经用户同意):`cd backend && uv run pytest tests/payments/ tests/test_billing_owner_rbac.py tests/test_ws_d_billing_persistence.py -v`
Expected: 全绿。`tests/payments/` 含 Plan 1+2+本计划全部新测;`test_billing_owner_rbac` 仅 provider-policy 用例;`test_ws_d_billing_persistence` 不回归。

- [ ] **Step 5: 前端类型/lint 回归(确认 Plan 3 前端无残留订阅调用)**

Run(经用户同意):`cd frontend && bun run type-check && bun run lint`
Expected: PASS(Plan 3 已删订阅 UI / 旧计费函数;本计划后端删订阅端点不影响已迁前端)。

- [ ] **Step 6: 关键路径手测清单(记录;经用户同意配测试密钥后执行,不在本计划跑 dev)**

记录以下端到端手测(P6 验收):
1. **Alipay 扫码到账**:前端充值页选 Alipay `¥30` → Pay → 弹二维码 → 沙箱扫码付款 → `POST /billing/notify/alipay` 验签通过 → `OrderService.settle` → `credit_ledger` 多一条 `purchase` + `payment_orders.status=paid` → 前端轮询 `/billing/orders/{id}` 收到 `paid` → 余额刷新。
2. **Stripe Checkout 到账**:选 Card `$5` → 新标签 Stripe Checkout → 沙箱付款 → `checkout.session.completed` → `POST /billing/webhook/stripe`(raw body 验签)→ settle → 到账;重复投递 webhook **不重复加分**(`credited_at` 闸门 + `billing_dedup_key` 去重)。
3. **丢 webhook sweeper 自愈**:建单付款后**屏蔽** webhook 投递 → 等 sweeper 周期(`reconcile_payment_orders`)→ `query_order_status` 查到 paid → settle 补到账,且不与后到的 webhook 双发。
4. **余额不足拦截**:余额 < `MINIMUM_CREDIT_FOR_RUN` 时发起 agent run → `billing_integration.check_model_and_billing_access` 返回 `error_type=insufficient_credits`,run 被拦。
5. **删除后无 import 错误**:重启后端服务(经同意)无 ImportError(已由 Step 1 冒烟覆盖);`/billing/orders/checkout`、`/billing/provider-policy`、`/billing/balance`、`/billing/check`、`/billing/available-models` 正常响应,`/billing/subscription` 等已删路由返回 404。

- [ ] **Step 7: Commit(回归无代码改动则跳过;若 Step 3 顺手清理了残留则 commit)**

```bash
# 若本 Task 有清理性改动:
git add -A
git commit -m "chore(payments): post-deletion regression cleanup + verified zero dangling refs"
```

---

## 验收(Plan 4 完成标准)

- [ ] `config.BILLING_PROVIDER_DEFAULT == "payments"`;`_get_account_billing_provider` 已删(Task 5)。
- [ ] 已删文件全部不存在:`subscription_service.py` / `creem_subscription_service.py` / `creem_webhook_service.py` / `payment_service.py` / `providers/*` / `core/services/billing.py` / `core/billing/webhook_service.py` / `migrate_existing_commitments_stripe.py` / `core/credits.py` / `sync_stripe_subscriptions.py` / `check_purchases.py`。
- [ ] 已删路由不存在(api.router 无 `/subscription`/`/create-checkout-session`/`/create-portal-session`/`/sync-subscription`/`/cancel-subscription`/`/reactivate-subscription`/`/purchase-credits`/`/webhook/creem`);新路由仍在(`/orders/checkout`/`/orders/{id}`/`/webhook/stripe`/`/notify/alipay`);`/provider-policy` 完整保留。
- [ ] `cd backend && grep -rn "subscription_service\b\|creem\|get_billing_provider\|from core.credits\|credit_service\b" core/ knowledge_base/ api.py --include=*.py` 为空(除 config 中标注弃用的 CREEM env 注释)。
- [ ] DB 迁移四件:`20260621120000_drop_subscription_columns.sql`(去订阅列保 tier)、`20260621123000_add_credits_idempotent_no_tier.sql`(RPC 去 tier 写入)、`20260621130000_retire_legacy_credit_tables.sql`(删 v1 表 + 弃 credit_purchases)、`20260621133000_fix_credit_tables_team_rls.sql`(团队 RLS 修复,SPEC §14.6)。
- [ ] 全量测试绿:`cd backend && uv run pytest tests/payments/ tests/test_billing_owner_rbac.py tests/test_ws_d_billing_persistence.py -v`。
- [ ] import 冒烟:`all-imports-ok`(Task 13 Step 1)。
- [ ] **绝未删**:`credit_accounts.tier` 列、`provider_policy_service`、`/provider-policy` 路由、`billing_integration`、config tier 体系、`credit_manager`/`credit_ledger`/`add_credits_idempotent`/`deduct_credits_idempotent`、DDD slice + `domain_outbox`。

## 依赖与衔接

- **依赖 Plan 1**:新支付层 + `payment_orders` + 4 路由必须已存在(Task 0 校验)。
- **依赖 Plan 2**:6 调用点已切 entitlements、`credit_manager` 已瘦身且具 `ensure_welcome_bonus`/`get_cached_balance`、`billing_integration` 已塌缩;否则删 `subscription_service`/`credits.py` 会留悬空引用。
- **依赖 Plan 3**:前端已停用订阅端点调用;否则本计划删订阅路由后前端 404。
- **不可逆点**:Task 1 是最后的可回滚点(改 `BILLING_PROVIDER_DEFAULT` 回 `"creem"`)。进入 Task 2(删 Creem 代码)后回滚需 `git revert`。DB 迁移(Task 10–12)的 drop 不可逆(线上执行前务必备份 + 确认 D7 数据)。
- **收尾**:支付路径收敛完成 —— 仅剩 Alipay(CNY)+ Stripe(USD)两条预付费充值路径,无订阅、无 Creem、无死代码、无订阅 DB 列。
