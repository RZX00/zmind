from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from core.domains.agent.degraded_state import DegradedState


_VALID_SEVERITIES = {"info", "warning", "error"}


class DegradedStateService:
    def normalize(self, flags: Sequence[DegradedState | Mapping[str, Any]] | None) -> list[dict[str, Any]]:
        normalized: list[dict[str, Any]] = []
        seen: set[tuple[str, str]] = set()

        for flag in flags or ():
            payload = self._coerce_flag(flag)
            dedupe_key = (payload["component"], payload["code"])
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)
            normalized.append(payload)

        return normalized

    def append_flag(
        self,
        flags: Sequence[DegradedState | Mapping[str, Any]] | None,
        flag: DegradedState | Mapping[str, Any],
    ) -> list[dict[str, Any]]:
        normalized = self.normalize(flags)
        payload = self._coerce_flag(flag)
        dedupe_key = (payload["component"], payload["code"])

        for index, existing in enumerate(normalized):
            if (existing["component"], existing["code"]) == dedupe_key:
                normalized[index] = payload
                break
        else:
            normalized.append(payload)

        return normalized

    def has_user_visible_flags(self, flags: Sequence[DegradedState | Mapping[str, Any]] | None) -> bool:
        return any(bool(flag.get("user_visible")) for flag in self.normalize(flags))

    def _coerce_flag(self, flag: DegradedState | Mapping[str, Any]) -> dict[str, Any]:
        if isinstance(flag, DegradedState):
            payload = flag.to_dict()
        else:
            payload = {
                "code": str(flag.get("code") or "").strip(),
                "component": str(flag.get("component") or "").strip(),
                "severity": str(flag.get("severity") or "warning").strip().lower(),
                "user_visible": bool(flag.get("user_visible", False)),
                "message": str(flag.get("message") or "").strip(),
                "metadata": dict(flag.get("metadata") or {}),
            }

        if payload["severity"] not in _VALID_SEVERITIES:
            payload["severity"] = "warning"

        if not payload["code"]:
            raise ValueError("DegradedState code is required")
        if not payload["component"]:
            raise ValueError("DegradedState component is required")

        return payload
