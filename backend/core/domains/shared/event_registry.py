from __future__ import annotations

from typing import Dict, Optional


_EVENT_SCHEMA_REGISTRY: Dict[str, int] = {}


def register_event_type(event_type: str, schema_version: int = 1) -> None:
    if not event_type:
        raise ValueError("event_type is required")
    if schema_version <= 0:
        raise ValueError("schema_version must be positive")
    existing = _EVENT_SCHEMA_REGISTRY.get(event_type)
    if existing is not None and existing != schema_version:
        raise ValueError(
            f"event_type {event_type} already registered with schema_version={existing}"
        )
    _EVENT_SCHEMA_REGISTRY[event_type] = schema_version


def get_schema_version(event_type: str) -> Optional[int]:
    return _EVENT_SCHEMA_REGISTRY.get(event_type)


def validate_event_type(event_type: str, schema_version: int) -> None:
    expected = _EVENT_SCHEMA_REGISTRY.get(event_type)
    if expected is None:
        raise ValueError(f"event_type not registered: {event_type}")
    if expected != schema_version:
        raise ValueError(
            f"event_type {event_type} schema_version mismatch: {schema_version} != {expected}"
        )


def registered_event_types() -> Dict[str, int]:
    return dict(_EVENT_SCHEMA_REGISTRY)
