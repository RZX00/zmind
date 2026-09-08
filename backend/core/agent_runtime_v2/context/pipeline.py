from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from ..artifacts import ArtifactStoreV2
from ..contracts import ArtifactReferenceV2, ContextLifecycleRecordV2, RuntimeContextV2
from ..hooks import ContextEnrichersV2


def _stable_copy(value: Any) -> Any:
    return json.loads(json.dumps(value, ensure_ascii=False))


def _stable_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


@dataclass(slots=True)
class ContextLifecyclePipelineV2:
    artifact_store: ArtifactStoreV2
    enrichers: ContextEnrichersV2 | None = None
    artifact_budget_keys: tuple[str, ...] = ("selection_context", "pending_preview", "diagnostics", "mailbox")

    def __post_init__(self) -> None:
        if self.enrichers is None:
            self.enrichers = ContextEnrichersV2()

    def run(self, context: RuntimeContextV2) -> RuntimeContextV2:
        records: list[ContextLifecycleRecordV2] = []

        normalized = self._normalize(context)
        records.append(self._record("normalize", normalized))

        enriched = self._enrich(context, normalized)
        records.append(self._record("enrich", enriched))

        budgeted = self._budget(context, enriched)
        records.append(self._record("budget", budgeted))

        replaced, replacement_refs = self._replacement(context, budgeted)
        records.append(self._record("replacement", replaced, artifact_refs=replacement_refs))

        compacted = self._compact(replaced)
        records.append(self._record("compact", compacted))

        collapsed = self._collapse(compacted)
        records.append(self._record("collapse", collapsed))

        assembled = self._assemble(collapsed)
        records.append(self._record("assemble", assembled))

        context.prompt_context = {
            "normalized": normalized,
            "enriched": enriched,
            "budgeted": budgeted,
            "replaced": replaced,
            "compacted": compacted,
            "collapsed": collapsed,
            "assembled": assembled,
            "lifecycle_records": [record.to_dict() for record in records],
        }
        if context.continuity_state is not None:
            context.continuity_state.context_lifecycle = records
            context.continuity_state.collapsed_contexts["prompt.latest"] = _stable_copy(collapsed)
        return context

    def _normalize(self, context: RuntimeContextV2) -> dict[str, Any]:
        return {
            "latest_user_text": context.latest_user_text,
            "surface": context.surface,
            "lane": context.lane,
            "response_mode": context.response_mode,
            "workspace_target": context.workspace_target.to_dict(),
            "selection_context": context.selection_context.to_dict(),
        }

    def _enrich(self, context: RuntimeContextV2, normalized: dict[str, Any]) -> dict[str, Any]:
        assert self.enrichers is not None
        enriched = dict(normalized)
        enriched.update(
            self.enrichers.enrich(
                context=context,
                normalized=normalized,
            )
        )
        enriched["budget_context"] = dict(context.budget_context)
        return enriched

    def _budget(self, context: RuntimeContextV2, enriched: dict[str, Any]) -> dict[str, Any]:
        budgeted = dict(enriched)
        threshold = int(context.budget_context.get("artifact_threshold_chars") or self.artifact_store.replacement_threshold_chars)
        budgeted["budget_context"] = {
            **dict(enriched.get("budget_context") or {}),
            "artifact_threshold_chars": threshold,
            "artifact_budget_keys": list(self.artifact_budget_keys),
        }
        return budgeted

    def _replacement(
        self,
        context: RuntimeContextV2,
        budgeted: dict[str, Any],
    ) -> tuple[dict[str, Any], tuple[ArtifactReferenceV2, ...]]:
        replaced = dict(budgeted)
        artifact_refs: list[ArtifactReferenceV2] = []
        continuity_state = context.continuity_state
        if continuity_state is None:
            return replaced, ()

        for key in self.artifact_budget_keys:
            if key not in replaced:
                continue
            value = replaced.get(key)
            if value in (None, {}, [], ""):
                continue
            replaced_value, reference = self.artifact_store.maybe_replace(
                continuity_state=continuity_state,
                kind=key,
                key=f"context.{key}",
                value=value,
                summary=f"{key} replaced with artifact pointer for deterministic prompt budget.",
            )
            replaced[key] = replaced_value
            if reference is not None:
                artifact_refs.append(reference)

        if artifact_refs:
            replaced["artifact_refs"] = [reference.to_dict() for reference in artifact_refs]
        return replaced, tuple(artifact_refs)

    def _compact(self, replaced: dict[str, Any]) -> dict[str, Any]:
        compacted = dict(replaced)
        latest_user_text = str(compacted.get("latest_user_text") or "")
        if len(latest_user_text) > 2000:
            compacted["latest_user_text"] = latest_user_text[:1997] + "..."
        return compacted

    def _collapse(self, compacted: dict[str, Any]) -> dict[str, Any]:
        collapsed = dict(compacted)
        selection_context = compacted.get("selection_context")
        active_canvas_metadata = compacted.get("active_canvas_metadata") or {}
        collapsed["collapse_summary"] = {
            "surface": compacted.get("surface"),
            "lane": compacted.get("lane"),
            "response_mode": compacted.get("response_mode"),
            "selection_scope": selection_context.get("scope") if isinstance(selection_context, dict) else None,
            "canvas_id": active_canvas_metadata.get("canvas_id"),
        }
        return collapsed

    def _assemble(self, collapsed: dict[str, Any]) -> dict[str, Any]:
        stable_prefix = [
            {"key": "surface", "value": collapsed.get("surface")},
            {"key": "lane", "value": collapsed.get("lane")},
            {"key": "response_mode", "value": collapsed.get("response_mode")},
            {
                "key": "canvas_id",
                "value": ((collapsed.get("active_canvas_metadata") or {}).get("canvas_id")),
            },
        ]
        context_lines = ["Runtime Context V2"]
        for item in stable_prefix:
            context_lines.append(f"{item['key']}={item['value']}")
        context_lines.append(f"dynamic_context={_stable_json(collapsed)}")
        return {
            "stable_prefix": stable_prefix,
            "dynamic_context": collapsed,
            "messages_context": [
                {
                    "role": "system",
                    "content": "\n".join(context_lines),
                    "metadata": {"source": "runtime_context_v2"},
                }
            ],
        }

    @staticmethod
    def _record(
        stage: str,
        payload: dict[str, Any],
        *,
        artifact_refs: tuple[ArtifactReferenceV2, ...] = (),
        metadata: dict[str, Any] | None = None,
    ) -> ContextLifecycleRecordV2:
        return ContextLifecycleRecordV2(
            stage=stage,  # type: ignore[arg-type]
            payload=_stable_copy(payload),
            artifact_refs=artifact_refs,
            metadata=dict(metadata or {}),
        )
