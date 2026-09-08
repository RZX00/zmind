# 支付收敛 Plan 2:钱包瘦身 + Entitlements + 闸门塌缩 + credits.py 并入 (P3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Plan 1 已建好干净支付层(`payments/*` + `pricing.py` + `payment_orders`)的基础上,把**钱包引擎瘦身为纯幂等钱包**、用 `entitlements.py` 顶替 `subscription_service.get_user_subscription_tier`(纯预付费统一限额)、把 6 个非计费调用点切到 entitlements、把预运行闸门 `check_model_and_billing_access` 塌缩为「provider_policy + 余额阈值」、并把第二套信用引擎 `core/credits.py`(CreditService)并入 `credit_manager`。本计划**不删** `subscription_service` 本体(留给 Plan 4),只让它变成无人调用。

**Architecture:** 钱包真源唯一化 —— 所有加分走 `add_credits_idempotent` RPC(`billing_dedup_key` 去重 + 行锁),删去 `credit_manager` 里历史遗留的 20s 时间窗口启发式与「余额自愈」补偿逻辑;扣费纯按 expiring→non_expiring 顺序消耗,余额不足直接拒绝,删除 `is_unlimited_tier` 旁路与 tier/subscription_id 读取。功能限额(文件/KB/Agent 数/默认模型)从「tier 驱动」改为「统一额度」:新建 `entitlements.py` 提供与旧 `tier_info` dict **形状兼容**的 shim `get_user_subscription_tier`,恒返回 `name="standard"`,配合在两张限额表里新增 `"standard"` 档。预运行闸门只保留 `provider_policy` 检查(D9)+ 余额 ≥ `MINIMUM_CREDIT_FOR_RUN`(统一阈值)。`core/credits.py` 的「缓存读余额 + welcome bonus」并入 `credit_manager`,调用方改源。

**Tech Stack:** Python 3.11 / FastAPI / Supabase(Postgres)/ `pytest`(`uv run pytest`,`asyncio_mode=auto`)。本计划**无新增第三方依赖**。

## Global Constraints

- 语言/工具:Python 用 `uv`;测试 `cd backend && uv run pytest <path> -v`;严格类型注解,公共契约返回用 frozen dataclass,不用裸 `Dict[str, Any]`。
- 钱包规范单位:**Decimal USD 信用**;双桶不变量 `balance == expiring + non_expiring` 必须成立。
- 幂等:信用入账一律走 `add_credits_idempotent` RPC,`billing_dedup_key`(充值用 `f"order:{order_id}"`,welcome 用 `f"welcome_bonus:{user_id}"`);**禁用 20s 时间窗口启发式**;**禁用余额自愈补偿**(出现漂移应由 RPC/迁移修,不在热路径偷改)。
- 计费门控塌缩(D4):**移除** tier/`get_allowed_models_for_user` 计费门控与 `is_unlimited_tier` 旁路;**保留** `provider_policy` 检查(D9)与余额 ≥ `MINIMUM_CREDIT_FOR_RUN`。
- 纯预付费(D1):无订阅 → 删 `reset_expiring_credits`(月度续费无用);entitlements 返回统一限额,不读 `stripe_subscription_id` / `provider_subscription_id` / `trial_status`。
- 本计划**不删** `subscription_service.py` / `providers/*` / Creem(留给 Plan 4);仅把调用点切到 `entitlements`,使 `subscription_service` 变为无人调用。
- 双桶语义保留:expiring=promo/welcome(带 expiry);non_expiring=充值。
- 提交粒度:每个 Task 末尾一次 commit;提交信息以 `feat(payments):` / `test(payments):` / `refactor(payments):` / `chore(payments):` 开头。

## 4-Plan 拆解(本文件为 Plan 2)

- **Plan 1(P0–P2)**:后端支付基础层(契约→网关→订单/结算→路由/sweeper)。**本计划前置依赖**:`add_credits_idempotent` 路径、`payment_orders`、`OrderService.settle` 经 `credit_manager.add_credits(...)` 入账。
- **Plan 2(本文件,P3)**:钱包瘦身 + `entitlements.py` shim + 6 调用点切换 + 闸门塌缩 + `credits.py` 并入。
- **Plan 3(P4)**:前端充值改造 + v2 客户端统一 + 订单轮询 + 删订阅 UI。
- **Plan 4(P5–P6)**:feature flag 切换 → 一次性删 Creem/`subscription_service`/`providers`/死代码 → DB 去订阅列 → 回归。

执行前请用 `superpowers:using-git-worktrees` 在 Plan 1 分支(`feat/payments-convergence`)上继续。开 Edit 前先 `git fetch && git log origin/main --oneline -10` 确认本计划改动未被别的会话先做。

---

## Task 1: `credit_manager.add_credits` 瘦身(删 20s 窗口 + 余额自愈)

**Files:**
- Modify: `backend/core/billing/credit_manager.py:57-157`(删除非幂等回退分支,保留 `add_credits_idempotent` 路径)
- Modify: `backend/core/billing/credit_manager.py:1-9`(清理无用 import)
- Test: `backend/tests/payments/test_credit_manager_slim.py`

**Interfaces:**
- Consumes:`add_credits_idempotent` RPC(签名见 ANCHORS)、`Cache.invalidate`。
- Produces:`CreditManager.add_credits(account_id, amount, is_expiring, description, expires_at, type, billing_dedup_key) -> Dict`,**要求传 `billing_dedup_key`**;无 key 时返回 `{'success': False, 'error': 'billing_dedup_key required'}`。

- [ ] **Step 1: 写失败测试**

```python
# backend/tests/payments/test_credit_manager_slim.py
from __future__ import annotations
from decimal import Decimal
import pytest
from core.billing.credit_manager import CreditManager


class _FakeRpc:
    def __init__(self, row): self._row = row
    async def execute(self):
        class _R: pass
        r = _R(); r.data = [self._row]; return r


class _FakeClient:
    def __init__(self, row): self._row = row; self.rpc_calls = []; self.table_calls = []
    def rpc(self, name, params):
        self.rpc_calls.append((name, params)); return _FakeRpc(self._row)
    def from_(self, *a, **k):
        self.table_calls.append(a)
        raise AssertionError("add_credits must NOT touch credit_accounts/credit_ledger directly")


class _DB:
    def __init__(self, client): self._client = client
    @property
    async def client(self): return self._client


def _cm(row):
    cm = CreditManager.__new__(CreditManager)
    cm.db = _DB(_FakeClient(row))
    return cm


@pytest.fixture(autouse=True)
def _patch_cache(monkeypatch):
    async def _noop(*a, **k): return None
    monkeypatch.setattr("core.billing.credit_manager.Cache.invalidate", _noop)


async def test_add_credits_routes_through_rpc():
    row = {"success": True, "duplicate": False, "expiring_credits": 0,
           "non_expiring_credits": 5, "new_balance": 5, "transaction_id": "tx_1"}
    cm = _cm(row)
    res = await cm.add_credits(account_id="a1", amount=Decimal("5"), is_expiring=False,
                               description="Top-up o1", type="purchase",
                               billing_dedup_key="order:o1")
    assert res["success"] and res["total_balance"] == 5.0 and res["transaction_id"] == "tx_1"
    client = await cm.db.client
    assert client.rpc_calls[0][0] == "add_credits_idempotent"
    assert client.rpc_calls[0][1]["p_billing_dedup_key"] == "order:o1"


async def test_add_credits_reports_duplicate():
    row = {"success": True, "duplicate": True, "expiring_credits": 0,
           "non_expiring_credits": 5, "new_balance": 5, "transaction_id": "tx_1"}
    res = await _cm(row).add_credits(account_id="a1", amount=Decimal("5"),
                                     is_expiring=False, billing_dedup_key="order:o1")
    assert res["success"] and res["duplicate_prevented"] is True


async def test_add_credits_requires_dedup_key():
    res = await _cm({}).add_credits(account_id="a1", amount=Decimal("5"), is_expiring=False)
    assert res["success"] is False and "billing_dedup_key" in res["error"]
```

> 注:`_patch_cache` 用一个 `async def _noop` 顶替 `Cache.invalidate`,让实现里的 `await Cache.invalidate(...)` 可正常 await。`test_add_credits_requires_dedup_key` 走早返回分支,不触达 client / cache。

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && uv run pytest tests/payments/test_credit_manager_slim.py -v`
Expected: FAIL — `test_add_credits_requires_dedup_key` 报 `AssertionError`(当前实现无 key 时会落到直写 `credit_accounts` 的 20s 回退分支,`_FakeClient.from_` 抛 `AssertionError`,而非返回 `success=False`)。

- [ ] **Step 3: 最小实现 —— 重写 `add_credits`**

把 `backend/core/billing/credit_manager.py` 的 `add_credits`(当前 16-157 行)整体替换为下面版本(只保留 RPC 路径):

```python
    async def add_credits(
        self,
        account_id: str,
        amount: Decimal,
        is_expiring: bool = True,
        description: str = "Credit added",
        expires_at: Optional[datetime] = None,
        type: Optional[str] = None,
        billing_dedup_key: Optional[str] = None
    ) -> Dict:
        if not billing_dedup_key:
            logger.error(f"[CREDITS] add_credits called without billing_dedup_key for {account_id}")
            return {'success': False, 'error': 'billing_dedup_key required'}

        client = await self.db.client
        amount = Decimal(str(amount))

        rpc_result = await client.rpc('add_credits_idempotent', {
            'p_account_id': account_id,
            'p_amount': str(amount),
            'p_type': type,
            'p_description': description,
            'p_is_expiring': is_expiring,
            'p_expires_at': expires_at.isoformat() if expires_at else None,
            'p_billing_dedup_key': billing_dedup_key
        }).execute()
        row = rpc_result.data[0] if rpc_result.data else {}
        if not row.get('success'):
            return {'success': False, 'error': row.get('error') or 'Failed to add credits'}

        await Cache.invalidate(f"credit_balance:{account_id}")
        await Cache.invalidate(f"credit_summary:{account_id}")

        return {
            'success': True,
            'duplicate_prevented': bool(row.get('duplicate', False)),
            'expiring_credits': float(row.get('expiring_credits') or 0),
            'non_expiring_credits': float(row.get('non_expiring_credits') or 0),
            'total_balance': float(row.get('new_balance') or 0),
            'transaction_id': row.get('transaction_id')
        }
```

> ⚠️ **本 Task 不动 `timedelta` import**:`reset_expiring_credits`(`credit_manager.py:328`)仍在用 `timedelta`,要等 Task 3 把它塌缩为 no-op 后才无引用。若现在删 import,Task 1→Task 3 之间该方法被 Creem webhook 调用会抛 `NameError`。`timedelta` 的移除放到 Task 3 与最后一处用法一起做。本 Task 只改 `add_credits` 方法体,import 段保持 `from datetime import datetime, timezone, timedelta` 不变。

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && uv run pytest tests/payments/test_credit_manager_slim.py -v`
Expected: PASS(3 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/core/billing/credit_manager.py backend/tests/payments/test_credit_manager_slim.py
git commit -m "refactor(payments): slim add_credits to idempotent RPC only (drop 20s window + self-heal)"
```

---

## Task 2: `credit_manager.use_credits` 瘦身(删 unlimited 旁路 + tier/subscription 读取 + 余额自愈)

**Files:**
- Modify: `backend/core/billing/credit_manager.py:159-291`(精简 `use_credits`)
- Modify: `backend/core/billing/credit_manager.py:9`(删 `from .config import is_unlimited_tier`)
- Test: `backend/tests/payments/test_credit_manager_use.py`

**Interfaces:**
- Consumes:`credit_accounts`(只读 `expiring_credits, non_expiring_credits, balance, daily_login_remaining`)、`RecordUsageUseCase`、`Cache.invalidate`。
- Produces:`use_credits(account_id, amount, description, thread_id, message_id, extra_metadata) -> Dict`;扣费顺序 expiring→non_expiring;不足返回 `{'success': False, 'error': 'Insufficient credits', ...}`;不再返回 `unlimited`。

- [ ] **Step 1: 写失败测试**

```python
# backend/tests/payments/test_credit_manager_use.py
from __future__ import annotations
from decimal import Decimal
import pytest
from core.billing.credit_manager import CreditManager


class _Resp:
    def __init__(self, data): self.data = data


class _Query:
    def __init__(self, store, table): self._store = store; self._table = table; self._patch = None
    def select(self, *a, **k):
        if a:
            self._store["selects"].append(a[0])
        return self
    def eq(self, *a, **k): return self
    def update(self, patch): self._patch = patch; return self
    async def execute(self):
        if self._patch is not None:
            self._store["updates"].append(self._patch); return _Resp([{}])
        return _Resp(self._store["rows"])


class _FakeClient:
    def __init__(self, store): self._store = store
    def from_(self, table): return _Query(self._store, table)


class _DB:
    def __init__(self, client): self._client = client
    @property
    async def client(self): return self._client


def _cm(rows):
    store = {"rows": rows, "updates": [], "selects": []}
    cm = CreditManager.__new__(CreditManager)
    cm.db = _DB(_FakeClient(store))
    return cm, store


@pytest.fixture(autouse=True)
def _patch_io(monkeypatch):
    async def _noop(*a, **k): return None
    monkeypatch.setattr("core.billing.credit_manager.Cache.invalidate", _noop)

    class _UC:
        def __init__(self, *a, **k): ...
        async def execute(self, **k): return None
    monkeypatch.setattr("core.billing.credit_manager.RecordUsageUseCase", _UC)
    monkeypatch.setattr("core.billing.credit_manager.SupabaseBillingRepository",
                        lambda *a, **k: object())


async def test_deducts_expiring_first_then_non_expiring():
    cm, store = _cm([{"expiring_credits": 3, "non_expiring_credits": 10,
                      "balance": 13, "daily_login_remaining": 0}])
    res = await cm.use_credits(account_id="a1", amount=Decimal("5"), description="x")
    assert res["success"] and res["from_expiring"] == 3.0 and res["from_non_expiring"] == 2.0
    assert res["new_total"] == 8.0
    assert "unlimited" not in res
    assert store["updates"][0]["expiring_credits"] == 0.0
    assert store["updates"][0]["non_expiring_credits"] == 8.0


async def test_insufficient_credits_rejected():
    cm, _ = _cm([{"expiring_credits": 1, "non_expiring_credits": 1,
                  "balance": 2, "daily_login_remaining": 0}])
    res = await cm.use_credits(account_id="a1", amount=Decimal("5"), description="x")
    assert res["success"] is False and res["error"] == "Insufficient credits"
    assert res["required"] == 5.0 and res["available"] == 2.0


async def test_no_account_rejected():
    cm, _ = _cm([])
    res = await cm.use_credits(account_id="a1", amount=Decimal("1"), description="x")
    assert res["success"] is False and res["error"] == "No credit account found"


async def test_does_not_select_tier_or_subscription_columns():
    # 旧实现 select('... tier, daily_login_remaining, provider_subscription_id, stripe_subscription_id');
    # 新实现只 select expiring/non_expiring/balance/daily_login_remaining。
    cm, store = _cm([{"expiring_credits": 0, "non_expiring_credits": 5,
                      "balance": 5, "daily_login_remaining": 0}])
    res = await cm.use_credits(account_id="a1", amount=Decimal("5"), description="x")
    assert res["success"] and res["from_non_expiring"] == 5.0
    assert "unlimited" not in res
    selected = " ".join(store["selects"])
    assert "tier" not in selected
    assert "subscription_id" not in selected
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && uv run pytest tests/payments/test_credit_manager_use.py -v`
Expected: FAIL — `test_does_not_select_tier_or_subscription_columns` 报 `AssertionError`:当前 `use_credits` 的 `select('expiring_credits, non_expiring_credits, balance, tier, daily_login_remaining, provider_subscription_id, stripe_subscription_id')`(`credit_manager.py:170-172`)仍含 `tier`/`subscription_id`,被 fake 捕获到 `store["selects"]` 后断言失败。(其余 3 个 deduct/insufficient/no-account 测试在旧实现下亦可能通过,本失败用例锁定瘦身契约。)

- [ ] **Step 3: 最小实现 —— 重写 `use_credits`**

把 `use_credits`(当前 159-291 行)整体替换为:

```python
    async def use_credits(
        self,
        account_id: str,
        amount: Decimal,
        description: Optional[str] = None,
        thread_id: Optional[str] = None,
        message_id: Optional[str] = None,
        extra_metadata: Optional[dict] = None,
    ) -> Dict:
        client = await self.db.client
        amount = Decimal(str(amount))

        result = await client.from_('credit_accounts').select(
            'expiring_credits, non_expiring_credits, balance, daily_login_remaining'
        ).eq('account_id', account_id).execute()

        if not result.data:
            return {
                'success': False,
                'error': 'No credit account found',
                'required': float(amount),
                'available': 0,
            }

        current = result.data[0]
        current_expiring = Decimal(str(current.get('expiring_credits', 0)))
        current_non_expiring = Decimal(str(current.get('non_expiring_credits', 0)))
        current_total = Decimal(str(current.get('balance', 0)))
        current_daily_login_remaining = Decimal(str(current.get('daily_login_remaining', 0) or 0))

        if current_total < amount:
            return {
                'success': False,
                'error': 'Insufficient credits',
                'required': float(amount),
                'available': float(current_total),
            }

        if current_expiring >= amount:
            amount_from_expiring = amount
            amount_from_non_expiring = Decimal('0')
        else:
            amount_from_expiring = current_expiring
            amount_from_non_expiring = amount - current_expiring

        new_expiring = current_expiring - amount_from_expiring
        new_non_expiring = current_non_expiring - amount_from_non_expiring
        new_total = new_expiring + new_non_expiring
        from_daily_login = min(current_daily_login_remaining, amount_from_non_expiring)
        new_daily_login_remaining = max(Decimal('0'), current_daily_login_remaining - from_daily_login)

        await client.from_('credit_accounts').update({
            'expiring_credits': float(new_expiring),
            'non_expiring_credits': float(new_non_expiring),
            'balance': float(new_total),
            'daily_login_remaining': float(new_daily_login_remaining),
            'updated_at': datetime.now(timezone.utc).isoformat()
        }).eq('account_id', account_id).execute()

        metadata = {
            'thread_id': thread_id,
            'message_id': message_id,
            'from_expiring': float(amount_from_expiring),
            'from_non_expiring': float(amount_from_non_expiring),
            'from_daily_login': float(from_daily_login),
        }
        if extra_metadata:
            try:
                metadata.update(extra_metadata)
            except Exception:
                pass

        ledger_entry = {
            'amount': float(-amount),
            'balance_after': float(new_total),
            'type': 'usage',
            'description': description,
            'reference_id': thread_id or message_id,
            'metadata': metadata,
        }
        use_case = RecordUsageUseCase(SupabaseBillingRepository(self.db))
        await use_case.execute(
            account_id=account_id,
            ledger_entry=ledger_entry,
            subscription_id=None,
            actor_id=account_id,
        )

        await Cache.invalidate(f"credit_balance:{account_id}")

        return {
            'success': True,
            'amount_deducted': float(amount),
            'from_expiring': float(amount_from_expiring),
            'from_non_expiring': float(amount_from_non_expiring),
            'new_expiring': float(new_expiring),
            'new_non_expiring': float(new_non_expiring),
            'new_total': float(new_total)
        }
```

并删除文件顶部 `from .config import is_unlimited_tier`(整行)。

> 说明:`RecordUsageUseCase.execute(..., subscription_id=...)` 保留参数兼容,纯预付费下恒传 `None`(保留 DDD/outbox,D8)。

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && uv run pytest tests/payments/test_credit_manager_use.py -v`
Expected: PASS(4 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/core/billing/credit_manager.py backend/tests/payments/test_credit_manager_use.py
git commit -m "refactor(payments): slim use_credits (drop unlimited bypass + tier/subscription reads + self-heal)"
```

---

## Task 3: 把 `credit_manager.reset_expiring_credits` 改为惰性 no-op(无订阅续费)

> ⚠️ **不能物理删除**:`reset_expiring_credits` 仍有 3 个外部调用方 —— `core/billing/creem_webhook_service.py:160,200` 与 `core/billing/webhook_service.py:745`(均为月度续费 webhook)。这些文件按收敛设计 §"P5–P6 删除清单"在 **Plan 4** 才随 Creem/Stripe-订阅-webhook 一并删除。本计划**不删 Creem**(Global Constraints),故 Plan 2 只把该方法**塌缩为惰性 no-op**(D1:纯预付费无月度续费),物理删除连同 3 个调用方留 Plan 4。返回形状保持 `webhook_service.py:751-753` 读取的 key(`success/new_expiring/non_expiring/total_balance`)不变,避免 KeyError。

**Files:**
- Modify: `backend/core/billing/credit_manager.py:293-354`(`reset_expiring_credits` 方法体整体替换为惰性 no-op)
- Test: `backend/tests/payments/test_credit_manager_no_reset.py`

**Interfaces:**
- Produces:`CreditManager.reset_expiring_credits(account_id, new_credits, description="...") -> Dict`:**不写库**,恒返回 `{'success': False, 'skipped': True, 'reason': 'prepaid_no_renewal', 'new_expiring': 0.0, 'non_expiring': 0.0, 'total_balance': 0.0}`。

- [ ] **Step 0: 核对调用方(确认仅剩待删的 Creem/订阅 webhook)**

Run: `cd backend && grep -rn "reset_expiring_credits" core/ knowledge_base/ api.py --include=*.py | grep -v "def reset_expiring_credits"`
Expected: 仅命中 `core/billing/creem_webhook_service.py:160`、`:200`、`core/billing/webhook_service.py:745`(三处月度续费 webhook,Plan 4 随 Creem/订阅 webhook 删)。若出现其它(非 Creem/非订阅 webhook)调用方,先迁移再继续。

- [ ] **Step 1: 写失败测试**

```python
# backend/tests/payments/test_credit_manager_no_reset.py
from __future__ import annotations
from decimal import Decimal
import pytest
from core.billing.credit_manager import CreditManager


class _FakeClient:
    def from_(self, *a, **k):
        raise AssertionError("reset_expiring_credits must be inert (no DB writes under prepaid / D1)")


class _DB:
    def __init__(self, c): self._c = c
    @property
    async def client(self): return self._c


def _cm():
    cm = CreditManager.__new__(CreditManager)
    cm.db = _DB(_FakeClient())
    return cm


async def test_reset_expiring_credits_is_inert_noop():
    res = await _cm().reset_expiring_credits(
        account_id="a1", new_credits=Decimal("20"), description="Monthly renewal")
    assert res["success"] is False
    assert res["skipped"] is True and res["reason"] == "prepaid_no_renewal"
    # 续费调用方(webhook_service.py:751-753)读取的 key 必须存在,避免 KeyError
    for key in ("new_expiring", "non_expiring", "total_balance"):
        assert key in res
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && uv run pytest tests/payments/test_credit_manager_no_reset.py -v`
Expected: FAIL — `AssertionError`:当前实现会 `await client.from_('credit_accounts')...`(`credit_manager.py:301`),触发 `_FakeClient.from_` 的 `AssertionError`(写库),而非返回惰性结果。

- [ ] **Step 3: 最小实现 —— 方法体替换为 no-op**

把 `backend/core/billing/credit_manager.py` 的 `reset_expiring_credits`(当前 293-354 行)整体替换为:

```python
    async def reset_expiring_credits(
        self,
        account_id: str,
        new_credits: Decimal,
        description: str = "Monthly credit renewal"
    ) -> Dict:
        # D1 纯预付费:无订阅 → 无月度续费。保留方法签名仅为兼容尚存的
        # Creem/订阅 webhook 调用方(Plan 4 随 Creem 一并删除);此处不写库。
        logger.info(
            f"[RENEWAL] reset_expiring_credits is a no-op under prepaid (D1) for {account_id}; "
            f"requested new_credits={new_credits}, description='{description}'"
        )
        return {
            'success': False,
            'skipped': True,
            'reason': 'prepaid_no_renewal',
            'new_expiring': 0.0,
            'non_expiring': 0.0,
            'total_balance': 0.0,
        }
```

替换后,`timedelta` 在 `credit_manager.py` 中已无任何用法(旧实现仅 `reset_expiring_credits:328` 用过)。此时一并把顶部 import 收窄:`from datetime import datetime, timezone, timedelta` → `from datetime import datetime, timezone`(`use_credits`/`add_credits` 仍用 `datetime`/`timezone`)。

Run: `cd backend && grep -n "timedelta" core/billing/credit_manager.py`
Expected: 无输出(import 与用法都已移除)。

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && uv run pytest tests/payments/test_credit_manager_no_reset.py tests/payments/test_credit_manager_slim.py tests/payments/test_credit_manager_use.py -v`
Expected: PASS(全绿)

- [ ] **Step 5: 续费 webhook import 冒烟(不破坏 Creem 路径)**

Run: `cd backend && uv run python -c "import core.billing.creem_webhook_service, core.billing.webhook_service; print('webhook-imports-ok')"`
Expected: 打印 `webhook-imports-ok`(方法仍在 → 调用方导入无碍)。

- [ ] **Step 6: Commit**

```bash
git add backend/core/billing/credit_manager.py backend/tests/payments/test_credit_manager_no_reset.py
git commit -m "refactor(payments): make reset_expiring_credits inert no-op under prepaid (physical delete deferred to Plan 4)"
```

---

## Task 4: 新建 `entitlements.py`(统一限额 + 兼容 shim)

**Files:**
- Create: `backend/core/billing/entitlements.py`
- Modify: `backend/core/utils/config.py:467`(给 `AGENT_LIMITS` 加 `'standard'` 档)
- Modify: `backend/core/billing/config.py`(给 `FILE_STORAGE_LIMITS` 加 `'standard'` 档)
- Test: `backend/tests/payments/test_entitlements.py`

**Interfaces:**
- Consumes:`get_storage_limits`、`config.AGENT_LIMITS`。
- Produces:
  - `Entitlements`(frozen dataclass: `tier_name:str, project_limit:int, agent_limit:int, file_size_limit_mb:int, total_storage_limit_mb:int, can_purchase_credits:bool, is_paid:bool`)。
  - `get_account_entitlements(account_id: str) -> Entitlements`(纯预付费下恒返回统一档,**不读** tier/subscription)。
  - 兼容 shim `get_user_subscription_tier(account_id: str) -> dict`,返回与旧 `tier_info` 兼容形状:`{'name', 'display_name', 'credits', 'can_purchase_credits', 'models', 'project_limit', 'is_trial'}`,其中 `name="standard"`。
  - 常量 `UNIFIED_TIER_NAME = "standard"`。

> 设计依据(已核验 6 调用点的真实读取):files/kb 用 `tier_info["name"]` 喂 `get_storage_limits(name)`;`core_utils.py` 用 `tier_info['name']` 喂 `config.AGENT_LIMITS[name]`;`ai_models/manager.py` 判 `name not in ('free','none')`;`payment_service.py` 读 `can_purchase_credits` / `name`。因此 shim 只需返回 `name="standard"`(配合两张限额表新增 `"standard"` 档),其余字段填稳定值即可全部兼容。`models` 字段保留为 `None`(旧调用点不读它)。

- [ ] **Step 1: 写失败测试**

```python
# backend/tests/payments/test_entitlements.py
from __future__ import annotations
import pytest
from core.billing import entitlements as ent
from core.billing.config import get_storage_limits


async def test_get_account_entitlements_unified():
    e = await ent.get_account_entitlements("acct-1")
    assert e.tier_name == "standard"
    assert e.is_paid is True and e.can_purchase_credits is True
    assert e.agent_limit >= 1 and e.project_limit >= 1
    # 统一档不依赖账户内容:任意 id 同结果
    e2 = await ent.get_account_entitlements("acct-2")
    assert e == e2


async def test_shim_shape_compatible():
    info = await ent.get_user_subscription_tier("acct-1")
    for key in ("name", "display_name", "credits", "can_purchase_credits",
                "project_limit", "is_trial"):
        assert key in info, f"missing {key}"
    assert info["name"] == "standard"
    assert info["is_trial"] is False


def test_storage_limits_has_standard():
    limits = get_storage_limits("standard")
    # standard 必须解析到非默认(none)的统一档
    none_limits = get_storage_limits("none")
    assert limits.max_total_bytes >= none_limits.max_total_bytes


def test_agent_limits_has_standard():
    from core.utils.config import config
    assert "standard" in config.AGENT_LIMITS
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && uv run pytest tests/payments/test_entitlements.py -v`
Expected: FAIL — `ModuleNotFoundError: core.billing.entitlements`

- [ ] **Step 3a: 给两张限额表加 `standard` 档**

在 `backend/core/utils/config.py` 的 `AGENT_LIMITS` 字典(467 行起)内,`'free': 2,` 之后新增一行:

```python
        'standard': 100,
```

在 `backend/core/billing/config.py` 的 `FILE_STORAGE_LIMITS` 字典内,`'free': ...` 那一项之后新增(沿用 Pro 档量级):

```python
    # Unified prepaid tier
    'standard': StorageLimit(max_total_bytes=1 * _GB, max_file_bytes=50 * _MB),
```

- [ ] **Step 3b: 实现 `entitlements.py`**

```python
# backend/core/billing/entitlements.py
from __future__ import annotations
from dataclasses import dataclass
from typing import Optional
from core.utils.config import config
from .config import get_storage_limits

UNIFIED_TIER_NAME = "standard"
_MB = 1024 * 1024


@dataclass(frozen=True)
class Entitlements:
    """纯预付费(D1/D4)下的统一功能限额。不再随 tier/订阅变化。"""
    tier_name: str
    project_limit: int
    agent_limit: int
    file_size_limit_mb: int
    total_storage_limit_mb: int
    can_purchase_credits: bool
    is_paid: bool


def _build_unified() -> Entitlements:
    storage = get_storage_limits(UNIFIED_TIER_NAME)
    agent_limit = config.AGENT_LIMITS.get(UNIFIED_TIER_NAME, config.AGENT_LIMITS.get("free", 2))
    return Entitlements(
        tier_name=UNIFIED_TIER_NAME,
        project_limit=agent_limit,                 # 项目与 Agent 数同档(统一限额)
        agent_limit=agent_limit,
        file_size_limit_mb=storage.max_file_bytes // _MB,
        total_storage_limit_mb=storage.max_total_bytes // _MB,
        can_purchase_credits=True,
        is_paid=True,
    )


async def get_account_entitlements(account_id: str) -> Entitlements:
    # 纯预付费:全员统一限额,不读 tier/subscription/trial。
    # account_id 入参保留以便未来按"是否充过值"分档(本计划全员同额)。
    return _build_unified()


async def get_user_subscription_tier(account_id: str) -> dict:
    """兼容 shim:形状对齐旧 subscription_service.get_user_subscription_tier。

    旧形状: {name, display_name, credits, can_purchase_credits, models, project_limit, is_trial}
    """
    e = await get_account_entitlements(account_id)
    return {
        "name": e.tier_name,
        "display_name": "Standard",
        "credits": 0.0,                # 纯预付费无月度 credits 概念;旧调用点不依赖具体值
        "can_purchase_credits": e.can_purchase_credits,
        "models": None,                # 旧调用点不读 models(模型门控已移除,D4)
        "project_limit": e.project_limit,
        "is_trial": False,
    }
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && uv run pytest tests/payments/test_entitlements.py -v`
Expected: PASS(4 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/core/billing/entitlements.py backend/core/utils/config.py backend/core/billing/config.py backend/tests/payments/test_entitlements.py
git commit -m "feat(payments): entitlements.py unified prepaid limits + compat shim (+ standard limit tier)"
```

---

## Task 5: 切换 6 个调用点到 `entitlements`

> 本 Task 把 **6 个非订阅/非 Creem 调用点**从 `subscription_service` 切到 `entitlements`,逐处给真实 before/after。
>
> ⚠️ **范围限定**:`subscription_service` 还被一批 **Creem/Stripe-订阅** 代码引用,这些**本计划不动**(留 Plan 4 随 Creem 删):`core/billing/api.py`(Creem 订阅端点 + tier 读:行 23/240/242/276/279/328/510/748/1256/1257/1262)、`core/billing/webhook_service.py:266-267`(订阅 webhook)、`core/billing/creem_subscription_service.py`、`core/billing/__init__.py:18,38`(导出)。因此本 Task 之后,`subscription_service` 的**外部引用**只应在「6 调用点 + `billing_integration`(Task 6 处理)」中消失,**不应**期望全局零引用 —— 全局零引用是 Plan 4 的验收。

**Files:**
- Modify: `backend/core/agent_runs.py:26, 170`
- Modify: `backend/core/files/api.py:13, 227, 402, 581`
- Modify: `backend/knowledge_base/api.py:45`(import 行另定位,见 Step)
- Modify: `backend/core/ai_models/manager.py:194-200`
- Modify: `backend/core/core_utils.py:736-737`
- Modify: `backend/core/billing/payment_service.py:20-21`
- Test: 复用 `backend/tests/payments/test_entitlements.py` + 静态 grep 回归校验。

**Interfaces:**
- Consumes:`entitlements.get_account_entitlements` / `entitlements.get_user_subscription_tier`。

- [ ] **Step 1: agent_runs.py(allowed_models 旁路移除)**

`agent_runs.py:170` 当前用 `subscription_service.get_allowed_models_for_user(...)` 拿 allowed_models 再喂 `provider_policy_service.pick_default_model`。模型门控已移除(D4),allowed 应为「provider policy 已启用的所有模型」。

Before(`agent_runs.py:170`):
```python
            allowed_model_ids = set(await subscription_service.get_allowed_models_for_user(account_id, client))
```

After(`model_manager` 已在 `agent_runs.py:33` 模块级导入,直接用;`policy` 在本函数 `agent_runs.py:159` 已取得):
```python
            all_models = model_manager.list_available_models(include_disabled=False)
            enabled_providers = set(policy.enabled_providers)
            allowed_model_ids = {
                m["id"] for m in all_models
                if m.get("id") and str(m.get("provider") or "").strip().lower() in enabled_providers
            }
```

> `list_available_models(include_disabled=False)` 返回 `List[Dict]`,每项含 `"id"` 与 `"provider"`(字符串,见 `manager.format_model_info`)。`pick_default_model(policy=policy, allowed_model_ids=...)` 的入参契约不变(仍是 model id 的 set)。

并删除 `agent_runs.py:26` 的 `from core.billing.subscription_service import subscription_service`(已确认该文件内无其他 `subscription_service` 引用 —— 仅 26 行 import + 170 行调用两处)。

Run: `cd backend && grep -n "subscription_service" core/agent_runs.py`
Expected: 无输出(删干净)。

- [ ] **Step 2: files/api.py(3 处 tier_info)**

Before(`files/api.py:13`):
```python
from core.billing.subscription_service import subscription_service
```
After:
```python
from core.billing import entitlements
```

Before(出现 3 次,`files/api.py:227 / 402 / 581`):
```python
    tier_info = await subscription_service.get_user_subscription_tier(account_id)
    limits = get_storage_limits(tier_info["name"])
```
After(3 处同样替换):
```python
    tier_info = await entitlements.get_user_subscription_tier(account_id)
    limits = get_storage_limits(tier_info["name"])
```

> `tier_info["name"]` 现为 `"standard"`,经 Task 4 新增的 `FILE_STORAGE_LIMITS["standard"]` 解析到 1GB/50MB 统一档。`files/api.py:589` 的 `tier_name=tier_info["name"]` 响应字段无需改(自然变为 `"standard"`)。

Run: `cd backend && grep -n "subscription_service" core/files/api.py`
Expected: 无输出。

- [ ] **Step 3: knowledge_base/api.py(KB 文件限额)**

先定位 import 行:
Run: `cd backend && grep -n "subscription_service\|from core.billing" knowledge_base/api.py`

把该文件中的:
```python
from core.billing.subscription_service import subscription_service
```
改为:
```python
from core.billing import entitlements
```

Before(`knowledge_base/api.py:45`):
```python
        tier_info = await subscription_service.get_user_subscription_tier(account_id)
        limits = get_storage_limits(tier_info["name"])
```
After:
```python
        tier_info = await entitlements.get_user_subscription_tier(account_id)
        limits = get_storage_limits(tier_info["name"])
```

Run: `cd backend && grep -n "subscription_service" knowledge_base/api.py`
Expected: 无输出。

- [ ] **Step 4: ai_models/manager.py(默认模型档判定)**

Before(`ai_models/manager.py:194-200`):
```python
            from core.billing.subscription_service import subscription_service

            tier_info = await subscription_service.get_user_subscription_tier(user_id)
            is_paid_tier = tier_info.get('name') not in ('free', 'none')

            if is_paid_tier:
```
After:
```python
            from core.billing import entitlements

            ent = await entitlements.get_account_entitlements(user_id)
            is_paid_tier = ent.is_paid

            if is_paid_tier:
```

> 纯预付费下 `is_paid` 恒 `True` → 默认返回 `DEFAULT_PREMIUM_MODEL`(D4:模型不再 tier 门控,所有人可用全部模型,默认给 premium 合理)。

Run: `cd backend && grep -n "subscription_service" core/ai_models/manager.py`
Expected: 无输出。

- [ ] **Step 5: core_utils.py(Agent 数限额)**

Before(`core_utils.py:736-738`):
```python
            from core.billing import subscription_service
            tier_info = await subscription_service.get_user_subscription_tier(account_id)
            tier_name = tier_info['name']
```
After:
```python
            from core.billing import entitlements
            tier_info = await entitlements.get_user_subscription_tier(account_id)
            tier_name = tier_info['name']
```

> 后续 `agent_limit = config.AGENT_LIMITS.get(tier_name, config.AGENT_LIMITS['free'])`(744 行)中 `tier_name="standard"` 命中 Task 4 新增的 `AGENT_LIMITS["standard"]=100`,逻辑无需改。

Run: `cd backend && grep -n "subscription_service" core/core_utils.py`
Expected: 无输出。

- [ ] **Step 6: payment_service.py(切默认 shim 源)**

> `payment_service.py` 整体(Creem 充值)将在 Plan 4 删除;本计划仅把它默认拿到的 `get_user_subscription_tier_func` 切到 entitlements,使 `subscription_service` 不再被它引用。

Before(`payment_service.py:19-21`):
```python
        if get_user_subscription_tier_func is None:
            from .subscription_service import subscription_service
            get_user_subscription_tier_func = subscription_service.get_user_subscription_tier
```
After:
```python
        if get_user_subscription_tier_func is None:
            from . import entitlements
            get_user_subscription_tier_func = entitlements.get_user_subscription_tier
```

Run: `cd backend && grep -n "subscription_service" core/billing/payment_service.py`
Expected: 无输出。

- [ ] **Step 7: 静态回归校验(确认 6 个目标文件已切净)**

Run: `cd backend && grep -rn "subscription_service\b" core/agent_runs.py core/files/api.py knowledge_base/api.py core/ai_models/manager.py core/core_utils.py core/billing/payment_service.py`
Expected: **无输出**(6 个目标文件全部切净)。

> 说明:全局仍会有 `subscription_service` 引用 —— `core/billing/billing_integration.py`(Task 6 处理)+ Creem/订阅相关的 `core/billing/api.py` / `webhook_service.py` / `creem_subscription_service.py` / `__init__.py`(**本计划不动**,Plan 4 随 Creem 删)。全局零引用是 **Plan 4** 验收,不在本 Task 范围。

- [ ] **Step 8: import 冒烟回归**

Run: `cd backend && uv run python -c "import core.agent_runs, core.files.api, knowledge_base.api, core.ai_models.manager, core.core_utils, core.billing.payment_service; print('imports-ok')"`
Expected: 打印 `imports-ok`(无 ImportError)。

- [ ] **Step 9: Commit**

```bash
git add backend/core/agent_runs.py backend/core/files/api.py backend/knowledge_base/api.py backend/core/ai_models/manager.py backend/core/core_utils.py backend/core/billing/payment_service.py
git commit -m "refactor(payments): switch 6 call sites from subscription_service to entitlements"
```

---

## Task 6: 闸门塌缩 `billing_integration.check_model_and_billing_access` + 删 `deduct_usage`

**Files:**
- Modify: `backend/core/billing/billing_integration.py:1-9`(import 清理)
- Modify: `backend/core/billing/billing_integration.py:12-27`(`check_and_reserve_credits` 删 unlimited + 统一阈值)
- Modify: `backend/core/billing/billing_integration.py:29-96`(删 `deduct_usage`)
- Modify: `backend/core/billing/billing_integration.py:98-178`(`check_model_and_billing_access` 塌缩)
- Test: `backend/tests/payments/test_billing_gate.py`

**Interfaces:**
- Consumes:`credit_manager.get_balance`、`provider_policy_service`、`model_manager`、`config.MINIMUM_CREDIT_FOR_RUN`。
- Produces:`check_model_and_billing_access(account_id, model_name, client) -> Tuple[bool, str, Dict]`,仅做 provider_policy + 余额阈值;`check_and_reserve_credits(...)` 用 `MINIMUM_CREDIT_FOR_RUN` 统一阈值;`BillingIntegration` 不再有 `deduct_usage`。

- [ ] **Step 0: 确认 `deduct_usage` 零调用**

Run: `cd backend && grep -rn "deduct_usage" core/ knowledge_base/ api.py --include=*.py | grep -v "def deduct_usage"`
Expected: 无输出(零调用方,可安全删)。若有,先迁移调用方到 `credit_manager.use_credits` 或 `billing_guard.deduct_once` 再继续。

- [ ] **Step 1: 写失败测试**

```python
# backend/tests/payments/test_billing_gate.py
from __future__ import annotations
from decimal import Decimal
import pytest
from core.billing.billing_integration import BillingIntegration
from core.billing import billing_integration as bi


class _Model:
    def __init__(self, provider): self.provider = provider


class _Provider:
    def __init__(self, value): self.value = value


@pytest.fixture(autouse=True)
def _force_prod(monkeypatch):
    from core.utils.config import EnvMode
    monkeypatch.setattr(bi.config, "ENV_MODE", EnvMode.PRODUCTION, raising=False)


def _patch_models(monkeypatch, provider_value):
    # 重写在函数内 `from core.ai_models import model_manager`,故 patch 模块属性即可被拾取
    class _MM:
        @staticmethod
        def resolve_model_id(m): return m
        @staticmethod
        def get_model(m): return _Model(_Provider(provider_value))
    import core.ai_models as aim
    monkeypatch.setattr(aim, "model_manager", _MM())


def test_deduct_usage_removed():
    assert not hasattr(BillingIntegration, "deduct_usage")


async def test_provider_disabled_blocks(monkeypatch):
    _patch_models(monkeypatch, "openai")

    class _Policy:
        enabled_providers = ["anthropic"]

    class _PPS:
        async def get_policy(self, account_id, client=None): return _Policy()
    monkeypatch.setattr(bi, "_load_provider_policy_service", lambda: _PPS(), raising=False)

    async def _bal(account_id): return {"total": 100.0}
    monkeypatch.setattr(bi.credit_manager, "get_balance", _bal)

    ok, msg, ctx = await BillingIntegration.check_model_and_billing_access("a1", "openai/gpt-x")
    assert ok is False and ctx["error_type"] == "model_access_denied"


async def test_insufficient_balance_blocks(monkeypatch):
    _patch_models(monkeypatch, "anthropic")

    class _Policy:
        enabled_providers = ["anthropic"]

    class _PPS:
        async def get_policy(self, account_id, client=None): return _Policy()
    monkeypatch.setattr(bi, "_load_provider_policy_service", lambda: _PPS(), raising=False)

    async def _bal(account_id): return {"total": 0.0}
    monkeypatch.setattr(bi.credit_manager, "get_balance", _bal)

    ok, msg, ctx = await BillingIntegration.check_model_and_billing_access("a1", "anthropic/claude")
    assert ok is False and ctx["error_type"] == "insufficient_credits"


async def test_allows_when_enabled_and_funded(monkeypatch):
    _patch_models(monkeypatch, "anthropic")

    class _Policy:
        enabled_providers = ["anthropic"]

    class _PPS:
        async def get_policy(self, account_id, client=None): return _Policy()
    monkeypatch.setattr(bi, "_load_provider_policy_service", lambda: _PPS(), raising=False)

    async def _bal(account_id): return {"total": 5.0}
    monkeypatch.setattr(bi.credit_manager, "get_balance", _bal)

    ok, msg, ctx = await BillingIntegration.check_model_and_billing_access("a1", "anthropic/claude")
    assert ok is True and "local_mode" not in ctx
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && uv run pytest tests/payments/test_billing_gate.py -v`
Expected: FAIL — `test_deduct_usage_removed` 失败(方法仍在);其余因 `_load_provider_policy_service` 不存在 / 旧实现仍调 `subscription_service` 而失败。

- [ ] **Step 3: 最小实现 —— 重写 billing_integration.py**

把 `backend/core/billing/billing_integration.py` 整体替换为(保留 `check_and_reserve_credits` 公共签名,删 `deduct_usage`,塌缩 `check_model_and_billing_access`,新增可 monkeypatch 的 `_load_provider_policy_service` 间接层):

```python
from decimal import Decimal
from typing import Optional, Dict, Tuple
from core.billing.credit_manager import credit_manager
from core.billing.config import MINIMUM_CREDIT_FOR_RUN
from core.utils.config import config, EnvMode
from core.utils.logger import logger


def _load_provider_policy_service():
    from core.billing.provider_policy_service import provider_policy_service
    return provider_policy_service


class BillingIntegration:
    @staticmethod
    async def check_and_reserve_credits(account_id: str, estimated_tokens: int = 10000) -> Tuple[bool, str, Optional[str]]:
        if config.ENV_MODE == EnvMode.LOCAL:
            return True, "Local mode", None

        balance_info = await credit_manager.get_balance(account_id)
        balance = Decimal(str(balance_info.get('total', 0)))

        if balance < MINIMUM_CREDIT_FOR_RUN:
            return False, (
                f"Insufficient credits. Balance: ${balance:.2f}, "
                f"Required: >= ${MINIMUM_CREDIT_FOR_RUN}"
            ), None

        return True, f"Credits available: ${balance:.2f}", None

    @staticmethod
    async def check_model_and_billing_access(
        account_id: str,
        model_name: str,
        client=None
    ) -> Tuple[bool, str, Dict]:
        """Provider-policy 检查(D9)+ 余额阈值。模型/tier/unlimited 门控已移除(D4)。"""
        if config.ENV_MODE == EnvMode.LOCAL:
            logger.debug("Local development mode - skipping billing and model access checks")
            return True, "Local development mode", {"local_mode": True}

        try:
            from core.ai_models import model_manager
            from core.ai_models.provider_policy import provider_display_name

            resolved_model = model_manager.resolve_model_id(model_name) or model_name
            model_obj = model_manager.get_model(resolved_model)
            provider_id = None
            if model_obj and model_obj.provider:
                provider_id = model_obj.provider.value
            elif "/" in resolved_model:
                provider_id = resolved_model.split("/", 1)[0].strip().lower()

            if provider_id:
                provider_policy_service = _load_provider_policy_service()
                policy = await provider_policy_service.get_policy(account_id, client=client)
                enabled_providers = set(policy.enabled_providers)
                if provider_id not in enabled_providers:
                    return False, (
                        f"Provider '{provider_display_name(provider_id)}' is disabled "
                        f"in your AI provider settings."
                    ), {
                        "error_type": "model_access_denied",
                        "disabled_provider": provider_id,
                        "enabled_providers": sorted(enabled_providers),
                    }

            can_run, message, reservation_id = await BillingIntegration.check_and_reserve_credits(account_id)
            if not can_run:
                return False, f"Billing check failed: {message}", {
                    "error_type": "insufficient_credits"
                }

            return True, "Access granted", {"reservation_id": reservation_id}

        except Exception as e:
            logger.error(f"Error in billing check for user {account_id}: {e}")
            return False, f"Error checking access: {str(e)}", {"error_type": "system_error"}


billing_integration = BillingIntegration()
```

> 注:删去了 `calculate_token_cost` import(随 `deduct_usage` 一并移除,Plan 1 Task 4 已把该函数迁到 `pricing.py`)与 `is_unlimited_tier` import;扣费热路径走 `billing_guard.deduct_once`(独立模块,不在本文件)。`check_model_and_billing_access` 返回的 `context_info` 不再含 `tier_info`,且 `model_access_denied` 分支不再含 `allowed_models`(改含 `enabled_providers`)。**已核两处真实调用方**(`agent_runs.py:438`、`agent_runs.py:1274`):二者都用 `context.get("allowed_models", [])`(带 `[]` 默认),字段缺失不会 KeyError——D4 下模型不再按 tier 门控,该列表本就退化为「provider policy 启用的模型」,返回空列表语义正确。无调用方读 `tier_info`。

- [ ] **Step 3b: 确认下游不依赖被删字段(回归核对)**

Run: `cd backend && grep -rn "check_model_and_billing_access" core/ --include=*.py | grep -v "billing_integration.py"`
Expected: 仅命中 `core/agent_runs.py`(注释行 24 + 调用点 427/1266)。
再核两处调用点的失败分支:
Run: `cd backend && grep -n 'context.get("tier_info"\|context.get("allowed_models"\|context\["tier_info"\]\|context\["allowed_models"\]' core/agent_runs.py`
Expected: 仅出现 `context.get("allowed_models", [])`(438/1274,带默认值,安全);不得出现任何 `context["tier_info"]` / `context.get("tier_info")` 的无默认读取。若发现读 `tier_info`,改为 `await entitlements.get_user_subscription_tier(account_id)`。

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && uv run pytest tests/payments/test_billing_gate.py -v`
Expected: PASS(4 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/core/billing/billing_integration.py backend/tests/payments/test_billing_gate.py
git commit -m "refactor(payments): collapse billing gate to provider_policy + balance threshold; drop deduct_usage"
```

---

## Task 7: `credits.py`(CreditService)welcome bonus + 缓存读余额并入 `credit_manager`

> 把 `core/credits.py` 里仍在用的两块逻辑收进 `credit_manager`:(a) `ensure_welcome_bonus`(走 `add_credits(billing_dedup_key="welcome_bonus:{id}")`)(b) `get_balance` 的缓存读 + welcome 触发。`core/credits.py` 其余方法(`deduct_credits`/`add_credits`/`grant_tier_credits` 走旧 `add_credits`/`deduct_credits` RPC 与订阅)为死路径,本计划让其无人调用(本体删除留 Plan 4)。

**Files:**
- Modify: `backend/core/billing/credit_manager.py`(新增 `ensure_welcome_bonus` + `get_cached_balance`)
- Modify: `backend/core/billing/api.py:205, 241, 277, 343, 750`(`credit_service.get_balance`/`ensure_welcome_bonus` → `credit_manager.get_cached_balance`/`ensure_welcome_bonus`;import 行 6 与 `get_account_summary` 两处 278/751 保留不动)
- Test: `backend/tests/payments/test_credit_manager_welcome.py`

**Interfaces:**
- Consumes:`add_credits_idempotent`(经 `self.add_credits`)、`FREE_TIER_INITIAL_CREDITS`、`Cache`。
- Produces:
  - `CreditManager.ensure_welcome_bonus(account_id: str) -> Optional[Decimal]`(幂等:已有 ledger 或余额>0 或非 free/none → 不发)。
  - `CreditManager.get_cached_balance(account_id: str, use_cache: bool = True) -> Decimal`(缓存读 + 首访触发 welcome)。

- [ ] **Step 1: 写失败测试**

```python
# backend/tests/payments/test_credit_manager_welcome.py
from __future__ import annotations
from decimal import Decimal
import pytest
from core.billing.credit_manager import CreditManager


class _Resp:
    def __init__(self, data): self.data = data


class _Query:
    def __init__(self, behavior): self._b = behavior; self._limit = None
    def select(self, *a, **k): return self
    def eq(self, *a, **k): return self
    def limit(self, n): self._limit = n; return self
    async def execute(self):
        if self._limit == 1:           # ledger existence check
            return _Resp(self._b["ledger"])
        return _Resp(self._b["account"])


class _FakeClient:
    def __init__(self, behavior): self._b = behavior
    def from_(self, table): return _Query(self._b)


class _DB:
    def __init__(self, c): self._c = c
    async def initialize(self): ...
    @property
    async def client(self): return self._c


@pytest.fixture(autouse=True)
def _prod(monkeypatch):
    from core.utils.config import EnvMode
    monkeypatch.setattr("core.billing.credit_manager.config.ENV_MODE",
                        EnvMode.PRODUCTION, raising=False)
    monkeypatch.setattr("core.billing.credit_manager.FREE_TIER_INITIAL_CREDITS",
                        Decimal("1.00"), raising=False)


def _cm(behavior):
    cm = CreditManager.__new__(CreditManager)
    cm.db = _DB(_FakeClient(behavior))
    return cm


async def test_welcome_bonus_granted_for_empty_account(monkeypatch):
    calls = {}
    async def _add(**kw): calls.update(kw); return {"success": True, "total_balance": 1.0}
    cm = _cm({"account": [{"balance": 0, "tier": "none"}], "ledger": []})
    monkeypatch.setattr(cm, "add_credits", _add)
    res = await cm.ensure_welcome_bonus("u1")
    assert res == Decimal("1.0")
    assert calls["billing_dedup_key"] == "welcome_bonus:u1"
    assert calls["is_expiring"] is False and calls["type"] == "welcome_bonus"


async def test_welcome_bonus_skipped_when_ledger_exists(monkeypatch):
    cm = _cm({"account": [{"balance": 0, "tier": "none"}], "ledger": [{"id": "x"}]})
    monkeypatch.setattr(cm, "add_credits",
                        lambda **kw: (_ for _ in ()).throw(AssertionError("must not grant")))
    assert await cm.ensure_welcome_bonus("u1") is None


async def test_welcome_bonus_skipped_when_balance_positive(monkeypatch):
    cm = _cm({"account": [{"balance": 5, "tier": "free"}], "ledger": []})
    monkeypatch.setattr(cm, "add_credits",
                        lambda **kw: (_ for _ in ()).throw(AssertionError("must not grant")))
    assert await cm.ensure_welcome_bonus("u1") is None
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && uv run pytest tests/payments/test_credit_manager_welcome.py -v`
Expected: FAIL — `AttributeError: 'CreditManager' object has no attribute 'ensure_welcome_bonus'`

- [ ] **Step 3a: 实现 —— 在 credit_manager.py 顶部补 import,并新增两方法**

在 `backend/core/billing/credit_manager.py` 顶部 import 段补:
```python
from core.utils.config import config, EnvMode
from .config import FREE_TIER_INITIAL_CREDITS
```

在 `get_balance` 方法之后(`credit_manager = CreditManager()` 之前)新增:

```python
    async def ensure_welcome_bonus(self, account_id: str) -> Optional[Decimal]:
        """首充欢迎金:幂等(billing_dedup_key=welcome_bonus:{id}),仅对空账户/未发过的发放。"""
        if config.ENV_MODE == EnvMode.LOCAL:
            return None
        if FREE_TIER_INITIAL_CREDITS <= 0:
            return None

        client = await self.db.client
        result = await client.from_('credit_accounts').select(
            'balance, tier'
        ).eq('account_id', account_id).execute()
        row = result.data[0] if result.data else {}
        balance = Decimal(str(row.get('balance', 0) or 0))
        tier = row.get('tier')

        if balance > 0:
            return None
        if tier not in (None, 'none', 'free'):
            return None

        ledger_check = await client.from_('credit_ledger').select(
            'id'
        ).eq('account_id', account_id).limit(1).execute()
        if ledger_check.data:
            return None

        res = await self.add_credits(
            account_id=account_id,
            amount=FREE_TIER_INITIAL_CREDITS,
            is_expiring=False,
            description='Welcome bonus',
            type='welcome_bonus',
            billing_dedup_key=f"welcome_bonus:{account_id}",
        )
        if res.get('success'):
            total = res.get('total_balance')
            return Decimal(str(total)) if total is not None else FREE_TIER_INITIAL_CREDITS
        return None

    async def get_cached_balance(self, account_id: str, use_cache: bool = True) -> Decimal:
        """缓存读余额 + 首访触发 welcome bonus。替代 core.credits.CreditService.get_balance。"""
        cache_key = f"credit_balance:{account_id}"
        if use_cache:
            cached = await Cache.get(cache_key)
            if cached is not None:
                return Decimal(str(cached))

        starter = await self.ensure_welcome_bonus(account_id)
        if starter is not None:
            await Cache.set(cache_key, str(starter), ttl=300)
            return starter

        balance_info = await self.get_balance(account_id)
        balance = Decimal(str(balance_info.get('total', 0)))
        await Cache.set(cache_key, str(balance), ttl=300)
        return balance
```

> `get_cached_balance` 复用已瘦身的 `get_balance`(只读 `balance/expiring/non_expiring`,无 tier 自愈)。welcome 走幂等 RPC,绝不重发。

- [ ] **Step 3b: 把 api.py 的 credit_service 调用改源(保留 import 给 summary)**

> `credit_manager` 已在 `api.py:22`(`from .credit_manager import credit_manager`)导入,无需新增。`from core.credits import credit_service`(`api.py:6`)**保留不删** —— `get_account_summary` 仍走 `credit_service`(它聚合 ledger,本计划不并入,Plan 4 决定去留)。本 Step 只把 `get_balance`/`ensure_welcome_bonus` 改到 `credit_manager`。

逐处替换(仅这 5 处 `get_balance`/`ensure_welcome_bonus`,`get_account_summary` 两处不动):
- `api.py:205` `current_balance = await credit_service.get_balance(account_id)` → `current_balance = await credit_manager.get_cached_balance(account_id)`
- `api.py:241` `balance = await credit_service.get_balance(account_id)` → `balance = await credit_manager.get_cached_balance(account_id)`
- `api.py:277` `balance = await credit_service.get_balance(account_id)` → `balance = await credit_manager.get_cached_balance(account_id)`
- `api.py:343` `await credit_service.ensure_welcome_bonus(account_id)` → `await credit_manager.ensure_welcome_bonus(account_id)`
- `api.py:750` `balance = await credit_service.get_balance(account_id)` → `balance = await credit_manager.get_cached_balance(account_id)`

> `credit_service.get_balance` 与 `credit_manager.get_cached_balance` 均返回 `Decimal`(已核 `core/credits.py:91` 与调用方 `api.py:206` 的 `float(current_balance)`),替换后下游 `float(...)` 消费不变。
> `api.py:278`、`api.py:751` 的 `summary = await credit_service.get_account_summary(account_id)` **保持不变**。

- [ ] **Step 3c: 静态校验**

Run: `cd backend && grep -n "credit_service" core/billing/api.py`
Expected: 仅剩 `credit_service.get_account_summary` 两处(行 278/751)+ import 行(行 6);`credit_service.get_balance` / `credit_service.ensure_welcome_bonus` 不再出现。

- [ ] **Step 4: 运行确认通过 + import 冒烟**

Run: `cd backend && uv run pytest tests/payments/test_credit_manager_welcome.py -v`
Expected: PASS(3 passed)

Run: `cd backend && uv run python -c "import core.billing.api; from core.billing.credit_manager import credit_manager; assert hasattr(credit_manager,'ensure_welcome_bonus') and hasattr(credit_manager,'get_cached_balance'); print('ok')"`
Expected: 打印 `ok`

- [ ] **Step 5: Commit**

```bash
git add backend/core/billing/credit_manager.py backend/core/billing/api.py backend/tests/payments/test_credit_manager_welcome.py
git commit -m "feat(payments): fold welcome-bonus + cached balance into credit_manager; repoint api.py off credit_service"
```

---

## 验收(Plan 2 完成标准)

- [ ] `cd backend && uv run pytest tests/payments/ -v` 全绿(含 Plan 1 全部 + 本计划新增 `test_credit_manager_slim/use/no_reset/welcome`、`test_entitlements`、`test_billing_gate`)。
- [ ] `cd backend && uv run pytest tests/test_billing_owner_rbac.py tests/test_ws_d_billing_persistence.py -v` 不回归。
- [ ] `cd backend && grep -rn "subscription_service\b" core/agent_runs.py core/files/api.py knowledge_base/api.py core/ai_models/manager.py core/core_utils.py core/billing/payment_service.py core/billing/billing_integration.py` **无输出**(7 个本计划改过的文件全部切净;Creem/订阅相关的 `billing/api.py`/`webhook_service.py`/`creem_*`/`__init__.py` 仍引用 `subscription_service`,属 Plan 4 范围,不在此验收)。
- [ ] `cd backend && grep -rn "is_unlimited_tier" core/ --include=*.py | grep -v "def is_unlimited_tier"` 不再出现在 `credit_manager.py` / `billing_integration.py`。
- [ ] `BillingIntegration` 无 `deduct_usage`;`CreditManager.reset_expiring_credits` 为惰性 no-op(`success=False, skipped=True`,不写库;物理删除连同 Creem/订阅 webhook 调用方留 Plan 4);`add_credits` 无 20s 窗口/无余额自愈;`use_credits` 无 unlimited 旁路/无 tier 读取。
- [ ] `credit_manager` 暴露 `ensure_welcome_bonus` / `get_cached_balance`;`core/billing/api.py` 不再调 `credit_service.get_balance` / `credit_service.ensure_welcome_bonus`。
- [ ] import 冒烟:`cd backend && uv run python -c "import core.agent_runs, core.files.api, knowledge_base.api, core.ai_models.manager, core.core_utils, core.billing.payment_service, core.billing.billing_integration, core.billing.api; print('all-imports-ok')"` 打印 `all-imports-ok`。

## 依赖与衔接

- **依赖 Plan 1**:`credit_manager.add_credits(billing_dedup_key=...)` 是 `OrderService.settle`(Plan 1 Task 10)的入账路径;本计划瘦身后该路径仍为 settle 唯一加分通道(Plan 1 测试 `test_orders.py::test_settle_paid_credits_once` 应继续通过)。
- **交给 Plan 3(P4)**:前端把 `tier`/订阅 UI 概念移除,余额/充值走 v2;entitlements 统一档已确认**全员同额 `"standard"`**(无 free/paid 二档)。
- **交给 Plan 4(P5–P6)**:删 `core/billing/subscription_service.py`(已无人调用)、`core/credits.py`(`get_balance`/`ensure_welcome_bonus` 已并入,仅 `get_account_summary` 待迁)、Creem/`providers/*`/`payment_service.py`;`credit_accounts` drop `tier`/`*_subscription_id`/`billing_provider` 列。
