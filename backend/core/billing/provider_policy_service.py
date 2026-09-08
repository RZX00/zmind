from __future__ import annotations

from typing import Any, Dict, Optional, Sequence

from core.ai_models import model_manager
from core.ai_models.provider_policy import (
    ProviderPolicy,
    build_provider_summaries,
    default_provider_policy,
    normalize_provider_policy,
)
from core.services.cache_service import CacheService
from core.services.supabase import DBConnection
from core.utils.logger import logger


class ProviderPolicyService:
    TABLE_NAME = "ai_provider_policies"
    CACHE_TTL_SECONDS = 600

    def __init__(self) -> None:
        self._cache = CacheService()

    def _cache_key(self, account_id: str) -> str:
        return f"provider_policy:{account_id}"

    def _is_missing_policy_table_error(self, exc: Exception) -> bool:
        text = str(exc).lower()
        missing_markers = (
            "does not exist",
            "undefined table",
            "42p01",
            "could not find the table",
            "schema cache",
            "pgrst205",
        )
        if not any(marker in text for marker in missing_markers):
            return False
        return self.TABLE_NAME.lower() in text

    def _available_provider_ids(self) -> list[str]:
        models = model_manager.list_available_models(include_disabled=False)
        provider_ids: list[str] = []
        seen: set[str] = set()
        for model in models:
            provider_id = str(model.get("provider") or "").strip().lower()
            if not provider_id or provider_id in seen:
                continue
            seen.add(provider_id)
            provider_ids.append(provider_id)
        return provider_ids

    async def _query_policy_row(self, account_id: str, client) -> Optional[Dict[str, Any]]:
        try:
            result = (
                await client.from_(self.TABLE_NAME)
                .select("account_id, enabled_providers, default_provider, priority_order, fallback_mode, updated_at")
                .eq("account_id", account_id)
                .limit(1)
                .execute()
            )
            if result.data:
                return result.data[0]
            return None
        except Exception as exc:
            if self._is_missing_policy_table_error(exc):
                logger.warning(
                    "Provider policy table not found; falling back to defaults",
                    account_id=account_id,
                    table=self.TABLE_NAME,
                )
                return None
            raise

    async def get_policy(self, account_id: str, client=None, use_cache: bool = True) -> ProviderPolicy:
        provider_ids = self._available_provider_ids()
        if not provider_ids:
            return default_provider_policy([])

        if use_cache:
            cached = await self._cache.get(self._cache_key(account_id))
            if cached and isinstance(cached, dict):
                try:
                    return normalize_provider_policy(cached, provider_ids)
                except Exception:
                    pass

        own_client = False
        if client is None:
            db = DBConnection()
            client = await db.client
            own_client = True

        try:
            row = await self._query_policy_row(account_id, client)
            policy = normalize_provider_policy(row, provider_ids)
            await self._cache.set(self._cache_key(account_id), policy.to_dict(), ttl=self.CACHE_TTL_SECONDS)
            return policy
        finally:
            if own_client:
                # Supabase client is shared/pool-based; no explicit close needed.
                pass

    async def get_policy_bundle(self, account_id: str, client=None, use_cache: bool = True) -> Dict[str, Any]:
        models = model_manager.list_available_models(include_disabled=False)
        policy = await self.get_policy(account_id, client=client, use_cache=use_cache)
        providers = build_provider_summaries(models, policy)
        return {
            "policy": policy.to_dict(),
            "providers": providers,
        }

    async def update_policy(
        self,
        account_id: str,
        patch: Dict[str, Any],
        updated_by: Optional[str] = None,
        client=None,
    ) -> Dict[str, Any]:
        provider_ids = self._available_provider_ids()
        current = await self.get_policy(account_id, client=client, use_cache=False)
        merged = current.to_dict()
        for key in ("enabled_providers", "default_provider", "priority_order", "fallback_mode"):
            if key in patch:
                merged[key] = patch[key]

        normalized = normalize_provider_policy(merged, provider_ids)
        payload = normalized.to_dict()
        payload["account_id"] = account_id
        if updated_by:
            payload["updated_by"] = updated_by

        own_client = False
        if client is None:
            db = DBConnection()
            client = await db.client
            own_client = True

        persisted = True
        try:
            try:
                await client.from_(self.TABLE_NAME).upsert(payload, on_conflict="account_id").execute()
            except Exception as exc:
                if self._is_missing_policy_table_error(exc):
                    persisted = False
                    logger.warning(
                        "Provider policy table missing during update; returning non-persisted policy",
                        account_id=account_id,
                        table=self.TABLE_NAME,
                    )
                else:
                    raise
            await self._cache.set(self._cache_key(account_id), normalized.to_dict(), ttl=self.CACHE_TTL_SECONDS)
            bundle = await self.get_policy_bundle(account_id, client=client, use_cache=False)
            bundle["persisted"] = persisted
            return bundle
        finally:
            if own_client:
                pass

    def provider_enabled(self, policy: ProviderPolicy, provider_id: str) -> bool:
        key = str(provider_id or "").strip().lower()
        if not key:
            return True
        return key in set(policy.enabled_providers)

    def pick_default_model(self, policy: ProviderPolicy, allowed_model_ids: Optional[set[str]] = None) -> Optional[str]:
        from core.ai_models.provider_policy import pick_default_model_for_policy

        models = model_manager.list_available_models(include_disabled=False)
        return pick_default_model_for_policy(models=models, policy=policy, allowed_model_ids=allowed_model_ids)


provider_policy_service = ProviderPolicyService()
