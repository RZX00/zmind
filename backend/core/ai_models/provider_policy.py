from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Sequence

from .ai_models import ModelProvider

SPONSORED_PROVIDER_ID = "habitat"
SPONSORED_PROVIDER_BADGE = "Ewo Sponsor"
DEFAULT_FALLBACK_MODE = "cross_provider"
VALID_FALLBACK_MODES = {"cross_provider", "within_provider"}

_PROVIDER_DISPLAY_NAMES: Dict[str, str] = {
    ModelProvider.OPENAI.value: "OpenAI",
    ModelProvider.ANTHROPIC.value: "Anthropic",
    ModelProvider.OPENROUTER.value: "OpenRouter",
    ModelProvider.GOOGLE.value: "Google",
    ModelProvider.AZURE.value: "Azure OpenAI",
    ModelProvider.XAI.value: "xAI",
    ModelProvider.MOONSHOTAI.value: "MoonshotAI",
    ModelProvider.HABITAT.value: "Ewo",
    ModelProvider.AIPING.value: "AiPing",
    ModelProvider.DOUBAO.value: "Doubao",
}


@dataclass(frozen=True)
class ProviderPolicy:
    enabled_providers: List[str]
    default_provider: Optional[str]
    priority_order: List[str]
    fallback_mode: str = DEFAULT_FALLBACK_MODE

    def to_dict(self) -> Dict[str, Any]:
        return {
            "enabled_providers": list(self.enabled_providers),
            "default_provider": self.default_provider,
            "priority_order": list(self.priority_order),
            "fallback_mode": self.fallback_mode,
        }


def provider_display_name(provider_id: str) -> str:
    key = (provider_id or "").strip().lower()
    if not key:
        return "Unknown"
    return _PROVIDER_DISPLAY_NAMES.get(key, key.capitalize())


def is_sponsored_provider(provider_id: str) -> bool:
    return (provider_id or "").strip().lower() == SPONSORED_PROVIDER_ID


def _normalize_provider_list(values: Optional[Sequence[str]], allowed: set[str]) -> List[str]:
    if not values:
        return []
    seen: set[str] = set()
    normalized: List[str] = []
    for raw in values:
        key = str(raw or "").strip().lower()
        if not key or key not in allowed or key in seen:
            continue
        seen.add(key)
        normalized.append(key)
    return normalized


def default_provider_policy(provider_ids: Iterable[str]) -> ProviderPolicy:
    normalized = [p.strip().lower() for p in provider_ids if str(p).strip()]
    deduped: List[str] = []
    seen: set[str] = set()
    for provider_id in normalized:
        if provider_id in seen:
            continue
        seen.add(provider_id)
        deduped.append(provider_id)

    default_provider = None
    if SPONSORED_PROVIDER_ID in deduped:
        default_provider = SPONSORED_PROVIDER_ID
    elif deduped:
        default_provider = deduped[0]

    return ProviderPolicy(
        enabled_providers=deduped,
        default_provider=default_provider,
        priority_order=list(deduped),
        fallback_mode=DEFAULT_FALLBACK_MODE,
    )


def normalize_provider_policy(raw_policy: Optional[Dict[str, Any]], provider_ids: Sequence[str]) -> ProviderPolicy:
    default_policy = default_provider_policy(provider_ids)
    allowed = set(default_policy.enabled_providers)
    if not allowed:
        return default_policy

    payload = raw_policy or {}

    enabled = _normalize_provider_list(payload.get("enabled_providers"), allowed)
    if not enabled:
        enabled = list(default_policy.enabled_providers)

    enabled_set = set(enabled)
    default_provider_raw = str(payload.get("default_provider") or "").strip().lower()
    if default_provider_raw and default_provider_raw in enabled_set:
        default_provider = default_provider_raw
    elif default_policy.default_provider in enabled_set:
        default_provider = default_policy.default_provider
    else:
        default_provider = enabled[0] if enabled else None

    priority = _normalize_provider_list(payload.get("priority_order"), allowed)
    priority = [provider for provider in priority if provider in enabled_set]
    for provider in enabled:
        if provider not in priority:
            priority.append(provider)

    fallback_mode_raw = str(payload.get("fallback_mode") or DEFAULT_FALLBACK_MODE).strip().lower()
    fallback_mode = fallback_mode_raw if fallback_mode_raw in VALID_FALLBACK_MODES else DEFAULT_FALLBACK_MODE

    return ProviderPolicy(
        enabled_providers=enabled,
        default_provider=default_provider,
        priority_order=priority,
        fallback_mode=fallback_mode,
    )


def model_allowed_by_policy(model_data: Dict[str, Any], policy: ProviderPolicy) -> bool:
    provider_id = str(model_data.get("provider") or "").strip().lower()
    if not provider_id:
        return True
    return provider_id in set(policy.enabled_providers)


def sort_models_for_provider_policy(models: Sequence[Dict[str, Any]], policy: ProviderPolicy) -> List[Dict[str, Any]]:
    provider_rank = {provider: index for index, provider in enumerate(policy.priority_order)}

    def _sort_key(item: Dict[str, Any]) -> tuple:
        provider_id = str(item.get("provider") or "").strip().lower()
        return (
            provider_rank.get(provider_id, len(provider_rank) + 1),
            -int(item.get("priority") or 0),
            str(item.get("name") or item.get("id") or ""),
        )

    return sorted(models, key=_sort_key)


def pick_default_model_for_policy(
    models: Sequence[Dict[str, Any]],
    policy: ProviderPolicy,
    allowed_model_ids: Optional[set[str]] = None,
) -> Optional[str]:
    allowed_models: List[Dict[str, Any]] = []
    for model in models:
        model_id = str(model.get("id") or "").strip()
        if not model_id:
            continue
        if allowed_model_ids is not None and model_id not in allowed_model_ids:
            continue
        if not model_allowed_by_policy(model, policy):
            continue
        allowed_models.append(model)

    if not allowed_models:
        return None

    ordered_providers: List[str] = []
    if policy.default_provider:
        ordered_providers.append(policy.default_provider)
    for provider_id in policy.priority_order:
        if provider_id not in ordered_providers:
            ordered_providers.append(provider_id)

    def _best_for_provider(provider_id: str) -> Optional[str]:
        candidates = [m for m in allowed_models if str(m.get("provider") or "").strip().lower() == provider_id]
        if not candidates:
            return None
        candidates.sort(
            key=lambda item: (
                not bool(item.get("recommended")),
                -int(item.get("priority") or 0),
                str(item.get("name") or item.get("id") or ""),
            )
        )
        return str(candidates[0].get("id"))

    for provider_id in ordered_providers:
        pick = _best_for_provider(provider_id)
        if pick:
            return pick

    allowed_models.sort(
        key=lambda item: (
            not bool(item.get("recommended")),
            -int(item.get("priority") or 0),
            str(item.get("name") or item.get("id") or ""),
        )
    )
    return str(allowed_models[0].get("id")) if allowed_models else None


def build_provider_summaries(models: Sequence[Dict[str, Any]], policy: ProviderPolicy) -> List[Dict[str, Any]]:
    grouped: Dict[str, Dict[str, Any]] = {}
    enabled = set(policy.enabled_providers)

    for model in models:
        provider_id = str(model.get("provider") or "").strip().lower()
        if not provider_id:
            continue
        info = grouped.setdefault(
            provider_id,
            {
                "provider_id": provider_id,
                "provider_display_name": provider_display_name(provider_id),
                "model_count": 0,
                "enabled_model_count": 0,
            },
        )
        info["model_count"] += 1
        if provider_id in enabled:
            info["enabled_model_count"] += 1

    provider_rank = {provider: index for index, provider in enumerate(policy.priority_order)}

    providers = list(grouped.values())
    providers.sort(
        key=lambda item: (
            provider_rank.get(item["provider_id"], len(provider_rank) + 1),
            item["provider_display_name"],
        )
    )

    for provider in providers:
        provider_id = provider["provider_id"]
        provider["is_enabled"] = provider_id in enabled
        provider["is_default"] = provider_id == policy.default_provider
        provider["is_sponsored"] = is_sponsored_provider(provider_id)
        provider["sponsor_badge"] = SPONSORED_PROVIDER_BADGE if provider["is_sponsored"] else None

    return providers
