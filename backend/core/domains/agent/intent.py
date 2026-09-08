from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal


IntentDomain = Literal["canvas", "doc", "research", "integration", "generic"]
IntentComplexity = Literal["low", "medium", "high"]


@dataclass(frozen=True)
class IntentResolution:
    domain: IntentDomain
    user_goal: str
    target_surface: str | None = None
    confidence: float = 0.0
    complexity: IntentComplexity = "low"
    signals: tuple[str, ...] = ()
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "domain": self.domain,
            "user_goal": self.user_goal,
            "target_surface": self.target_surface,
            "confidence": float(self.confidence),
            "complexity": self.complexity,
            "signals": list(self.signals),
            "metadata": dict(self.metadata),
        }
