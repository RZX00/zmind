from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from typing import Any

from .contracts import ArtifactReferenceV2, ContinuityStateV2, ReplacementLedgerEntryV2


def _serialized_size(value: Any) -> int:
    try:
        return len(json.dumps(value, ensure_ascii=False))
    except Exception:
        return len(str(value))


def _truncate_summary(value: Any, *, limit: int = 240) -> str:
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    text = text.strip().replace("\r", " ").replace("\n", " ")
    if len(text) <= limit:
        return text
    return text[: limit - 3] + "..."


@dataclass(slots=True)
class ArtifactStoreV2:
    replacement_threshold_chars: int = 4000

    def store(
        self,
        *,
        continuity_state: ContinuityStateV2,
        kind: str,
        key: str,
        value: Any,
        summary: str | None = None,
        content_type: str = "application/json",
        replacement_reason: str = "oversized_payload",
    ) -> ArtifactReferenceV2:
        artifact_id = f"artifact_{uuid.uuid4().hex}"
        continuity_state.artifacts[artifact_id] = {
            "kind": kind,
            "value": value,
            "content_type": content_type,
            "summary": summary or _truncate_summary(value),
        }
        reference = ArtifactReferenceV2(
            artifact_id=artifact_id,
            kind=kind,
            pointer=f"artifact://{artifact_id}",
            summary=summary or _truncate_summary(value),
            content_type=content_type,
        )
        continuity_state.replacement_ledger.append(
            ReplacementLedgerEntryV2(
                key=key,
                artifact=reference,
                original_size=_serialized_size(value),
                replacement_reason=replacement_reason,
            )
        )
        return reference

    def maybe_replace(
        self,
        *,
        continuity_state: ContinuityStateV2,
        kind: str,
        key: str,
        value: Any,
        summary: str | None = None,
        content_type: str = "application/json",
    ) -> tuple[Any, ArtifactReferenceV2 | None]:
        size = _serialized_size(value)
        if size <= self.replacement_threshold_chars:
            return value, None
        reference = self.store(
            continuity_state=continuity_state,
            kind=kind,
            key=key,
            value=value,
            summary=summary,
            content_type=content_type,
        )
        return {
            "artifact_ref": reference.to_dict(),
            "summary": reference.summary,
        }, reference
