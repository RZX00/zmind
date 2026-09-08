from __future__ import annotations

from typing import Any


def _parse_workspace_allowlist(raw_value: Any) -> set[str]:
    if not raw_value:
        return set()
    if isinstance(raw_value, str):
        return {part.strip() for part in raw_value.split(",") if part.strip()}
    if isinstance(raw_value, (list, tuple, set)):
        return {str(part).strip() for part in raw_value if str(part).strip()}
    return set()


def is_workspace_feature_enabled(
    *,
    enabled_globally: bool,
    workspace_id: str,
    allowlist: Any = None,
) -> bool:
    if enabled_globally:
        return True
    return workspace_id in _parse_workspace_allowlist(allowlist)
