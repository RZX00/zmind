from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal


VerificationSeverity = Literal["info", "warning", "error"]


@dataclass(frozen=True)
class VerificationIssue:
    code: str
    message: str
    severity: VerificationSeverity = "error"
    component: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "severity": self.severity,
            "component": self.component,
            "metadata": dict(self.metadata),
        }


@dataclass(frozen=True)
class VerificationReport:
    passed: bool
    summary: str
    issues: tuple[VerificationIssue, ...] = ()
    metadata: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def passed_report(
        cls,
        summary: str = "verification_passed",
        *,
        metadata: dict[str, Any] | None = None,
    ) -> "VerificationReport":
        return cls(
            passed=True,
            summary=summary,
            issues=(),
            metadata=dict(metadata or {}),
        )

    @classmethod
    def failed_report(
        cls,
        summary: str,
        *,
        issues: tuple[VerificationIssue, ...] = (),
        metadata: dict[str, Any] | None = None,
    ) -> "VerificationReport":
        return cls(
            passed=False,
            summary=summary,
            issues=issues,
            metadata=dict(metadata or {}),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "passed": self.passed,
            "summary": self.summary,
            "issues": [issue.to_dict() for issue in self.issues],
            "metadata": dict(self.metadata),
        }
