from __future__ import annotations

from typing import Callable, Dict, Any, Optional, Tuple

from core.domains.shared.event_registry import get_schema_version


Upcaster = Callable[[Dict[str, Any]], Dict[str, Any]]


_UPCASTERS: Dict[str, Dict[int, Upcaster]] = {}


def register_upcaster(event_type: str, from_version: int, fn: Upcaster) -> None:
    if not event_type:
        raise ValueError("event_type is required")
    if from_version <= 0:
        raise ValueError("from_version must be positive")
    _UPCASTERS.setdefault(event_type, {})[from_version] = fn


def upcast_payload(
    event_type: str,
    schema_version: int,
    payload: Dict[str, Any],
) -> Tuple[int, Dict[str, Any]]:
    target_version = get_schema_version(event_type)
    if target_version is None:
        return schema_version, payload
    if schema_version >= target_version:
        return schema_version, payload

    current_version = schema_version
    data = payload
    while current_version < target_version:
        handler = _UPCASTERS.get(event_type, {}).get(current_version)
        if not handler:
            break
        data = handler(data)
        current_version += 1

    return current_version, data


def needs_upcast(event_type: str, schema_version: int) -> bool:
    target_version = get_schema_version(event_type)
    if target_version is None:
        return False
    return schema_version < target_version
