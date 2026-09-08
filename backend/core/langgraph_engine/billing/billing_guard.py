from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
import inspect
from typing import Any, Awaitable, Callable

from core.billing.pricing import calculate_token_cost
from core.langgraph_engine.contracts.event_schema import LLMResponseEndEvent
from core.langgraph_engine.contracts.state_schema import GraphState
from core.services.supabase import DBConnection
from core.utils.config import EnvMode, config
from core.utils.logger import logger


class BillingGuardError(RuntimeError):
    pass


@dataclass(frozen=True)
class DeductResult:
    success: bool
    duplicate: bool
    cost: float
    billing_dedup_key: str
    transaction_id: str | None = None
    new_balance: float | None = None
    error: str | None = None


def _safe_int(value: Any) -> int:
    try:
        return int(value or 0)
    except Exception:
        return 0


def _extract_usage(usage: dict[str, Any]) -> tuple[int, int, int, int]:
    prompt_tokens = _safe_int(usage.get("prompt_tokens"))
    completion_tokens = _safe_int(usage.get("completion_tokens"))

    cache_read_tokens = _safe_int(usage.get("cache_read_input_tokens"))
    if cache_read_tokens == 0:
        details = usage.get("prompt_tokens_details") or {}
        if isinstance(details, dict):
            cache_read_tokens = _safe_int(details.get("cached_tokens"))

    cache_creation_tokens = _safe_int(usage.get("cache_creation_input_tokens"))
    return prompt_tokens, completion_tokens, cache_read_tokens, cache_creation_tokens


def _calculate_cost(
    *,
    prompt_tokens: int,
    completion_tokens: int,
    cache_read_tokens: int,
    cache_creation_tokens: int,
    model: str,
) -> Decimal:
    # Keep cost logic consistent with `core/billing/billing_integration.py` (WS-D requirement).
    # NOTE: cache_creation_tokens are carried for metadata only in current billing v1.
    _ = cache_creation_tokens

    model_lower = (model or "unknown").lower()
    if cache_read_tokens > 0:
        non_cached_prompt_tokens = max(0, prompt_tokens - cache_read_tokens)

        if any(provider in model_lower for provider in ["anthropic", "claude", "sonnet"]):
            cache_discount = Decimal("0.1")
        elif any(provider in model_lower for provider in ["gpt", "openai"]):
            cache_discount = Decimal("0.5")
        else:
            cache_discount = Decimal("0.5")

        cached_cost = Decimal(str(calculate_token_cost(cache_read_tokens, 0, model))) * cache_discount
        non_cached_cost = Decimal(str(calculate_token_cost(non_cached_prompt_tokens, completion_tokens, model)))
        return cached_cost + non_cached_cost

    return Decimal(str(calculate_token_cost(prompt_tokens, completion_tokens, model)))


class BillingGuard:
    def __init__(self, client_getter: Callable[[], Awaitable[Any] | Any] | None = None):
        self._db = DBConnection()
        self._client_getter = client_getter or self._get_db_client

    async def _get_db_client(self) -> Any:
        return await self._db.client

    async def _resolve_client(self) -> Any:
        maybe_client = self._client_getter()
        if inspect.isawaitable(maybe_client):
            return await maybe_client
        return maybe_client

    @staticmethod
    def billing_dedup_key(agent_run_id: str, llm_response_id: str) -> str:
        return f"{agent_run_id}:{llm_response_id}"

    async def deduct_once(self, state: GraphState, event: LLMResponseEndEvent) -> DeductResult:
        agent_run_id = state["agent_run_id"]
        account_id = state["account_id"]
        thread_id = state["thread_id"]

        llm_response_id = event["llm_response_id"]
        billing_dedup_key = self.billing_dedup_key(agent_run_id, llm_response_id)

        if state.get("is_shadow"):
            return DeductResult(
                success=True,
                duplicate=False,
                cost=0.0,
                billing_dedup_key=billing_dedup_key,
            )

        if config.ENV_MODE == EnvMode.LOCAL:
            return DeductResult(
                success=True,
                duplicate=False,
                cost=0.0,
                billing_dedup_key=billing_dedup_key,
                new_balance=999999.0,
            )

        usage = event.get("usage") or {}
        if not isinstance(usage, dict):
            usage = {}

        prompt_tokens, completion_tokens, cache_read_tokens, cache_creation_tokens = _extract_usage(usage)
        model = event.get("model") or state.get("model_name") or "unknown"
        if prompt_tokens <= 0 and completion_tokens <= 0:
            logger.warning(
                "[BILLING_GUARD] Missing token usage; skipping deduction",
                agent_run_id=agent_run_id,
                llm_response_id=llm_response_id,
                model=model,
                usage=usage,
            )
            return DeductResult(
                success=True,
                duplicate=False,
                cost=0.0,
                billing_dedup_key=billing_dedup_key,
            )

        cost = _calculate_cost(
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            cache_read_tokens=cache_read_tokens,
            cache_creation_tokens=cache_creation_tokens,
            model=model,
        )

        if cost <= 0:
            logger.warning(
                "[BILLING_GUARD] Zero/negative cost calculated; skipping deduction",
                agent_run_id=agent_run_id,
                llm_response_id=llm_response_id,
                model=model,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
            )
            return DeductResult(
                success=True,
                duplicate=False,
                cost=0.0,
                billing_dedup_key=billing_dedup_key,
            )

        client = await self._resolve_client()
        params = {
            "p_account_id": account_id,
            "p_amount": str(cost),
            "p_description": f"{model} usage",
            "p_billing_dedup_key": billing_dedup_key,
            "p_thread_id": thread_id,
            "p_message_id": event.get("message_id"),
            "p_extra_metadata": {
                "agent_run_id": agent_run_id,
                "thread_id": thread_id,
                "llm_response_id": llm_response_id,
                "engine": state.get("engine"),
                "engine_version": state.get("engine_version"),
                "checkpoint_id": state.get("checkpoint_id"),
                "model": model,
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "cache_read_tokens": cache_read_tokens,
                "cache_creation_tokens": cache_creation_tokens,
            },
        }

        try:
            result = await client.rpc("deduct_credits_idempotent", params).execute()
        except Exception as e:
            raise BillingGuardError(
                f"billing_rpc_failed: deduct_credits_idempotent ({billing_dedup_key}): {e}"
            ) from e

        rows = getattr(result, "data", None) or []
        if not rows:
            raise BillingGuardError(f"billing_rpc_empty_result: {billing_dedup_key}")

        row = rows[0] or {}
        if not row.get("success"):
            err = row.get("error") or "billing_failed"
            raise BillingGuardError(f"billing_failed ({billing_dedup_key}): {err}")

        duplicate = bool(row.get("duplicate", False))
        transaction_id = row.get("transaction_id")
        new_balance = row.get("new_balance")

        return DeductResult(
            success=True,
            duplicate=duplicate,
            cost=float(cost),
            billing_dedup_key=billing_dedup_key,
            transaction_id=str(transaction_id) if transaction_id else None,
            new_balance=float(new_balance) if new_balance is not None else None,
        )


billing_guard = BillingGuard()
