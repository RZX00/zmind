from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal


DegradedSeverity = Literal["info", "warning", "error"]


@dataclass(frozen=True)
class DegradedState:
    code: str
    component: str
    severity: DegradedSeverity = "warning"
    user_visible: bool = False
    message: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)

    def dedupe_key(self) -> tuple[str, str]:
        return self.component, self.code

    def to_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "component": self.component,
            "severity": self.severity,
            "user_visible": self.user_visible,
            "message": self.message,
            "metadata": dict(self.metadata),
        }
