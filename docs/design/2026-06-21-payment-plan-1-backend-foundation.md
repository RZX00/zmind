# 支付收敛 Plan 1:后端支付基础层 (P0–P2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不破坏现有 Creem 流程的前提下,新建一个干净、可独立测试的支付层(契约 / resolver / 路由 / 定价 / 汇率 / 充值目录 / Stripe+Alipay 网关 / 订单 / 幂等结算 / reconcile sweeper / 新路由),为后续切换与删除旧栈打基础。

**Architecture:** 仿 `E:\app\aip`:一个小而全的 `PaymentGateway` 协议 + 归一化 DTO,两个网关各自实现;`PaymentGatewayResolver` 纯查表 + 能力门控,路由策略在其上薄层;`OrderService` 经可注入的 `OrderStore`/`PaymentGateway`/`credit_manager` 完成建单与三入口共用的幂等结算(`add_credits_idempotent` RPC + `credited_at` 闸门)。所有新模块用依赖注入,单测用内存 fake,无需真 DB。

**Tech Stack:** Python 3.11 / FastAPI / Supabase(Postgres)/ `stripe==11.6.0`(已装)/ `dramatiq`(已装)/ `httpx`(已装)/ `alipay-sdk-python`(**待批准新增**)/ pytest(`uv run pytest`)。

## Global Constraints

- 语言/工具:Python 用 `uv`;测试 `uv run pytest`;严格类型注解,不用裸 `Dict[str,Any]` 作公共契约返回(用 frozen dataclass)。
- 钱包规范单位:**Decimal USD 信用**;CNY 仅在入账边界换算一次,`fx_rate` 快照到订单行。
- 幂等:信用入账一律走 `add_credits_idempotent` RPC,`billing_dedup_key = f"order:{order_id}"`;禁用 20s 时间窗口启发式。
- 三态归一:`paid/failed/cancelled` 只在各网关内从原始状态串派生一次;上层永不 string-match 网关码。
- webhook 失败策略:仅签名错 → 4xx;其余 → 5xx(让对方重试);Stripe 用**原始 body** 验签。
- 不改动现有 Creem 路由/服务(本计划纯**新增**,P5 才删旧)。
- 依赖:新增第三方依赖前必须获用户同意(见 Task 0)。
- 提交粒度:每个 Task 末尾一次 commit;提交信息以 `feat(payments):` / `test(payments):` 开头。

## 4-Plan 拆解(本文件为 Plan 1)

- **Plan 1(本文件,P0–P2)**:后端支付基础层(契约→网关→订单/结算→路由/sweeper)。
- **Plan 2(P3)**:钱包瘦身 + `entitlements.py` shim + 6 调用点切换 + 闸门塌缩 + `credits.py` 并入。
- **Plan 3(P4)**:前端充值改造 + v2 客户端统一 + 订单轮询 + 删订阅 UI。
- **Plan 4(P5–P6)**:feature flag 切换 → 一次性删 Creem/死代码 → DB 去订阅列 → 回归。

执行前请用 `superpowers:using-git-worktrees` 在新分支(建议 `feat/payments-convergence`)隔离工作区。

---

## Task 0: 依赖与配置(前置,需用户同意)

**Files:**
- Modify: `backend/pyproject.toml`(新增 `alipay-sdk-python`)
- Modify: `backend/core/utils/config.py:333`(在 STRIPE/CREEM 段后新增配置项)

**Interfaces:**
- Produces:`config.ALIPAY_APP_ID/ALIPAY_PRIVATE_KEY/ALIPAY_PUBLIC_KEY/ALIPAY_GATEWAY_URL/ALIPAY_SIGN_TYPE`、`config.PAYMENT_PUBLIC_BASE_URL`、`config.USD_CNY_RATE_STATIC`。

> ✅ **已批准**:新增依赖 `alipay-sdk-python`(import 名 `alipay`,即 python-alipay-sdk)用户已同意,直接执行 Step 2。Alipay 网关逻辑只依赖窄 `AlipayClient` Protocol(单测用 fake),真实 SDK 封装在 `alipay_client.py`(Task 8 Step 5)。

- [ ] **Step 1: 新增配置项**

在 `backend/core/utils/config.py` 的 `class Configuration` 内、CREEM 段之后加入:

```python
    # --- Alipay (国内支付) ---
    ALIPAY_APP_ID: Optional[str] = None
    ALIPAY_PRIVATE_KEY: Optional[str] = None          # 应用私钥 PEM
    ALIPAY_PUBLIC_KEY: Optional[str] = None            # 支付宝公钥 PEM(公钥模式)
    ALIPAY_GATEWAY_URL: str = "https://openapi.alipay.com/gateway.do"
    ALIPAY_SIGN_TYPE: str = "RSA2"

    # --- 支付通用 ---
    PAYMENT_PUBLIC_BASE_URL: Optional[str] = None      # 后端公网基址,用于 notify/webhook 回调
    USD_CNY_RATE_STATIC: float = 7                     # 汇率兜底(仅在 payment_settings 无管理员设定值时使用;默认 7)
```

- [ ] **Step 2: (已批准)新增依赖**

```bash
cd backend && uv add "python-alipay-sdk"
```
Expected: `pyproject.toml` 新增该行,`uv.lock` 更新。

- [ ] **Step 3: 验证导入**

Run: `cd backend && uv run python -c "import alipay; import stripe; print('ok')"`
Expected: 打印 `ok`(若 Alipay 依赖未批准,先只验证 `import stripe`)。

- [ ] **Step 4: Commit**

```bash
git add backend/pyproject.toml backend/uv.lock backend/core/utils/config.py
git commit -m "feat(payments): add alipay config + dependency, payment base-url & fx config"
```

---

## Task 1: 支付契约 `payments/contract.py`

**Files:**
- Create: `backend/core/billing/payments/__init__.py`(空)
- Create: `backend/core/billing/payments/contract.py`
- Test: `backend/tests/payments/test_contract.py`

**Interfaces:**
- Produces:`PaymentGatewayId`(StrEnum: ALIPAY/STRIPE)、`Currency`(Literal["CNY","USD"])、`CheckoutResult`、`PaymentNotification`、`PaymentGateway`(Protocol,4 法)、异常 `PaymentGatewayError`/`PaymentGatewayNotConfigured`/`PaymentSignatureError`。

- [ ] **Step 1: 写失败测试**

```python
# backend/tests/payments/test_contract.py
from __future__ import annotations
import dataclasses
from decimal import Decimal
import pytest
from core.billing.payments.contract import (
    PaymentGatewayId, CheckoutResult, PaymentNotification, PaymentGatewayNotConfigured,
)

def test_gateway_id_values():
    assert PaymentGatewayId.ALIPAY == "alipay"
    assert PaymentGatewayId.STRIPE == "stripe"
    assert PaymentGatewayId("alipay") is PaymentGatewayId.ALIPAY

def test_checkout_result_defaults_and_frozen():
    r = CheckoutResult(checkout_url="https://x")
    assert r.qr_payload is None and r.gateway_payment_id is None
    with pytest.raises(dataclasses.FrozenInstanceError):
        r.checkout_url = "y"  # type: ignore[misc]

def test_payment_notification_is_frozen_and_carries_payload():
    n = PaymentNotification(order_id="o1", amount=Decimal("9.9"), currency="CNY",
                            trade_no="t1", gateway_status="TRADE_SUCCESS",
                            paid=True, failed=False, cancelled=False, payload={"k": 1})
    assert n.paid and n.payload == {"k": 1}
    with pytest.raises(dataclasses.FrozenInstanceError):
        n.paid = False  # type: ignore[misc]

def test_not_configured_error_keeps_gateway_id():
    err = PaymentGatewayNotConfigured(PaymentGatewayId.STRIPE)
    assert err.gateway_id == PaymentGatewayId.STRIPE
    assert "stripe" in str(err)
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && uv run pytest tests/payments/test_contract.py -v`
Expected: FAIL — `ModuleNotFoundError: core.billing.payments.contract`

- [ ] **Step 3: 实现契约**

```python
# backend/core/billing/payments/contract.py
from __future__ import annotations
from dataclasses import dataclass, field
from decimal import Decimal
from enum import StrEnum
from typing import Any, Literal, Protocol, runtime_checkable


class PaymentGatewayId(StrEnum):
    ALIPAY = "alipay"
    STRIPE = "stripe"


Currency = Literal["CNY", "USD"]


@dataclass(frozen=True)
class CheckoutResult:
    checkout_url: str
    qr_payload: str | None = None
    qr_code_data_url: str | None = None
    gateway_payment_id: str | None = None


@dataclass(frozen=True)
class PaymentNotification:
    order_id: str
    amount: Decimal
    currency: Currency
    trade_no: str | None
    gateway_status: str
    paid: bool
    failed: bool
    cancelled: bool
    payload: dict[str, Any] = field(default_factory=dict)


class PaymentGatewayError(Exception):
    """Base class for payment-gateway errors."""


class PaymentGatewayNotConfigured(PaymentGatewayError):
    def __init__(self, gateway_id: PaymentGatewayId | str) -> None:
        super().__init__(f"Payment gateway '{gateway_id}' is not configured.")
        self.gateway_id = gateway_id


class PaymentSignatureError(PaymentGatewayError):
    """Raised ONLY when a webhook/notify signature fails verification (→ 4xx, permanent)."""


@runtime_checkable
class PaymentGateway(Protocol):
    gateway_id: PaymentGatewayId

    async def create_order_checkout(
        self, *, order_id: str, account_id: str, amount: Decimal, currency: Currency,
        public_base_url: str, notify_base_url: str | None = None,
        flow: str = "redirect", return_url: str | None = None,
    ) -> CheckoutResult: ...

    async def query_order_status(
        self, *, order_id: str, trade_no: str | None = None,
        gateway_payment_id: str | None = None,
    ) -> PaymentNotification | None: ...

    async def verify_notification(self, params: dict[str, Any]) -> PaymentNotification | None: ...
```

Also create empty `backend/core/billing/payments/__init__.py` and `backend/tests/payments/__init__.py`.

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && uv run pytest tests/payments/test_contract.py -v`
Expected: PASS(4 passed）

- [ ] **Step 5: Commit**

```bash
git add backend/core/billing/payments/__init__.py backend/core/billing/payments/contract.py backend/tests/payments/__init__.py backend/tests/payments/test_contract.py
git commit -m "feat(payments): PaymentGateway contract + normalized DTOs"
```

---

## Task 2: Resolver `payments/resolver.py`

**Files:**
- Create: `backend/core/billing/payments/resolver.py`
- Test: `backend/tests/payments/test_resolver.py`

**Interfaces:**
- Consumes:`contract.PaymentGateway`、`PaymentGatewayId`、`PaymentGatewayNotConfigured`。
- Produces:`PaymentGatewayResolver(gateways: list[PaymentGateway])`,方法 `resolve(gateway_id) -> PaymentGateway`、`available() -> tuple[PaymentGatewayId, ...]`、`has(gateway_id) -> bool`。

- [ ] **Step 1: 写失败测试**(镜像 aip resolver 契约测试)

```python
# backend/tests/payments/test_resolver.py
from __future__ import annotations
import pytest
from core.billing.payments.contract import PaymentGatewayId, PaymentGatewayNotConfigured
from core.billing.payments.resolver import PaymentGatewayResolver

class _FakeGateway:
    def __init__(self, gid): self.gateway_id = gid

def test_resolve_returns_same_instance():
    g = _FakeGateway(PaymentGatewayId.ALIPAY)
    r = PaymentGatewayResolver([g])
    assert r.resolve(PaymentGatewayId.ALIPAY) is g
    assert r.resolve("alipay") is g  # 字符串也可

def test_unregistered_raises():
    r = PaymentGatewayResolver([_FakeGateway(PaymentGatewayId.ALIPAY)])
    with pytest.raises(PaymentGatewayNotConfigured):
        r.resolve(PaymentGatewayId.STRIPE)

def test_empty_resolver_raises_for_any():
    r = PaymentGatewayResolver([])
    assert r.available() == ()
    with pytest.raises(PaymentGatewayNotConfigured):
        r.resolve(PaymentGatewayId.ALIPAY)

def test_last_wins_on_duplicate_ids():
    g1, g2 = _FakeGateway(PaymentGatewayId.STRIPE), _FakeGateway(PaymentGatewayId.STRIPE)
    r = PaymentGatewayResolver([g1, g2])
    assert r.resolve(PaymentGatewayId.STRIPE) is g2

def test_available_and_has():
    r = PaymentGatewayResolver([_FakeGateway(PaymentGatewayId.ALIPAY)])
    assert r.available() == (PaymentGatewayId.ALIPAY,)
    assert r.has(PaymentGatewayId.ALIPAY) and not r.has(PaymentGatewayId.STRIPE)
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && uv run pytest tests/payments/test_resolver.py -v`
Expected: FAIL — `ModuleNotFoundError: core.billing.payments.resolver`

- [ ] **Step 3: 实现**

```python
# backend/core/billing/payments/resolver.py
from __future__ import annotations
from collections.abc import Iterable
from .contract import PaymentGateway, PaymentGatewayId, PaymentGatewayNotConfigured


class PaymentGatewayResolver:
    """纯查表 registry。路由/币种逻辑放在 routing.py(此处保持 dumb)。"""

    def __init__(self, gateways: Iterable[PaymentGateway]) -> None:
        self._by_id: dict[PaymentGatewayId, PaymentGateway] = {}
        for g in gateways:
            self._by_id[PaymentGatewayId(g.gateway_id)] = g  # last-wins

    def resolve(self, gateway_id: PaymentGatewayId | str) -> PaymentGateway:
        gid = PaymentGatewayId(gateway_id)
        try:
            return self._by_id[gid]
        except KeyError as exc:
            raise PaymentGatewayNotConfigured(gid) from exc

    def has(self, gateway_id: PaymentGatewayId | str) -> bool:
        return PaymentGatewayId(gateway_id) in self._by_id

    def available(self) -> tuple[PaymentGatewayId, ...]:
        return tuple(self._by_id.keys())
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && uv run pytest tests/payments/test_resolver.py -v`
Expected: PASS(5 passed）

- [ ] **Step 5: Commit**

```bash
git add backend/core/billing/payments/resolver.py backend/tests/payments/test_resolver.py
git commit -m "feat(payments): capability-gated gateway resolver (registry)"
```

---

## Task 3: 路由 `payments/routing.py`

**Files:**
- Create: `backend/core/billing/payments/routing.py`
- Test: `backend/tests/payments/test_routing.py`

**Interfaces:**
- Consumes:`PaymentGatewayId`。
- Produces:`route_gateway(*, account_region=None, currency_hint=None, accept_language=None, explicit=None) -> PaymentGatewayId`。

- [ ] **Step 1: 写失败测试**

```python
# backend/tests/payments/test_routing.py
from __future__ import annotations
from core.billing.payments.contract import PaymentGatewayId
from core.billing.payments.routing import route_gateway

def test_explicit_overrides_everything():
    assert route_gateway(account_region="US", explicit="alipay") == PaymentGatewayId.ALIPAY

def test_cny_hint_routes_alipay():
    assert route_gateway(currency_hint="CNY") == PaymentGatewayId.ALIPAY

def test_cn_region_routes_alipay():
    assert route_gateway(account_region="CN") == PaymentGatewayId.ALIPAY

def test_zh_locale_routes_alipay():
    assert route_gateway(accept_language="zh-CN,zh;q=0.9") == PaymentGatewayId.ALIPAY

def test_default_routes_stripe():
    assert route_gateway(account_region="US", accept_language="en-US") == PaymentGatewayId.STRIPE
    assert route_gateway() == PaymentGatewayId.STRIPE
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && uv run pytest tests/payments/test_routing.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: 实现**

```python
# backend/core/billing/payments/routing.py
from __future__ import annotations
from .contract import PaymentGatewayId

CN_REGIONS = {"CN", "CHN", "CHINA"}

def route_gateway(
    *, account_region: str | None = None, currency_hint: str | None = None,
    accept_language: str | None = None, explicit: PaymentGatewayId | str | None = None,
) -> PaymentGatewayId:
    if explicit is not None:
        return PaymentGatewayId(explicit)
    if currency_hint and currency_hint.strip().upper() == "CNY":
        return PaymentGatewayId.ALIPAY
    if account_region and account_region.strip().upper() in CN_REGIONS:
        return PaymentGatewayId.ALIPAY
    if accept_language and accept_language.strip().lower().startswith("zh"):
        return PaymentGatewayId.ALIPAY
    return PaymentGatewayId.STRIPE
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && uv run pytest tests/payments/test_routing.py -v`
Expected: PASS(5 passed）

- [ ] **Step 5: Commit**

```bash
git add backend/core/billing/payments/routing.py backend/tests/payments/test_routing.py
git commit -m "feat(payments): geo/currency gateway routing layer"
```

---

## Task 4: 定价单一真源 `pricing.py`(抽出 calculate_token_cost)

**Files:**
- Create: `backend/core/billing/pricing.py`
- Modify: `backend/core/billing/api.py:177-200`(删除本地定义,改为 re-export)
- Modify: `backend/core/billing/billing_integration.py:3`(import 改源)
- Modify: `backend/core/langgraph_engine/billing/billing_guard.py:8`(热路径 import 改源,落地 SPEC §11 解耦)
- Test: `backend/tests/payments/test_pricing.py`

**Interfaces:**
- Produces:`pricing.calculate_token_cost(prompt_tokens:int, completion_tokens:int, model:str) -> Decimal`、常量 `DEFAULT_UNKNOWN_MODEL_COST = Decimal("0.01")`。
- Consumes:`core.ai_models.model_manager`、`config.TOKEN_PRICE_MULTIPLIER`(来自 `core.billing.config`)。

- [ ] **Step 1: 写失败测试**

```python
# backend/tests/payments/test_pricing.py
from __future__ import annotations
from decimal import Decimal
from types import SimpleNamespace
import pytest
from core.billing import pricing

def _fake_model(input_pm, output_pm):
    return SimpleNamespace(pricing=SimpleNamespace(
        input_cost_per_million_tokens=input_pm, output_cost_per_million_tokens=output_pm))

def test_known_model_applies_markup(monkeypatch):
    monkeypatch.setattr(pricing.model_manager, "resolve_model_id", lambda m: m)
    monkeypatch.setattr(pricing.model_manager, "get_model", lambda m: _fake_model(1.0, 2.0))
    # (1M*1/1e6 + 1M*2/1e6) * 1.2 = (1 + 2)*1.2 = 3.6
    cost = pricing.calculate_token_cost(1_000_000, 1_000_000, "x")
    assert cost == Decimal("3.6")

def test_unknown_model_falls_back(monkeypatch):
    monkeypatch.setattr(pricing.model_manager, "resolve_model_id", lambda m: m)
    monkeypatch.setattr(pricing.model_manager, "get_model", lambda m: None)
    assert pricing.calculate_token_cost(100, 100, "unknown") == pricing.DEFAULT_UNKNOWN_MODEL_COST

def test_api_reexports_same_function():
    from core.billing import api
    assert api.calculate_token_cost is pricing.calculate_token_cost
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && uv run pytest tests/payments/test_pricing.py -v`
Expected: FAIL — `ModuleNotFoundError: core.billing.pricing`

- [ ] **Step 3: 实现 + 改接线**

新建 `backend/core/billing/pricing.py`(把 api.py:177-200 的函数原样搬来):

```python
# backend/core/billing/pricing.py
from __future__ import annotations
from decimal import Decimal
from core.ai_models import model_manager
from core.utils.logger import logger
from .config import TOKEN_PRICE_MULTIPLIER

DEFAULT_UNKNOWN_MODEL_COST = Decimal("0.01")

def calculate_token_cost(prompt_tokens: int, completion_tokens: int, model: str) -> Decimal:
    try:
        resolved_model = model_manager.resolve_model_id(model)
        model_obj = model_manager.get_model(resolved_model)
        if model_obj and model_obj.pricing:
            input_cost = Decimal(prompt_tokens) / Decimal("1000000") * Decimal(str(model_obj.pricing.input_cost_per_million_tokens))
            output_cost = Decimal(completion_tokens) / Decimal("1000000") * Decimal(str(model_obj.pricing.output_cost_per_million_tokens))
            return (input_cost + output_cost) * TOKEN_PRICE_MULTIPLIER
        logger.warning(f"[COST_CALC] No pricing for model '{model}' (resolved '{resolved_model}'), default ${DEFAULT_UNKNOWN_MODEL_COST}")
        return DEFAULT_UNKNOWN_MODEL_COST
    except Exception as e:
        logger.error(f"[COST_CALC] Error for model '{model}': {e}")
        return DEFAULT_UNKNOWN_MODEL_COST
```

在 `backend/core/billing/api.py` 删除 177-200 的本地 `calculate_token_cost` 定义,改为(保留 `TOKEN_PRICE_MULTIPLIER` 的现有 import):

```python
from .pricing import calculate_token_cost  # re-export:旧调用方 api.calculate_token_cost 不变
```

在 `backend/core/billing/billing_integration.py:3` 把
`from core.billing.api import calculate_token_cost`
改为
`from core.billing.pricing import calculate_token_cost`
(消除 billing_integration→api 的 HTTP 层依赖)。

同样在 `backend/core/langgraph_engine/billing/billing_guard.py:8`(扣费热路径)把
`from core.billing.api import calculate_token_cost`
改为
`from core.billing.pricing import calculate_token_cost`
(落地 SPEC §11:热路径不再依赖 HTTP 层 `api.py`,只依赖纯定价模块)。

- [ ] **Step 4: 运行确认通过 + 回归**

Run: `cd backend && uv run pytest tests/payments/test_pricing.py tests/test_billing_owner_rbac.py -v`
Expected: PASS(pricing 3 passed;rbac 仍全绿)

并核验热路径已与 api.py 解耦(SPEC §11):
Run: `cd backend && grep -rn "from core.billing.api import calculate_token_cost" core/ --include=*.py`
Expected: **无输出**(`billing_integration.py` 与 `billing_guard.py` 均已改从 `core.billing.pricing` 导入)。

- [ ] **Step 5: Commit**

```bash
git add backend/core/billing/pricing.py backend/core/billing/api.py backend/core/billing/billing_integration.py backend/tests/payments/test_pricing.py
git commit -m "feat(payments): extract calculate_token_cost into pricing.py (single source)"
```

---

## Task 5: 汇率 `payments/fx.py`

**Files:**
- Create: `backend/core/billing/payments/fx.py`
- Test: `backend/tests/payments/test_fx.py`

**Interfaces:**
- Produces:`resolve_usd_cny_rate(*, live=None, cached=None, static=None) -> Decimal`、`cny_to_usd_credits(amount_cny, fx_rate) -> Decimal`、常量 `DEFAULT_USD_CNY_RATE = Decimal("7")`。
- 说明:`resolve_usd_cny_rate` 不做网络抓取;管理员设定值由调用方(Task 11b 的 `settings.get_usd_cny_rate`)作为 `live` 注入,`static` 传 `config.USD_CNY_RATE_STATIC`(默认 7)。

- [ ] **Step 1: 写失败测试**

```python
# backend/tests/payments/test_fx.py
from __future__ import annotations
from decimal import Decimal
from core.billing.payments import fx

def test_prefers_live_then_cached_then_static():
    assert fx.resolve_usd_cny_rate(live=7.1, cached=7.3, static=7.5) == Decimal("7.1")
    assert fx.resolve_usd_cny_rate(live=None, cached=7.3, static=7.5) == Decimal("7.3")
    assert fx.resolve_usd_cny_rate(live=None, cached=None, static=7.5) == Decimal("7.5")

def test_skips_nonpositive_and_falls_back_to_default():
    assert fx.resolve_usd_cny_rate(live=0, cached=-1, static=None) == fx.DEFAULT_USD_CNY_RATE

def test_cny_to_usd_credits_quantizes_to_4dp():
    # 72 CNY / 7.2 = 10.0000
    assert fx.cny_to_usd_credits(72, Decimal("7.2")) == Decimal("10.0000")
    # 30 / 7.2 = 4.1667 (round half up)
    assert fx.cny_to_usd_credits(30, Decimal("7.2")) == Decimal("4.1667")
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && uv run pytest tests/payments/test_fx.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: 实现**

```python
# backend/core/billing/payments/fx.py
from __future__ import annotations
from decimal import Decimal, ROUND_HALF_UP

DEFAULT_USD_CNY_RATE = Decimal("7")

def resolve_usd_cny_rate(*, live=None, cached=None, static=None) -> Decimal:
    for candidate in (live, cached, static, DEFAULT_USD_CNY_RATE):
        if candidate is None:
            continue
        rate = Decimal(str(candidate))
        if rate > 0:
            return rate
    return DEFAULT_USD_CNY_RATE

def cny_to_usd_credits(amount_cny, fx_rate) -> Decimal:
    usd = Decimal(str(amount_cny)) / Decimal(str(fx_rate))
    return usd.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && uv run pytest tests/payments/test_fx.py -v`
Expected: PASS(3 passed）

- [ ] **Step 5: Commit**

```bash
git add backend/core/billing/payments/fx.py backend/tests/payments/test_fx.py
git commit -m "feat(payments): USD/CNY fx resolver + intake conversion"
```

---

## Task 6: 充值目录 `payments/catalog.py`

**Files:**
- Create: `backend/core/billing/payments/catalog.py`
- Test: `backend/tests/payments/test_catalog.py`

**Interfaces:**
- Consumes:`PaymentGatewayId`、`Currency`。
- Produces:`TopupOffer`(frozen: id, gateway, currency, amount:Decimal)、`ResolvedOffer`(frozen: offer_id, gateway, currency, amount, catalog_version, price_snapshot)、`resolve_offer(*, gateway, currency, amount, offer_id=None) -> ResolvedOffer`、异常 `CatalogError`、常量 `CATALOG_VERSION`。

- [ ] **Step 1: 写失败测试**

```python
# backend/tests/payments/test_catalog.py
from __future__ import annotations
from decimal import Decimal
import pytest
from core.billing.payments.contract import PaymentGatewayId
from core.billing.payments import catalog

def test_resolve_known_offer_by_id():
    r = catalog.resolve_offer(gateway=PaymentGatewayId.STRIPE, currency="USD",
                              amount=Decimal("5"), offer_id="usd_5")
    assert r.amount == Decimal("5") and r.offer_id == "usd_5"
    assert r.catalog_version == catalog.CATALOG_VERSION
    assert r.price_snapshot == Decimal("5")

def test_offer_amount_mismatch_rejected():
    with pytest.raises(catalog.CatalogError):
        catalog.resolve_offer(gateway=PaymentGatewayId.STRIPE, currency="USD",
                              amount=Decimal("4.50"), offer_id="usd_5")

def test_custom_amount_in_range_ok():
    r = catalog.resolve_offer(gateway=PaymentGatewayId.ALIPAY, currency="CNY",
                              amount=Decimal("66"), offer_id=None)
    assert r.offer_id == "custom" and r.amount == Decimal("66")

def test_custom_amount_out_of_range_rejected():
    with pytest.raises(catalog.CatalogError):
        catalog.resolve_offer(gateway=PaymentGatewayId.ALIPAY, currency="CNY",
                              amount=Decimal("1"), offer_id=None)  # below min

def test_currency_must_match_gateway():
    with pytest.raises(catalog.CatalogError):
        catalog.resolve_offer(gateway=PaymentGatewayId.STRIPE, currency="CNY",
                              amount=Decimal("5"), offer_id=None)
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && uv run pytest tests/payments/test_catalog.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: 实现**

```python
# backend/core/billing/payments/catalog.py
from __future__ import annotations
from dataclasses import dataclass
from decimal import Decimal
from .contract import Currency, PaymentGatewayId

CATALOG_VERSION = "2026-06-21"

class CatalogError(Exception):
    """充值金额不在目录/自定义区间内,或币种与网关不匹配。"""

@dataclass(frozen=True)
class TopupOffer:
    id: str
    gateway: PaymentGatewayId
    currency: Currency
    amount: Decimal

@dataclass(frozen=True)
class ResolvedOffer:
    offer_id: str
    gateway: PaymentGatewayId
    currency: Currency
    amount: Decimal
    catalog_version: str
    price_snapshot: Decimal

# 网关↔币种约束
_GATEWAY_CURRENCY = {PaymentGatewayId.ALIPAY: "CNY", PaymentGatewayId.STRIPE: "USD"}

ALIPAY_TOPUP_OFFERS = (
    TopupOffer("cny_30", PaymentGatewayId.ALIPAY, "CNY", Decimal("30")),
    TopupOffer("cny_98", PaymentGatewayId.ALIPAY, "CNY", Decimal("98")),
    TopupOffer("cny_298", PaymentGatewayId.ALIPAY, "CNY", Decimal("298")),
)
STRIPE_TOPUP_OFFERS = (
    TopupOffer("usd_5", PaymentGatewayId.STRIPE, "USD", Decimal("5")),
    TopupOffer("usd_15", PaymentGatewayId.STRIPE, "USD", Decimal("15")),
    TopupOffer("usd_50", PaymentGatewayId.STRIPE, "USD", Decimal("50")),
)
_ALL_OFFERS = {o.id: o for o in (*ALIPAY_TOPUP_OFFERS, *STRIPE_TOPUP_OFFERS)}

# 自定义额度边界(按币种)
CUSTOM_MIN = {"CNY": Decimal("10"), "USD": Decimal("2")}
CUSTOM_MAX = {"CNY": Decimal("5000"), "USD": Decimal("1000")}
_AMOUNT_TOLERANCE = Decimal("0.01")

def resolve_offer(*, gateway: PaymentGatewayId, currency: Currency, amount: Decimal,
                  offer_id: str | None = None) -> ResolvedOffer:
    gateway = PaymentGatewayId(gateway)
    if _GATEWAY_CURRENCY[gateway] != currency:
        raise CatalogError(f"Gateway {gateway} requires {_GATEWAY_CURRENCY[gateway]}, got {currency}")
    amount = Decimal(str(amount))

    if offer_id is not None:
        offer = _ALL_OFFERS.get(offer_id)
        if offer is None or offer.gateway != gateway or offer.currency != currency:
            raise CatalogError(f"Unknown offer '{offer_id}' for {gateway}/{currency}")
        if abs(offer.amount - amount) > _AMOUNT_TOLERANCE:
            raise CatalogError(f"Amount {amount} != catalog price {offer.amount} for '{offer_id}'")
        return ResolvedOffer(offer.id, gateway, currency, offer.amount, CATALOG_VERSION, offer.amount)

    if not (CUSTOM_MIN[currency] <= amount <= CUSTOM_MAX[currency]):
        raise CatalogError(f"Custom amount {amount} {currency} out of range "
                           f"[{CUSTOM_MIN[currency]}, {CUSTOM_MAX[currency]}]")
    return ResolvedOffer("custom", gateway, currency, amount, CATALOG_VERSION, amount)
```

> 🔶 目录档位金额为占位示例,P3/前端定稿前与产品对齐(与 §6 / Plan 3 一致)。

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && uv run pytest tests/payments/test_catalog.py -v`
Expected: PASS(5 passed）

- [ ] **Step 5: Commit**

```bash
git add backend/core/billing/payments/catalog.py backend/tests/payments/test_catalog.py
git commit -m "feat(payments): server-authoritative top-up catalog + amount validation"
```

---

## Task 7: Stripe 网关 `payments/gateways/stripe.py`

**Files:**
- Create: `backend/core/billing/payments/gateways/__init__.py`(空)
- Create: `backend/core/billing/payments/gateways/stripe.py`
- Test: `backend/tests/payments/test_stripe_gateway.py`

**Interfaces:**
- Consumes:`contract.*`。构造器 `StripeGateway(*, client, webhook_secret, currency="usd")`,`client` 为可注入的 stripe SDK(默认 `import stripe`)。
- Produces:实现 `PaymentGateway` 的 `StripeGateway`;静态 `_is_signature_error(exc) -> bool`。

- [ ] **Step 1: 写失败测试**(SDK 用 fake)

```python
# backend/tests/payments/test_stripe_gateway.py
from __future__ import annotations
from decimal import Decimal
from types import SimpleNamespace
import pytest
from core.billing.payments.contract import PaymentSignatureError
from core.billing.payments.gateways.stripe import StripeGateway

class _SignatureVerificationError(Exception):  # 名称需与 stripe.error.SignatureVerificationError 一致
    pass

class _FakeStripe:
    def __init__(self):
        self.created = None
        self.error = SimpleNamespace(SignatureVerificationError=_SignatureVerificationError)
        self._event = None
        self.checkout = SimpleNamespace(Session=SimpleNamespace(
            create=self._create, retrieve=self._retrieve))
        self.Webhook = SimpleNamespace(construct_event=self._construct)
    def _create(self, **kwargs):
        self.created = kwargs
        return {"id": "cs_test_1", "url": "https://stripe.test/checkout/cs_test_1"}
    def _retrieve(self, sid):
        return {"id": sid, "payment_status": "paid", "amount_total": 500, "payment_intent": "pi_1"}
    def _construct(self, payload, sig, secret):
        if sig == "bad":
            raise _SignatureVerificationError("bad sig")
        return self._event

async def test_create_checkout_shape():
    fake = _FakeStripe()
    gw = StripeGateway(client=fake, webhook_secret="whsec")
    r = await gw.create_order_checkout(order_id="o1", account_id="a1", amount=Decimal("5"),
                                       currency="USD", public_base_url="https://api.test")
    assert r.checkout_url.endswith("cs_test_1") and r.gateway_payment_id == "cs_test_1"
    c = fake.created
    assert c["mode"] == "payment"
    assert c["client_reference_id"] == "o1"
    assert c["line_items"][0]["price_data"]["unit_amount"] == 500  # $5 → 500 cents
    assert c["idempotency_key"] == "checkout-o1"

@pytest.mark.parametrize("etype,paid,failed,cancelled", [
    ("checkout.session.completed", True, False, False),
    ("checkout.session.async_payment_succeeded", True, False, False),
    ("checkout.session.async_payment_failed", False, True, False),
    ("checkout.session.expired", False, False, True),
])
async def test_normalize_event(etype, paid, failed, cancelled):
    fake = _FakeStripe()
    fake._event = {"type": etype, "data": {"object": {
        "client_reference_id": "o9", "amount_total": 1500, "payment_intent": "pi_9"}}}
    gw = StripeGateway(client=fake, webhook_secret="whsec")
    n = await gw.verify_notification({"raw_body": b"{}", "signature": "good"})
    assert (n.paid, n.failed, n.cancelled) == (paid, failed, cancelled)
    assert n.order_id == "o9" and n.currency == "USD" and n.amount == Decimal("15")

async def test_unhandled_event_returns_none():
    fake = _FakeStripe()
    fake._event = {"type": "charge.refunded", "data": {"object": {}}}
    gw = StripeGateway(client=fake, webhook_secret="whsec")
    assert await gw.verify_notification({"raw_body": b"{}", "signature": "good"}) is None

async def test_signature_error_raises_typed():
    fake = _FakeStripe()
    gw = StripeGateway(client=fake, webhook_secret="whsec")
    with pytest.raises(PaymentSignatureError):
        await gw.verify_notification({"raw_body": b"{}", "signature": "bad"})

async def test_query_order_status_paid():
    fake = _FakeStripe()
    gw = StripeGateway(client=fake, webhook_secret="whsec")
    n = await gw.query_order_status(order_id="o1", gateway_payment_id="cs_test_1")
    assert n.paid and n.amount == Decimal("5") and n.trade_no == "pi_1"
```

> 注:测试用 async 函数。已确认 `pytest-asyncio==0.24.0` 在依赖中、`backend/pytest.ini` 设 `asyncio_mode = auto` 且 `testpaths = tests`——`async def test_*` 自动运行,无需额外标记或配置。

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && uv run pytest tests/payments/test_stripe_gateway.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: 实现**

```python
# backend/core/billing/payments/gateways/stripe.py
from __future__ import annotations
from decimal import Decimal
from typing import Any
from ..contract import (
    CheckoutResult, Currency, PaymentGatewayId, PaymentNotification, PaymentSignatureError,
)

_PAID = {"checkout.session.completed", "checkout.session.async_payment_succeeded"}
_FAILED = {"checkout.session.async_payment_failed"}
_CANCELLED = {"checkout.session.expired"}


class StripeGateway:
    gateway_id = PaymentGatewayId.STRIPE

    def __init__(self, *, client: Any, webhook_secret: str, currency: str = "usd") -> None:
        self._stripe = client
        self._webhook_secret = webhook_secret
        self._currency = currency

    async def create_order_checkout(
        self, *, order_id: str, account_id: str, amount: Decimal, currency: Currency,
        public_base_url: str, notify_base_url: str | None = None,
        flow: str = "redirect", return_url: str | None = None,
    ) -> CheckoutResult:
        unit_amount = int((Decimal(str(amount)) * 100).to_integral_value())
        session = self._stripe.checkout.Session.create(
            mode="payment",
            client_reference_id=order_id,
            success_url=return_url or f"{public_base_url}/billing/success?order_id={order_id}",
            cancel_url=f"{public_base_url}/billing/cancel?order_id={order_id}",
            line_items=[{
                "quantity": 1,
                "price_data": {
                    "currency": self._currency,
                    "unit_amount": unit_amount,
                    "product_data": {"name": f"Credits top-up {order_id}"},
                },
            }],
            metadata={"order_id": order_id, "account_id": account_id},
            idempotency_key=f"checkout-{order_id}",
        )
        return CheckoutResult(checkout_url=session["url"], gateway_payment_id=session["id"])

    async def verify_notification(self, params: dict[str, Any]) -> PaymentNotification | None:
        raw = params.get("raw_body")
        sig = params.get("signature")
        try:
            event = self._stripe.Webhook.construct_event(raw, sig, self._webhook_secret)
        except Exception as exc:  # noqa: BLE001
            if self._is_signature_error(exc):
                raise PaymentSignatureError(str(exc)) from exc
            raise
        return self._normalize_event(event)

    async def query_order_status(
        self, *, order_id: str, trade_no: str | None = None, gateway_payment_id: str | None = None,
    ) -> PaymentNotification | None:
        if not gateway_payment_id:
            return None
        session = self._stripe.checkout.Session.retrieve(gateway_payment_id)
        status = session.get("payment_status")
        return PaymentNotification(
            order_id=order_id, amount=Decimal(session.get("amount_total") or 0) / 100,
            currency="USD", trade_no=session.get("payment_intent"),
            gateway_status=str(status), paid=status == "paid", failed=False, cancelled=False,
            payload=dict(session),
        )

    def _normalize_event(self, event: Any) -> PaymentNotification | None:
        etype = event["type"]
        if etype not in _PAID | _FAILED | _CANCELLED:
            return None
        obj = event["data"]["object"]
        order_id = obj.get("client_reference_id") or (obj.get("metadata") or {}).get("order_id")
        return PaymentNotification(
            order_id=order_id, amount=Decimal(obj.get("amount_total") or 0) / 100,
            currency="USD", trade_no=obj.get("payment_intent") or obj.get("id"),
            gateway_status=etype, paid=etype in _PAID, failed=etype in _FAILED,
            cancelled=etype in _CANCELLED, payload=dict(event),
        )

    @staticmethod
    def _is_signature_error(exc: Exception) -> bool:
        return type(exc).__name__ == "SignatureVerificationError"
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && uv run pytest tests/payments/test_stripe_gateway.py -v`
Expected: PASS(全部 passed）

- [ ] **Step 5: Commit**

```bash
git add backend/core/billing/payments/gateways/__init__.py backend/core/billing/payments/gateways/stripe.py backend/tests/payments/test_stripe_gateway.py
git commit -m "feat(payments): Stripe one-time Checkout gateway + event normalization"
```

---

## Task 8: Alipay 网关 `payments/gateways/alipay.py`

**Files:**
- Create: `backend/core/billing/payments/gateways/alipay.py`(网关逻辑 + `AlipayClient` Protocol)
- Create: `backend/core/billing/payments/gateways/alipay_client.py`(真实 SDK 封装,**依赖 alipay-sdk**)
- Test: `backend/tests/payments/test_alipay_gateway.py`

**Interfaces:**
- Consumes:`contract.*`。构造器 `AlipayGateway(*, client: AlipayClient)`。
- Produces:`AlipayClient`(Protocol: `precreate`/`page_pay`/`query`/`verify`)、实现 `PaymentGateway` 的 `AlipayGateway`;`alipay_client.RealAlipayClient`(SDK 封装)。

- [ ] **Step 1: 写失败测试**(client 用 fake)

```python
# backend/tests/payments/test_alipay_gateway.py
from __future__ import annotations
from decimal import Decimal
import pytest
from core.billing.payments.gateways.alipay import AlipayGateway

class _FakeAlipayClient:
    def __init__(self, *, verify_ok=True, query_status="TRADE_SUCCESS"):
        self.verify_ok = verify_ok
        self.query_status = query_status
        self.precreate_args = None
        self.page_pay_args = None
    def precreate(self, *, out_trade_no, total_amount, subject, notify_url):
        self.precreate_args = dict(out_trade_no=out_trade_no, total_amount=total_amount,
                                   subject=subject, notify_url=notify_url)
        return {"qr_code": f"https://qr.alipay/{out_trade_no}"}
    def page_pay(self, *, out_trade_no, total_amount, subject, notify_url, return_url):
        self.page_pay_args = dict(out_trade_no=out_trade_no, total_amount=total_amount,
                                  notify_url=notify_url, return_url=return_url)
        return f"https://openapi.alipay/pay?biz={out_trade_no}"
    def query(self, *, out_trade_no):
        return {"out_trade_no": out_trade_no, "trade_no": "2026T1",
                "trade_status": self.query_status, "total_amount": "30.00"}
    def verify(self, params):
        return self.verify_ok

async def test_qr_checkout():
    c = _FakeAlipayClient()
    gw = AlipayGateway(client=c)
    r = await gw.create_order_checkout(order_id="o1", account_id="a1", amount=Decimal("30"),
                                       currency="CNY", public_base_url="https://api.test", flow="qr")
    assert r.qr_payload == "https://qr.alipay/o1" and r.gateway_payment_id == "o1"
    assert c.precreate_args["total_amount"] == "30.00"
    assert c.precreate_args["notify_url"] == "https://api.test/billing/notify/alipay"

async def test_redirect_checkout():
    c = _FakeAlipayClient()
    gw = AlipayGateway(client=c)
    r = await gw.create_order_checkout(order_id="o2", account_id="a1", amount=Decimal("98"),
                                       currency="CNY", public_base_url="https://api.test")
    assert r.checkout_url.startswith("https://openapi.alipay/pay")
    assert c.page_pay_args["total_amount"] == "98.00"

async def test_notify_paid_maps_true():
    c = _FakeAlipayClient(verify_ok=True)
    gw = AlipayGateway(client=c)
    n = await gw.verify_notification({"out_trade_no": "o1", "trade_no": "2026T1",
        "trade_status": "TRADE_SUCCESS", "total_amount": "30.00", "sign": "x", "sign_type": "RSA2"})
    assert n.paid and n.currency == "CNY" and n.amount == Decimal("30.00") and n.trade_no == "2026T1"

async def test_notify_bad_signature_returns_none():
    c = _FakeAlipayClient(verify_ok=False)
    gw = AlipayGateway(client=c)
    assert await gw.verify_notification({"out_trade_no": "o1", "trade_status": "TRADE_SUCCESS",
                                         "total_amount": "30.00", "sign": "bad"}) is None

async def test_notify_closed_maps_cancelled():
    c = _FakeAlipayClient(verify_ok=True)
    gw = AlipayGateway(client=c)
    n = await gw.verify_notification({"out_trade_no": "o1", "trade_status": "TRADE_CLOSED",
                                      "total_amount": "30.00", "sign": "x"})
    assert n.cancelled and not n.paid

async def test_query_order_status():
    c = _FakeAlipayClient(query_status="TRADE_SUCCESS")
    gw = AlipayGateway(client=c)
    n = await gw.query_order_status(order_id="o1")
    assert n.paid and n.trade_no == "2026T1" and n.amount == Decimal("30.00")
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && uv run pytest tests/payments/test_alipay_gateway.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: 实现网关 + Protocol**

```python
# backend/core/billing/payments/gateways/alipay.py
from __future__ import annotations
from decimal import Decimal
from typing import Any, Protocol
from ..contract import CheckoutResult, Currency, PaymentGatewayId, PaymentNotification

_PAID_STATUSES = {"TRADE_SUCCESS", "TRADE_FINISHED"}
_CLOSED_STATUSES = {"TRADE_CLOSED"}


class AlipayClient(Protocol):
    def precreate(self, *, out_trade_no: str, total_amount: str, subject: str, notify_url: str) -> dict: ...
    def page_pay(self, *, out_trade_no: str, total_amount: str, subject: str, notify_url: str, return_url: str) -> str: ...
    def query(self, *, out_trade_no: str) -> dict: ...
    def verify(self, params: dict) -> bool: ...


class AlipayGateway:
    gateway_id = PaymentGatewayId.ALIPAY

    def __init__(self, *, client: AlipayClient) -> None:
        self._client = client

    async def create_order_checkout(
        self, *, order_id: str, account_id: str, amount: Decimal, currency: Currency,
        public_base_url: str, notify_base_url: str | None = None,
        flow: str = "redirect", return_url: str | None = None,
    ) -> CheckoutResult:
        notify_url = f"{(notify_base_url or public_base_url).rstrip('/')}/billing/notify/alipay"
        subject = f"Credits top-up {order_id}"
        total = f"{Decimal(str(amount)).quantize(Decimal('0.01'))}"
        if flow == "qr":
            resp = self._client.precreate(out_trade_no=order_id, total_amount=total,
                                          subject=subject, notify_url=notify_url)
            qr = resp.get("qr_code", "")
            return CheckoutResult(checkout_url=qr, qr_payload=qr, gateway_payment_id=order_id)
        url = self._client.page_pay(
            out_trade_no=order_id, total_amount=total, subject=subject, notify_url=notify_url,
            return_url=return_url or f"{public_base_url.rstrip('/')}/billing/success?order_id={order_id}",
        )
        return CheckoutResult(checkout_url=url, gateway_payment_id=order_id)

    async def verify_notification(self, params: dict[str, Any]) -> PaymentNotification | None:
        if not self._client.verify(dict(params)):
            return None
        return self._to_notification(
            order_id=params.get("out_trade_no"), trade_no=params.get("trade_no"),
            status=params.get("trade_status", ""), amount=params.get("total_amount"), payload=params,
        )

    async def query_order_status(
        self, *, order_id: str, trade_no: str | None = None, gateway_payment_id: str | None = None,
    ) -> PaymentNotification | None:
        resp = self._client.query(out_trade_no=order_id)
        status = resp.get("trade_status", "")
        if not status:
            return None
        return self._to_notification(order_id=order_id, trade_no=resp.get("trade_no"),
                                     status=status, amount=resp.get("total_amount"), payload=resp)

    @staticmethod
    def _to_notification(*, order_id, trade_no, status, amount, payload) -> PaymentNotification:
        return PaymentNotification(
            order_id=order_id, amount=Decimal(str(amount or 0)), currency="CNY",
            trade_no=trade_no, gateway_status=status,
            paid=status in _PAID_STATUSES, failed=False, cancelled=status in _CLOSED_STATUSES,
            payload=dict(payload),
        )
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && uv run pytest tests/payments/test_alipay_gateway.py -v`
Expected: PASS(全部 passed）

- [ ] **Step 5: 实现真实 SDK 封装(经 Task 0 依赖同意后)**

```python
# backend/core/billing/payments/gateways/alipay_client.py
from __future__ import annotations
from alipay import AliPay  # python-alipay-sdk
from core.utils.config import config


class RealAlipayClient:
    """alipay-sdk 的窄封装,实现 AlipayClient Protocol。"""

    def __init__(self) -> None:
        self._ali = AliPay(
            appid=config.ALIPAY_APP_ID,
            app_notify_url=None,
            app_private_key_string=config.ALIPAY_PRIVATE_KEY,
            alipay_public_key_string=config.ALIPAY_PUBLIC_KEY,
            sign_type=config.ALIPAY_SIGN_TYPE,
            debug=False,
        )
        self._gateway = config.ALIPAY_GATEWAY_URL

    def precreate(self, *, out_trade_no, total_amount, subject, notify_url) -> dict:
        return self._ali.api_alipay_trade_precreate(
            out_trade_no=out_trade_no, total_amount=total_amount, subject=subject, notify_url=notify_url)

    def page_pay(self, *, out_trade_no, total_amount, subject, notify_url, return_url) -> str:
        query = self._ali.api_alipay_trade_page_pay(
            out_trade_no=out_trade_no, total_amount=total_amount, subject=subject,
            notify_url=notify_url, return_url=return_url)
        return f"{self._gateway}?{query}"

    def query(self, *, out_trade_no) -> dict:
        return self._ali.api_alipay_trade_query(out_trade_no=out_trade_no)

    def verify(self, params: dict) -> bool:
        data = dict(params)
        signature = data.pop("sign", None)
        data.pop("sign_type", None)
        if not signature:
            return False
        return bool(self._ali.verify(data, signature))
```

> 若依赖未批准:跳过 Step 5,在 bootstrap(Task 12)里 Alipay 网关注册保持关闭(能力门控自动缺席),不影响 Stripe 路径与全部单测。

- [ ] **Step 6: Commit**

```bash
git add backend/core/billing/payments/gateways/alipay.py backend/core/billing/payments/gateways/alipay_client.py backend/tests/payments/test_alipay_gateway.py
git commit -m "feat(payments): Alipay gateway (precreate/page-pay/notify) + SDK client wrapper"
```

---

## Task 9: `payment_orders` 表迁移

**Files:**
- Create: `backend/supabase/migrations/20260621090000_payment_orders.sql`
- Test: `backend/tests/payments/test_payment_orders_migration.py`(静态校验迁移文件含必备列/索引/RLS)

**Interfaces:**
- Produces:表 `public.payment_orders`。

- [ ] **Step 1: 写失败测试**(轻量:解析 SQL 文本断言)

```python
# backend/tests/payments/test_payment_orders_migration.py
from __future__ import annotations
from pathlib import Path

_SQL = Path(__file__).resolve().parents[1].parent / "supabase" / "migrations" / "20260621090000_payment_orders.sql"

def test_migration_exists_and_defines_table():
    text = _SQL.read_text(encoding="utf-8")
    assert "create table" in text.lower() and "payment_orders" in text
    for col in ["account_id", "gateway", "status", "pay_currency", "pay_amount",
                "credit_amount_usd", "fx_rate_usd_cny", "catalog_id", "catalog_version",
                "price_snapshot", "gateway_payment_id", "trade_no", "gateway_status",
                "notify_payload", "credited_at", "fulfilled_at", "expires_at"]:
        assert col in text, f"missing column {col}"

def test_migration_has_indexes_and_rls():
    text = _SQL.read_text(encoding="utf-8").lower()
    assert "create index" in text
    assert "enable row level security" in text
    assert "has_role_on_account" in text  # 团队计费可读
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && uv run pytest tests/payments/test_payment_orders_migration.py -v`
Expected: FAIL — 文件不存在

- [ ] **Step 3: 写迁移**

```sql
-- backend/supabase/migrations/20260621090000_payment_orders.sql
BEGIN;

CREATE TABLE IF NOT EXISTS public.payment_orders (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id      UUID NOT NULL REFERENCES basejump.accounts(id) ON DELETE CASCADE,
    gateway         TEXT NOT NULL CHECK (gateway IN ('alipay','stripe')),
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','paid','failed','cancelled','expired')),
    pay_currency    TEXT NOT NULL CHECK (pay_currency IN ('CNY','USD')),
    pay_amount      DECIMAL(18,2) NOT NULL,
    credit_amount_usd DECIMAL(18,4) NOT NULL,
    fx_rate_usd_cny DECIMAL(18,6),
    catalog_id      TEXT NOT NULL,
    catalog_version TEXT NOT NULL,
    price_snapshot  DECIMAL(18,2) NOT NULL,
    gateway_payment_id TEXT,
    trade_no        TEXT,
    gateway_status  TEXT,
    notify_payload  JSONB,
    credited_at     TIMESTAMPTZ,
    fulfilled_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payment_orders_account ON public.payment_orders(account_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_status ON public.payment_orders(status);
CREATE INDEX IF NOT EXISTS idx_payment_orders_gateway_payment_id ON public.payment_orders(gateway_payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_pending ON public.payment_orders(status, created_at)
    WHERE status = 'pending';

ALTER TABLE public.payment_orders ENABLE ROW LEVEL SECURITY;

-- 账户成员可读自己/团队的订单;写入仅 service_role(经 RPC/服务端)
CREATE POLICY payment_orders_select ON public.payment_orders
    FOR SELECT USING (basejump.has_role_on_account(account_id));

COMMIT;
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && uv run pytest tests/payments/test_payment_orders_migration.py -v`
Expected: PASS(2 passed）

- [ ] **Step 5: Commit**

```bash
git add backend/supabase/migrations/20260621090000_payment_orders.sql backend/tests/payments/test_payment_orders_migration.py
git commit -m "feat(payments): payment_orders table migration (RLS + indexes)"
```

---

## Task 10: 订单服务 `payments/orders.py`

**Files:**
- Create: `backend/core/billing/payments/orders.py`(`OrderStore` Protocol + `OrderService` + `InMemoryOrderStore` + `SupabaseOrderStore`)
- Test: `backend/tests/payments/test_orders.py`

**Interfaces:**
- Consumes:`resolver.PaymentGatewayResolver`、`contract.*`、`catalog.resolve_offer`、`fx.cny_to_usd_credits`、`credit_manager`(只用 `add_credits`)。
- Produces:
  - `OrderStore`(Protocol: `insert(order)->dict`、`get(order_id)->dict|None`、`update(order_id, patch)->dict`、`list_pending(*, older_than_seconds, limit)->list[dict]`)
  - `OrderService(*, store, resolver, credit_manager, fx_rate_provider)`,方法 `create_order(...) -> tuple[str, CheckoutResult]`、`settle(notification) -> dict`。`fx_rate_provider` 为 **async** 无参函数 `Callable[[], Awaitable[Decimal]]`(返回当前 USD/CNY 汇率,Task 11b 提供 `settings.get_usd_cny_rate`);`create_order` 内 `await` 它。
  - `InMemoryOrderStore`(测试/参考实现)、`SupabaseOrderStore`(真实实现)

- [ ] **Step 1: 写失败测试**

```python
# backend/tests/payments/test_orders.py
from __future__ import annotations
from decimal import Decimal
import pytest
from core.billing.payments.contract import (
    CheckoutResult, PaymentGatewayId, PaymentNotification)
from core.billing.payments.resolver import PaymentGatewayResolver
from core.billing.payments.orders import OrderService, InMemoryOrderStore

class _FakeGateway:
    def __init__(self, gid): self.gateway_id = gid; self.checkout_calls = []
    async def create_order_checkout(self, **kw):
        self.checkout_calls.append(kw)
        return CheckoutResult(checkout_url="https://pay/x", gateway_payment_id="gp_1")
    async def query_order_status(self, **kw): return None
    async def verify_notification(self, params): return None

class _FakeCreditManager:
    def __init__(self): self.calls = []
    async def add_credits(self, **kw):
        self.calls.append(kw)
        return {"success": True, "transaction_id": "tx_1", "total_balance": 10.0}

async def _fx_seven_two() -> Decimal:
    return Decimal("7.2")

def _svc(gateway):
    return OrderService(
        store=InMemoryOrderStore(),
        resolver=PaymentGatewayResolver([gateway]),
        credit_manager=_FakeCreditManager(),
        fx_rate_provider=_fx_seven_two,   # async 无参 → 返回 Decimal
    )

async def test_create_order_usd_persists_pending_and_calls_gateway():
    gw = _FakeGateway(PaymentGatewayId.STRIPE)
    svc = _svc(gw)
    order_id, checkout = await svc.create_order(
        account_id="a1", gateway_id=PaymentGatewayId.STRIPE, currency="USD",
        amount=Decimal("5"), offer_id="usd_5", public_base_url="https://api.test")
    order = await svc.store.get(order_id)
    assert order["status"] == "pending" and order["credit_amount_usd"] == Decimal("5")
    assert order["fx_rate_usd_cny"] is None and order["gateway_payment_id"] == "gp_1"
    assert checkout.gateway_payment_id == "gp_1"
    assert gw.checkout_calls[0]["amount"] == Decimal("5")

async def test_create_order_cny_converts_via_fx():
    gw = _FakeGateway(PaymentGatewayId.ALIPAY)
    svc = _svc(gw)
    order_id, _ = await svc.create_order(
        account_id="a1", gateway_id=PaymentGatewayId.ALIPAY, currency="CNY",
        amount=Decimal("72"), offer_id=None, public_base_url="https://api.test")
    order = await svc.store.get(order_id)
    assert order["fx_rate_usd_cny"] == Decimal("7.2")
    assert order["credit_amount_usd"] == Decimal("10.0000")  # 72/7.2

async def test_settle_paid_credits_once():
    gw = _FakeGateway(PaymentGatewayId.STRIPE)
    svc = _svc(gw)
    order_id, _ = await svc.create_order(
        account_id="a1", gateway_id=PaymentGatewayId.STRIPE, currency="USD",
        amount=Decimal("5"), offer_id="usd_5", public_base_url="https://api.test")
    notif = PaymentNotification(order_id=order_id, amount=Decimal("5"), currency="USD",
        trade_no="pi_1", gateway_status="checkout.session.completed",
        paid=True, failed=False, cancelled=False, payload={})
    res1 = await svc.settle(notif)
    res2 = await svc.settle(notif)  # 重复通知
    assert res1["status"] == "credited"
    assert res2["status"] == "already_credited"
    assert len(svc.credit_manager.calls) == 1
    assert svc.credit_manager.calls[0]["billing_dedup_key"] == f"order:{order_id}"
    assert svc.credit_manager.calls[0]["is_expiring"] is False
    order = await svc.store.get(order_id)
    assert order["status"] == "paid" and order["credited_at"] is not None

async def test_settle_unknown_order():
    svc = _svc(_FakeGateway(PaymentGatewayId.STRIPE))
    notif = PaymentNotification(order_id="missing", amount=Decimal("5"), currency="USD",
        trade_no=None, gateway_status="x", paid=True, failed=False, cancelled=False, payload={})
    assert (await svc.settle(notif))["status"] == "unknown_order"

async def test_settle_cancelled_marks_status():
    gw = _FakeGateway(PaymentGatewayId.ALIPAY)
    svc = _svc(gw)
    order_id, _ = await svc.create_order(
        account_id="a1", gateway_id=PaymentGatewayId.ALIPAY, currency="CNY",
        amount=Decimal("30"), offer_id="cny_30", public_base_url="https://api.test")
    notif = PaymentNotification(order_id=order_id, amount=Decimal("30"), currency="CNY",
        trade_no=None, gateway_status="TRADE_CLOSED", paid=False, failed=False, cancelled=True, payload={})
    assert (await svc.settle(notif))["status"] == "cancelled"
    assert len(svc.credit_manager.calls) == 0
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && uv run pytest tests/payments/test_orders.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: 实现**

```python
# backend/core/billing/payments/orders.py
from __future__ import annotations
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Awaitable, Callable, Protocol
from uuid import uuid4
from core.utils.logger import logger
from .catalog import resolve_offer
from .contract import CheckoutResult, Currency, PaymentGatewayId, PaymentNotification
from .fx import cny_to_usd_credits
from .resolver import PaymentGatewayResolver


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class OrderStore(Protocol):
    async def insert(self, order: dict) -> dict: ...
    async def get(self, order_id: str) -> dict | None: ...
    async def update(self, order_id: str, patch: dict) -> dict: ...
    async def list_pending(self, *, older_than_seconds: int = 0, limit: int = 100) -> list[dict]: ...


class OrderService:
    def __init__(self, *, store: OrderStore, resolver: PaymentGatewayResolver,
                 credit_manager: Any, fx_rate_provider: Callable[[], Awaitable[Decimal]]) -> None:
        self.store = store                 # 公开:路由/ sweeper 需访问
        self.resolver = resolver           # 公开:webhook 路由需访问
        self.credit_manager = credit_manager
        self._fx_rate_provider = fx_rate_provider
        # 内部方法统一用公开属性 self.store / self.resolver / self.credit_manager

    async def create_order(
        self, *, account_id: str, gateway_id: PaymentGatewayId, currency: Currency,
        amount: Decimal, public_base_url: str, offer_id: str | None = None,
        flow: str = "redirect", return_url: str | None = None, notify_base_url: str | None = None,
    ) -> tuple[str, CheckoutResult]:
        offer = resolve_offer(gateway=gateway_id, currency=currency, amount=amount, offer_id=offer_id)
        if currency == "USD":
            credit_usd = offer.amount
            fx_rate: Decimal | None = None
        else:
            fx_rate = Decimal(str(await self._fx_rate_provider()))
            credit_usd = cny_to_usd_credits(offer.amount, fx_rate)

        order_id = str(uuid4())
        await self.store.insert({
            "id": order_id, "account_id": account_id, "gateway": str(gateway_id),
            "status": "pending", "pay_currency": currency, "pay_amount": offer.amount,
            "credit_amount_usd": credit_usd, "fx_rate_usd_cny": fx_rate,
            "catalog_id": offer.offer_id, "catalog_version": offer.catalog_version,
            "price_snapshot": offer.price_snapshot, "gateway_payment_id": None,
            "trade_no": None, "gateway_status": None, "notify_payload": None,
            "credited_at": None, "fulfilled_at": None, "created_at": _now(), "updated_at": _now(),
        })
        gateway = self.resolver.resolve(gateway_id)
        checkout = await gateway.create_order_checkout(
            order_id=order_id, account_id=account_id, amount=offer.amount, currency=currency,
            public_base_url=public_base_url, notify_base_url=notify_base_url, flow=flow,
            return_url=return_url)
        await self.store.update(order_id, {"gateway_payment_id": checkout.gateway_payment_id})
        return order_id, checkout

    async def settle(self, notification: PaymentNotification) -> dict:
        order = await self.store.get(notification.order_id)
        if order is None:
            return {"status": "unknown_order"}
        if order.get("credited_at"):
            return {"status": "already_credited"}

        if notification.paid:
            res = await self.credit_manager.add_credits(
                account_id=order["account_id"],
                amount=Decimal(str(order["credit_amount_usd"])),
                is_expiring=False, type="purchase",
                description=f"Top-up {order['id']}",
                billing_dedup_key=f"order:{order['id']}",
            )
            if not res.get("success"):
                logger.error(f"[payments] credit add failed for order {order['id']}: {res.get('error')}")
                return {"status": "credit_failed", "error": res.get("error")}
            await self.store.update(order["id"], {
                "status": "paid", "trade_no": notification.trade_no,
                "gateway_status": notification.gateway_status, "notify_payload": notification.payload,
                "credited_at": _now(), "fulfilled_at": _now(), "updated_at": _now()})
            return {"status": "credited", "transaction_id": res.get("transaction_id")}

        if notification.cancelled:
            await self.store.update(order["id"], {"status": "cancelled",
                "gateway_status": notification.gateway_status, "updated_at": _now()})
            return {"status": "cancelled"}
        if notification.failed:
            await self.store.update(order["id"], {"status": "failed",
                "gateway_status": notification.gateway_status, "updated_at": _now()})
            return {"status": "failed"}
        return {"status": "pending"}


class InMemoryOrderStore:
    """测试/参考实现。"""
    def __init__(self) -> None:
        self._rows: dict[str, dict] = {}
    async def insert(self, order: dict) -> dict:
        self._rows[order["id"]] = dict(order); return self._rows[order["id"]]
    async def get(self, order_id: str) -> dict | None:
        row = self._rows.get(order_id); return dict(row) if row else None
    async def update(self, order_id: str, patch: dict) -> dict:
        self._rows[order_id].update(patch); return dict(self._rows[order_id])
    async def list_pending(self, *, older_than_seconds: int = 0, limit: int = 100) -> list[dict]:
        return [dict(r) for r in self._rows.values() if r["status"] == "pending"][:limit]


class SupabaseOrderStore:
    """真实实现:Supabase payment_orders。Decimal 入库转 str 防浮点漂移。"""
    def __init__(self, db) -> None:
        self._db = db
    @staticmethod
    def _ser(order: dict) -> dict:
        out = dict(order)
        for k in ("pay_amount", "credit_amount_usd", "fx_rate_usd_cny", "price_snapshot"):
            if out.get(k) is not None:
                out[k] = str(out[k])
        return out
    async def insert(self, order: dict) -> dict:
        client = await self._db.client
        res = await client.from_("payment_orders").insert(self._ser(order)).execute()
        return res.data[0] if res.data else order
    async def get(self, order_id: str) -> dict | None:
        client = await self._db.client
        res = await client.from_("payment_orders").select("*").eq("id", order_id).limit(1).execute()
        return res.data[0] if res.data else None
    async def update(self, order_id: str, patch: dict) -> dict:
        client = await self._db.client
        res = await client.from_("payment_orders").update(self._ser(patch)).eq("id", order_id).execute()
        return res.data[0] if res.data else {}
    async def list_pending(self, *, older_than_seconds: int = 0, limit: int = 100) -> list[dict]:
        from datetime import timedelta
        client = await self._db.client
        cutoff = (datetime.now(timezone.utc) - timedelta(seconds=older_than_seconds)).isoformat()
        res = (await client.from_("payment_orders").select("*").eq("status", "pending")
               .lte("created_at", cutoff).order("created_at").limit(limit).execute())
        return res.data or []
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && uv run pytest tests/payments/test_orders.py -v`
Expected: PASS(5 passed）

- [ ] **Step 5: Commit**

```bash
git add backend/core/billing/payments/orders.py backend/tests/payments/test_orders.py
git commit -m "feat(payments): OrderService with idempotent settlement (credited_at gate + dedup key)"
```

---

## Task 11: Reconcile sweeper `payments/sweeper.py`

**Files:**
- Create: `backend/core/billing/payments/sweeper.py`
- Test: `backend/tests/payments/test_sweeper.py`

**Interfaces:**
- Consumes:`OrderStore`、`PaymentGatewayResolver`、`OrderService.settle`、`contract.*`。
- Produces:`ReconcileSweeper(*, store, resolver, order_service)`,方法 `run_once(*, older_than_seconds=120, limit=100) -> dict`(返回 `{checked, settled, errors}`)。

- [ ] **Step 1: 写失败测试**

```python
# backend/tests/payments/test_sweeper.py
from __future__ import annotations
from decimal import Decimal
import pytest
from core.billing.payments.contract import PaymentGatewayId, PaymentNotification
from core.billing.payments.resolver import PaymentGatewayResolver
from core.billing.payments.sweeper import ReconcileSweeper

class _Gateway:
    def __init__(self, gid, status_map): self.gateway_id = gid; self._status_map = status_map
    async def query_order_status(self, *, order_id, trade_no=None, gateway_payment_id=None):
        paid = self._status_map.get(order_id)
        if paid is None: return None
        return PaymentNotification(order_id=order_id, amount=Decimal("5"), currency="USD",
            trade_no="t", gateway_status="paid" if paid else "pending",
            paid=paid, failed=False, cancelled=False, payload={})
    async def create_order_checkout(self, **kw): ...
    async def verify_notification(self, params): ...

class _Store:
    def __init__(self, pending, raise_on_list=False):
        self._pending = pending; self._raise = raise_on_list
    async def list_pending(self, *, older_than_seconds=0, limit=100):
        if self._raise: raise RuntimeError("db down")
        return list(self._pending)

class _OrderService:
    def __init__(self): self.settled = []
    async def settle(self, notif):
        self.settled.append(notif.order_id)
        return {"status": "credited"}

def _sweeper(pending, status_map, raise_on_list=False):
    gw = _Gateway(PaymentGatewayId.STRIPE, status_map)
    return ReconcileSweeper(store=_Store(pending, raise_on_list),
                            resolver=PaymentGatewayResolver([gw]),
                            order_service=_OrderService()), gw

async def test_settles_only_paid_orders():
    pending = [{"id": "o1", "gateway": "stripe", "gateway_payment_id": "g1"},
               {"id": "o2", "gateway": "stripe", "gateway_payment_id": "g2"}]
    sw, _ = _sweeper(pending, {"o1": True, "o2": False})
    res = await sw.run_once()
    assert res["checked"] == 2 and res["settled"] == 1 and res["errors"] == 0
    assert sw._order_service.settled == ["o1"]

async def test_query_none_skips():
    pending = [{"id": "o3", "gateway": "stripe", "gateway_payment_id": "g3"}]
    sw, _ = _sweeper(pending, {})  # query 返回 None
    res = await sw.run_once()
    assert res["settled"] == 0 and res["errors"] == 0

async def test_list_failure_does_not_raise():
    sw, _ = _sweeper([], {}, raise_on_list=True)
    res = await sw.run_once()
    assert res == {"checked": 0, "settled": 0, "errors": 1}
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && uv run pytest tests/payments/test_sweeper.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: 实现**

```python
# backend/core/billing/payments/sweeper.py
from __future__ import annotations
from typing import Any
from core.utils.logger import logger
from .contract import PaymentGatewayId
from .orders import OrderService, OrderStore
from .resolver import PaymentGatewayResolver


class ReconcileSweeper:
    def __init__(self, *, store: OrderStore, resolver: PaymentGatewayResolver,
                 order_service: OrderService) -> None:
        self._store = store
        self._resolver = resolver
        self._order_service = order_service

    async def run_once(self, *, older_than_seconds: int = 120, limit: int = 100) -> dict:
        try:
            pending = await self._store.list_pending(older_than_seconds=older_than_seconds, limit=limit)
        except Exception as exc:  # noqa: BLE001
            logger.error(f"[payments.sweeper] list_pending failed: {exc}")
            return {"checked": 0, "settled": 0, "errors": 1}

        settled = errors = 0
        for order in pending:
            try:
                gateway = self._resolver.resolve(PaymentGatewayId(order["gateway"]))
                notif = await gateway.query_order_status(
                    order_id=order["id"], trade_no=order.get("trade_no"),
                    gateway_payment_id=order.get("gateway_payment_id"))
                if notif is None:
                    continue
                res = await self._order_service.settle(notif)
                if res.get("status") == "credited":
                    settled += 1
            except Exception as exc:  # noqa: BLE001
                logger.warning(f"[payments.sweeper] order {order.get('id')} failed: {exc}")
                errors += 1
                continue
        return {"checked": len(pending), "settled": settled, "errors": errors}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && uv run pytest tests/payments/test_sweeper.py -v`
Expected: PASS(3 passed）

- [ ] **Step 5: Commit**

```bash
git add backend/core/billing/payments/sweeper.py backend/tests/payments/test_sweeper.py
git commit -m "feat(payments): reconcile sweeper (self-heals lost webhooks, never double-credits)"
```

---

## Task 11b: 管理员可改汇率 — `payment_settings` 表 + `settings.py` 读取器 + 管理员端点

> 落地决策「汇率管理员可修改,默认 7」。单行 `payment_settings` 表存当前 USD/CNY 汇率;`settings.get_usd_cny_rate`(带 Redis 缓存,回退 `config.USD_CNY_RATE_STATIC`=7)被 bootstrap 的 async `_fx_rate_provider`(Task 12)调用;管理员经 `PUT /admin/billing/fx-rate` 改值(写库 + 失效缓存)。

**Files:**
- Create: `backend/supabase/migrations/20260621093000_payment_settings.sql`
- Create: `backend/core/billing/payments/settings.py`
- Modify: `backend/core/billing/admin.py`(新增 `GET`/`PUT /admin/billing/fx-rate`,对齐既有 `require_admin` 依赖)
- Test: `backend/tests/payments/test_payment_settings.py`、`backend/tests/payments/test_payment_settings_migration.py`

**Interfaces:**
- Consumes:`fx.resolve_usd_cny_rate`、`config.USD_CNY_RATE_STATIC`、`Cache`、`DBConnection`、`admin.require_admin`。
- Produces:`settings.get_usd_cny_rate(db) -> Decimal`(async,缓存 + 回退)、`settings.set_usd_cny_rate(db, rate, updated_by=None) -> Decimal`(async,校验正数 + 写库 + 失效缓存);管理员路由 `GET/PUT /admin/billing/fx-rate`。

- [ ] **Step 1: 写迁移失败测试 + settings 失败测试**

```python
# backend/tests/payments/test_payment_settings_migration.py
from __future__ import annotations
from pathlib import Path

_SQL = (Path(__file__).resolve().parents[1].parent / "supabase" / "migrations"
        / "20260621093000_payment_settings.sql")


def test_migration_creates_single_row_table_default_7():
    low = _SQL.read_text(encoding="utf-8").lower()
    assert "create table" in low and "payment_settings" in low
    assert "usd_cny_rate" in low
    assert "default 7" in low                 # 默认汇率 7
    assert "primary key" in low               # 单行守卫(id boolean primary key)
    assert "enable row level security" in low
```

```python
# backend/tests/payments/test_payment_settings.py
from __future__ import annotations
from decimal import Decimal
import pytest
from core.billing.payments import settings as st


class _Resp:
    def __init__(self, data): self.data = data


class _Query:
    def __init__(self, store): self._store = store; self._patch = None
    def select(self, *a, **k): return self
    def eq(self, *a, **k): return self
    def limit(self, n): return self
    def upsert(self, patch): self._store["upserts"].append(patch); return self
    async def execute(self):
        if self._store["upserts"] and self._store["upserts"][-1] is not None:
            return _Resp([{}])
        return _Resp(self._store["rows"])


class _FakeClient:
    def __init__(self, store): self._store = store
    def from_(self, table): return _Query(self._store)


class _DB:
    def __init__(self, store): self._store = store
    @property
    async def client(self): return _FakeClient(self._store)


@pytest.fixture(autouse=True)
def _patch_cache_config(monkeypatch):
    cache = {}
    async def _get(k): return cache.get(k)
    async def _set(k, v, ttl=None): cache[k] = v
    async def _inv(k): cache.pop(k, None)
    monkeypatch.setattr("core.billing.payments.settings.Cache.get", _get)
    monkeypatch.setattr("core.billing.payments.settings.Cache.set", _set)
    monkeypatch.setattr("core.billing.payments.settings.Cache.invalidate", _inv)
    monkeypatch.setattr("core.billing.payments.settings.config.USD_CNY_RATE_STATIC", 7, raising=False)


async def test_get_rate_reads_admin_value():
    db = _DB({"rows": [{"usd_cny_rate": "7.35"}], "upserts": []})
    assert await st.get_usd_cny_rate(db) == Decimal("7.35")


async def test_get_rate_falls_back_to_default_7():
    db = _DB({"rows": [], "upserts": []})
    assert await st.get_usd_cny_rate(db) == Decimal("7")


async def test_set_rate_rejects_nonpositive():
    db = _DB({"rows": [], "upserts": []})
    with pytest.raises(ValueError):
        await st.set_usd_cny_rate(db, Decimal("0"))


async def test_set_rate_writes_and_returns():
    db = _DB({"rows": [], "upserts": []})
    out = await st.set_usd_cny_rate(db, Decimal("7.1"), updated_by="admin-1")
    assert out == Decimal("7.1")
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && uv run pytest tests/payments/test_payment_settings.py tests/payments/test_payment_settings_migration.py -v`
Expected: FAIL — `ModuleNotFoundError: core.billing.payments.settings` + 迁移文件不存在。

- [ ] **Step 3a: 写迁移**

```sql
-- backend/supabase/migrations/20260621093000_payment_settings.sql
-- 管理员可改的支付设置(当前仅 USD/CNY 汇率,默认 7)。单行表(id 恒 true)。
BEGIN;

CREATE TABLE IF NOT EXISTS public.payment_settings (
    id           BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
    usd_cny_rate DECIMAL(18,6) NOT NULL DEFAULT 7,
    updated_by   UUID,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.payment_settings (id, usd_cny_rate)
VALUES (true, 7)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.payment_settings ENABLE ROW LEVEL SECURITY;

-- 仅 service_role 读写(管理员经服务端 RPC/端点);普通用户无需直读
CREATE POLICY payment_settings_service_role ON public.payment_settings
    FOR ALL USING (auth.role() = 'service_role');

COMMIT;
```

- [ ] **Step 3b: 实现 `settings.py`**

```python
# backend/core/billing/payments/settings.py
from __future__ import annotations
from decimal import Decimal
from core.services.supabase import DBConnection
from core.utils.cache import Cache
from core.utils.config import config
from core.utils.logger import logger
from .fx import resolve_usd_cny_rate

_FX_CACHE_KEY = "payment:usd_cny_rate"


async def get_usd_cny_rate(db: DBConnection) -> Decimal:
    """当前 USD/CNY 汇率:缓存 → payment_settings(管理员设定)→ config 默认(7)。"""
    cached = await Cache.get(_FX_CACHE_KEY)
    if cached is not None:
        return resolve_usd_cny_rate(live=cached, static=config.USD_CNY_RATE_STATIC)

    admin_rate = None
    try:
        client = await db.client
        res = await client.from_('payment_settings').select(
            'usd_cny_rate'
        ).eq('id', True).limit(1).execute()
        if res.data:
            admin_rate = res.data[0].get('usd_cny_rate')
    except Exception as exc:  # noqa: BLE001 — 读失败回退默认,不阻断建单
        logger.warning(f"[payments.fx] payment_settings read failed, using default: {exc}")

    rate = resolve_usd_cny_rate(live=admin_rate, static=config.USD_CNY_RATE_STATIC)
    await Cache.set(_FX_CACHE_KEY, str(rate), ttl=300)
    return rate


async def set_usd_cny_rate(db: DBConnection, rate: Decimal, updated_by: str | None = None) -> Decimal:
    """管理员设定汇率:校验正数 → upsert 单行 → 失效缓存。"""
    rate = Decimal(str(rate))
    if rate <= 0:
        raise ValueError("usd_cny_rate must be positive")
    client = await db.client
    await client.from_('payment_settings').upsert({
        'id': True,
        'usd_cny_rate': str(rate),
        'updated_by': updated_by,
    }).execute()
    await Cache.invalidate(_FX_CACHE_KEY)
    logger.info(f"[payments.fx] usd_cny_rate set to {rate} by {updated_by}")
    return rate
```

- [ ] **Step 3c: 管理员端点(对齐 admin.py 既有 require_admin)**

先 `Read backend/core/billing/admin.py` 顶部确认:`router` 前缀(`/admin/billing`)、`require_admin` 依赖的返回(管理员用户对象/ id)、`Depends` 与 `BaseModel` 已导入。然后在 admin.py 内新增:

```python
from decimal import Decimal
from pydantic import BaseModel
from core.services.supabase import DBConnection
from core.billing.payments.settings import get_usd_cny_rate, set_usd_cny_rate


class SetFxRateRequest(BaseModel):
    usd_cny_rate: Decimal


@router.get("/fx-rate")
async def admin_get_fx_rate(_admin=Depends(require_admin)) -> dict:
    rate = await get_usd_cny_rate(DBConnection())
    return {"usd_cny_rate": float(rate)}


@router.put("/fx-rate")
async def admin_set_fx_rate(request: SetFxRateRequest, admin=Depends(require_admin)) -> dict:
    # admin-id 提取对齐 admin.py 既有写法(如 adjust_user_credits 里 require_admin 的返回);
    # 若 require_admin 返回 dict 用 admin.get("id");返回对象用 getattr(admin, "id", None)。
    updated_by = (admin.get("id") if isinstance(admin, dict) else getattr(admin, "id", None))
    try:
        rate = await set_usd_cny_rate(DBConnection(), request.usd_cny_rate, updated_by=updated_by)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"usd_cny_rate": float(rate)}
```

> `require_admin`/`HTTPException`/`Depends` 已在 admin.py 使用(参考既有 `adjust_user_credits`);若 admin.py 未导入 `HTTPException` 则补 `from fastapi import HTTPException`。本 Step 不改任何既有端点。

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && uv run pytest tests/payments/test_payment_settings.py tests/payments/test_payment_settings_migration.py -v && uv run python -c "import core.billing.admin, core.billing.payments.settings; print('ok')"`
Expected: PASS(get/fallback/set 全绿)+ 打印 `ok`。

- [ ] **Step 5: Commit**

```bash
git add backend/supabase/migrations/20260621093000_payment_settings.sql backend/core/billing/payments/settings.py backend/core/billing/admin.py backend/tests/payments/test_payment_settings.py backend/tests/payments/test_payment_settings_migration.py
git commit -m "feat(payments): admin-editable USD/CNY rate (payment_settings + settings reader + admin endpoint, default 7)"
```

---

## Task 12: 组合根 `payments/bootstrap.py`

**Files:**
- Create: `backend/core/billing/payments/bootstrap.py`
- Test: `backend/tests/payments/test_bootstrap.py`

**Interfaces:**
- Consumes:`config`、`stripe`、`RealAlipayClient`、`StripeGateway`、`AlipayGateway`、`PaymentGatewayResolver`、`OrderService`、`SupabaseOrderStore`、`fx`。
- Produces:`build_resolver() -> PaymentGatewayResolver`(能力门控)、`get_order_service() -> OrderService`(模块级缓存)、`reset_payments_singletons()`(测试用)。

- [ ] **Step 1: 写失败测试**

```python
# backend/tests/payments/test_bootstrap.py
from __future__ import annotations
import pytest
from core.billing.payments import bootstrap
from core.billing.payments.contract import PaymentGatewayId

def test_resolver_gates_on_config(monkeypatch):
    monkeypatch.setattr(bootstrap.config, "STRIPE_SECRET_KEY", "sk", raising=False)
    monkeypatch.setattr(bootstrap.config, "STRIPE_WEBHOOK_SECRET", "wh", raising=False)
    monkeypatch.setattr(bootstrap.config, "ALIPAY_APP_ID", None, raising=False)
    monkeypatch.setattr(bootstrap.config, "ALIPAY_PRIVATE_KEY", None, raising=False)
    bootstrap.reset_payments_singletons()
    r = bootstrap.build_resolver()
    assert r.has(PaymentGatewayId.STRIPE) and not r.has(PaymentGatewayId.ALIPAY)

def test_no_gateways_when_unconfigured(monkeypatch):
    for k in ("STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "ALIPAY_APP_ID", "ALIPAY_PRIVATE_KEY"):
        monkeypatch.setattr(bootstrap.config, k, None, raising=False)
    bootstrap.reset_payments_singletons()
    assert bootstrap.build_resolver().available() == ()
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && uv run pytest tests/payments/test_bootstrap.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: 实现**

```python
# backend/core/billing/payments/bootstrap.py
from __future__ import annotations
from decimal import Decimal
from core.utils.config import config
from core.utils.logger import logger
from core.services.supabase import DBConnection
from core.billing.credit_manager import credit_manager
from .gateways.stripe import StripeGateway
from .orders import OrderService, SupabaseOrderStore
from .resolver import PaymentGatewayResolver
from .settings import get_usd_cny_rate

_order_service: OrderService | None = None


def build_resolver() -> PaymentGatewayResolver:
    gateways = []
    if config.STRIPE_SECRET_KEY and config.STRIPE_WEBHOOK_SECRET:
        import stripe
        stripe.api_key = config.STRIPE_SECRET_KEY
        gateways.append(StripeGateway(client=stripe, webhook_secret=config.STRIPE_WEBHOOK_SECRET))
    if config.ALIPAY_APP_ID and config.ALIPAY_PRIVATE_KEY:
        try:
            from .gateways.alipay import AlipayGateway
            from .gateways.alipay_client import RealAlipayClient
            gateways.append(AlipayGateway(client=RealAlipayClient()))
        except Exception as exc:  # noqa: BLE001 — 依赖未装/配置缺失时优雅缺席
            logger.error(f"[payments] Alipay gateway unavailable: {exc}")
    return PaymentGatewayResolver(gateways)


async def _fx_rate_provider() -> Decimal:
    # 管理员可改的 USD/CNY 汇率(payment_settings,带缓存);无设定值时回退
    # config.USD_CNY_RATE_STATIC(默认 7)。详见 Task 11b settings.get_usd_cny_rate。
    return await get_usd_cny_rate(DBConnection())


def get_order_service() -> OrderService:
    global _order_service
    if _order_service is None:
        _order_service = OrderService(
            store=SupabaseOrderStore(DBConnection()),
            resolver=build_resolver(),
            credit_manager=credit_manager,
            fx_rate_provider=_fx_rate_provider,
        )
    return _order_service


def reset_payments_singletons() -> None:
    global _order_service
    _order_service = None
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && uv run pytest tests/payments/test_bootstrap.py -v`
Expected: PASS(2 passed）

- [ ] **Step 5: Commit**

```bash
git add backend/core/billing/payments/bootstrap.py backend/tests/payments/test_bootstrap.py
git commit -m "feat(payments): capability-gated composition root (resolver + order service)"
```

---

## Task 13: 新路由接线(additive,不动 Creem)

**Files:**
- Modify: `backend/core/billing/api.py`(新增 4 个路由 + imports)
- Test: `backend/tests/payments/test_payment_routes.py`

**Interfaces:**
- Consumes:`bootstrap.get_order_service`、`routing.route_gateway`、`contract.PaymentGatewayId/PaymentSignatureError`、`_get_workspace_owner_account_id`。
- Produces 路由:
  - `POST /billing/orders/checkout`(建单)
  - `GET /billing/orders/{order_id}`(轮询状态)
  - `POST /billing/webhook/stripe`(Stripe webhook,raw body)
  - `POST /billing/notify/alipay`(Alipay 异步通知,form)

- [ ] **Step 1: 写失败测试**(TestClient + 依赖/服务 monkeypatch,镜像现有 rbac 测试风格)

```python
# backend/tests/payments/test_payment_routes.py
from __future__ import annotations
from decimal import Decimal
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from core.billing import api as billing_api
from core.billing.payments.contract import CheckoutResult, PaymentNotification, PaymentGatewayId

async def _owner_account() -> str:
    return "acct-1"

def _client():
    app = FastAPI()
    app.include_router(billing_api.router)
    app.dependency_overrides[billing_api._get_workspace_owner_account_id] = _owner_account
    app.dependency_overrides[billing_api._get_workspace_account_id] = _owner_account
    return TestClient(app)

def test_checkout_creates_order(monkeypatch):
    class _Svc:
        async def create_order(self, **kw):
            assert kw["account_id"] == "acct-1"
            assert kw["gateway_id"] == PaymentGatewayId.STRIPE
            return "ord-1", CheckoutResult(checkout_url="https://pay/x", gateway_payment_id="cs_1")
    monkeypatch.setattr(billing_api, "get_order_service", lambda: _Svc())
    r = _client().post("/billing/orders/checkout", json={
        "currency": "USD", "amount": "5", "offer_id": "usd_5", "gateway": "stripe",
        "public_base_url": "https://api.test"})
    assert r.status_code == 200
    body = r.json()
    assert body["order_id"] == "ord-1" and body["checkout_url"] == "https://pay/x"

def test_get_order_status(monkeypatch):
    class _Store:
        async def get(self, oid): return {"id": oid, "status": "paid", "credit_amount_usd": "5"}
    class _Svc:
        store = _Store()   # 公开属性,与 OrderService.store(Task 10)及路由 .store.get 一致
    monkeypatch.setattr(billing_api, "get_order_service", lambda: _Svc())
    r = _client().get("/billing/orders/ord-1")
    assert r.status_code == 200 and r.json()["status"] == "paid"

def test_stripe_webhook_settles(monkeypatch):
    settled = {}
    class _Gateway:
        async def verify_notification(self, params):
            return PaymentNotification(order_id="ord-1", amount=Decimal("5"), currency="USD",
                trade_no="pi_1", gateway_status="checkout.session.completed",
                paid=True, failed=False, cancelled=False, payload={})
    class _Resolver:
        def resolve(self, gid): return _Gateway()
    class _Svc:
        resolver = _Resolver()
        async def settle(self, notif): settled["id"] = notif.order_id; return {"status": "credited"}
    monkeypatch.setattr(billing_api, "get_order_service", lambda: _Svc())
    r = _client().post("/billing/webhook/stripe", content=b"{}",
                       headers={"stripe-signature": "good"})
    assert r.status_code == 200 and settled["id"] == "ord-1"

def test_stripe_webhook_bad_signature_returns_400(monkeypatch):
    from core.billing.payments.contract import PaymentSignatureError
    class _Gateway:
        async def verify_notification(self, params): raise PaymentSignatureError("bad")
    class _Resolver:
        def resolve(self, gid): return _Gateway()
    class _Svc:
        resolver = _Resolver()
        async def settle(self, notif): ...
    monkeypatch.setattr(billing_api, "get_order_service", lambda: _Svc())
    r = _client().post("/billing/webhook/stripe", content=b"{}",
                       headers={"stripe-signature": "bad"})
    assert r.status_code == 400

def test_alipay_notify_returns_plaintext(monkeypatch):
    class _Gateway:
        async def verify_notification(self, params):
            return PaymentNotification(order_id="ord-2", amount=Decimal("30"), currency="CNY",
                trade_no="t", gateway_status="TRADE_SUCCESS",
                paid=True, failed=False, cancelled=False, payload={})
    class _Resolver:
        def resolve(self, gid): return _Gateway()
    class _Svc:
        resolver = _Resolver()
        async def settle(self, notif): return {"status": "credited"}
    monkeypatch.setattr(billing_api, "get_order_service", lambda: _Svc())
    r = _client().post("/billing/notify/alipay",
                       data={"out_trade_no": "ord-2", "trade_status": "TRADE_SUCCESS", "sign": "x"})
    assert r.status_code == 200 and r.text == "success"
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && uv run pytest tests/payments/test_payment_routes.py -v`
Expected: FAIL — 路由不存在(404)/`AttributeError: get_order_service`

- [ ] **Step 3: 实现路由**

在 `backend/core/billing/api.py` 顶部新增 imports:

```python
from fastapi.responses import PlainTextResponse
from .payments.bootstrap import get_order_service
from .payments.routing import route_gateway
from .payments.contract import PaymentGatewayId, PaymentSignatureError
```

新增请求模型 + 路由(放在现有 Creem 路由附近,不动它们):

```python
class CreateOrderRequest(BaseModel):
    currency: str                       # "CNY" | "USD"
    amount: Decimal
    offer_id: Optional[str] = None
    gateway: Optional[str] = None       # 显式覆盖;否则按地区/币种路由
    public_base_url: Optional[str] = None
    flow: str = "redirect"
    return_url: Optional[str] = None


@router.post("/orders/checkout")
async def create_topup_order(
    request: CreateOrderRequest,
    http_request: Request,
    account_id: str = Depends(_get_workspace_owner_account_id),
) -> Dict:
    gateway_id = route_gateway(
        currency_hint=request.currency,
        accept_language=http_request.headers.get("accept-language"),
        explicit=request.gateway,
    )
    base_url = request.public_base_url or config.PAYMENT_PUBLIC_BASE_URL or config.SITE_URL
    try:
        order_id, checkout = await get_order_service().create_order(
            account_id=account_id, gateway_id=gateway_id, currency=request.currency,  # type: ignore[arg-type]
            amount=request.amount, offer_id=request.offer_id, public_base_url=base_url,
            flow=request.flow, return_url=request.return_url,
            notify_base_url=config.PAYMENT_PUBLIC_BASE_URL,
        )
    except Exception as e:
        logger.error(f"[payments] create order failed: {e}", exc_info=True)
        raise HTTPException(status_code=400, detail=str(e))
    return {"order_id": order_id, "gateway": str(gateway_id),
            "checkout_url": checkout.checkout_url, "qr_payload": checkout.qr_payload,
            "gateway_payment_id": checkout.gateway_payment_id}


@router.get("/orders/{order_id}")
async def get_topup_order(
    order_id: str, account_id: str = Depends(_get_workspace_account_id),
) -> Dict:
    order = await get_order_service().store.get(order_id)
    if not order or order.get("account_id") not in (None, account_id):
        raise HTTPException(status_code=404, detail="Order not found")
    return {"order_id": order_id, "status": order.get("status"),
            "credit_amount_usd": order.get("credit_amount_usd"),
            "credited_at": order.get("credited_at")}


@router.post("/webhook/stripe")
async def stripe_webhook(request: Request):
    raw = await request.body()
    sig = request.headers.get("stripe-signature")
    svc = get_order_service()
    gateway = svc.resolver.resolve(PaymentGatewayId.STRIPE)
    try:
        notif = await gateway.verify_notification({"raw_body": raw, "signature": sig})
    except PaymentSignatureError:
        raise HTTPException(status_code=400, detail="invalid signature")
    if notif is None:
        return {"received": True}
    try:
        await svc.settle(notif)
    except Exception as e:  # 5xx → Stripe 重试,避免"已付未到账"
        logger.error(f"[payments] stripe settle failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="settle failed")
    return {"received": True}


@router.post("/notify/alipay")
async def alipay_notify(request: Request):
    form = await request.form()
    params = {k: v for k, v in form.items()}
    svc = get_order_service()
    gateway = svc.resolver.resolve(PaymentGatewayId.ALIPAY)
    notif = await gateway.verify_notification(params)
    if notif is None:
        return PlainTextResponse("failure")
    try:
        await svc.settle(notif)
    except Exception as e:  # 非 success → Alipay 重试
        logger.error(f"[payments] alipay settle failed: {e}", exc_info=True)
        return PlainTextResponse("failure")
    return PlainTextResponse("success")
```

> 注:webhook/notify 路由与 sweeper 经 `OrderService.store` / `OrderService.resolver`(Task 10 中已是公开属性)访问内部 store 与 resolver。

- [ ] **Step 4: 运行确认通过 + 全量回归**

Run: `cd backend && uv run pytest tests/payments/ tests/test_billing_owner_rbac.py -v`
Expected: PASS(payments 全绿;现有 rbac 不回归)

- [ ] **Step 5: Commit**

```bash
git add backend/core/billing/api.py backend/core/billing/payments/orders.py backend/tests/payments/test_payment_routes.py
git commit -m "feat(payments): add checkout/order-status/stripe-webhook/alipay-notify routes (additive)"
```

---

## Task 14: Sweeper 定时任务接线(Dramatiq)

**Files:**
- Create: `backend/core/billing/payments/sweeper_task.py`(Dramatiq actor + 周期触发)
- Test: `backend/tests/payments/test_sweeper_task.py`

**Interfaces:**
- Consumes:`ReconcileSweeper`、`bootstrap.get_order_service`。
- Produces:`run_reconcile_once_async() -> dict`(可直接 await 的纯逻辑入口)、Dramatiq actor `reconcile_payment_orders`。

- [ ] **Step 1: 写失败测试**(只测纯逻辑入口,不起 broker)

```python
# backend/tests/payments/test_sweeper_task.py
from __future__ import annotations
import pytest
from core.billing.payments import sweeper_task

async def test_run_reconcile_once_async(monkeypatch):
    class _Sweeper:
        async def run_once(self, **kw): return {"checked": 1, "settled": 1, "errors": 0}
    monkeypatch.setattr(sweeper_task, "_build_sweeper", lambda: _Sweeper())
    res = await sweeper_task.run_reconcile_once_async()
    assert res == {"checked": 1, "settled": 1, "errors": 0}
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && uv run pytest tests/payments/test_sweeper_task.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: 实现**

```python
# backend/core/billing/payments/sweeper_task.py
from __future__ import annotations
import asyncio
import dramatiq
from core.utils.logger import logger
from .bootstrap import get_order_service
from .sweeper import ReconcileSweeper


def _build_sweeper() -> ReconcileSweeper:
    svc = get_order_service()
    return ReconcileSweeper(store=svc.store, resolver=svc.resolver, order_service=svc)


async def run_reconcile_once_async() -> dict:
    return await _build_sweeper().run_once()


@dramatiq.actor(queue_name="billing", max_retries=0)
def reconcile_payment_orders() -> None:
    result = asyncio.run(run_reconcile_once_async())
    logger.info(f"[payments.sweeper] reconcile run: {result}")
```

> 周期触发:沿用项目现有的 Dramatiq 周期/cron 机制注册 `reconcile_payment_orders`(每 2–5 分钟一次)。具体注册点在执行时按现有调度配置补;若项目用外部 cron 命中一个内部端点,则改为暴露一个受保护的内部路由调用 `run_reconcile_once_async`。

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && uv run pytest tests/payments/test_sweeper_task.py -v`
Expected: PASS(1 passed）

- [ ] **Step 5: Commit**

```bash
git add backend/core/billing/payments/sweeper_task.py backend/tests/payments/test_sweeper_task.py
git commit -m "feat(payments): dramatiq reconcile sweeper task entrypoint"
```

---

## 验收(Plan 1 完成标准)

- [ ] `cd backend && uv run pytest tests/payments/ -v` 全绿。
- [ ] `cd backend && uv run pytest tests/test_billing_owner_rbac.py tests/test_ws_d_billing_persistence.py -v` 不回归。
- [ ] 现有 Creem 路由/服务**未改动**(本计划纯新增 + 仅 `pricing.py` 抽取的 import 改源)。
- [ ] 新增路由仅在 `STRIPE_*` / `ALIPAY_*` 配置存在时真正可用(能力门控)。
- [ ] 端到端(本地手测,经同意后):配 Stripe 测试密钥 → `POST /billing/orders/checkout`(USD)→ 得 checkout_url → Stripe CLI 触发 `checkout.session.completed` → `/billing/webhook/stripe` → `credit_ledger` 多一条 `purchase` + `payment_orders.status=paid`;重复投递不重复加分;停 webhook 用 sweeper 也能补到账。

---

## 后续(Plan 2–4 摘要)

- **Plan 2(P3)**:`credit_manager` 删 20s 窗口/余额自愈/tier 旁路;新建 `entitlements.py` 顶替 `subscription_service` 的 `get_user_subscription_tier`(统一限额),切换 6 调用点(agent_runs/files/knowledge_base/ai_models.manager/core_utils/payment_service);`billing_integration` 闸门塌缩;`credits.py` 并入 `credit_manager`。
- **Plan 3(P4)**:前端 `lib/api/billing-v2.ts` 统一、定价页→充值页、`/billing/orders/{id}` 轮询、删订阅 UI。
- **Plan 4(P5–P6)**:feature flag 切换 → 删 Creem/死 Stripe/subscription_service/providers/services.billing → `credit_accounts` 去订阅列 + 删 v1 表 → 全量回归。
