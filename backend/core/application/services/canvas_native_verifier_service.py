from __future__ import annotations

from typing import Any

from core.application.services.canvas_native_context_resolver_service import (
    CanvasNativeContextResolverService,
)
from core.domains.agent.verification import VerificationIssue, VerificationReport
from core.services import metrics


class CanvasNativeVerifierService:
    def __init__(
        self,
        *,
        context_resolver: CanvasNativeContextResolverService | None = None,
    ) -> None:
        self._context_resolver = context_resolver or CanvasNativeContextResolverService()

    async def verify(self, *, state: dict[str, Any], tool_context: dict[str, Any] | None) -> dict[str, Any]:
        execution = state.get("canvas_execution") or {}
        task = state.get("canvas_task") or {}
        context = state.get("canvas_context") or {}
        runtime = state.get("canvas_runtime") or {}

        if runtime.get("mode") == "shadow":
            return VerificationReport.passed_report(
                "shadow_mode_skips_write_verification",
                metadata={"shadow": True},
            ).to_dict()

        if execution.get("status") == "no_op":
            return VerificationReport.passed_report(
                "no_op_execution",
                metadata={"operation_count": 0},
            ).to_dict()

        if execution.get("status") == "failed":
            error = execution.get("error") or {}
            code = str(error.get("code") or "execution_failed")
            issue = VerificationIssue(
                code=code,
                message=str(error.get("message") or code),
                severity="error",
                component="canvas_native_executor",
                metadata={"retryable": bool(execution.get("retryable"))},
            )
            return VerificationReport.failed_report(
                "execution_failed",
                issues=(issue,),
                metadata={
                    "retryable": bool(execution.get("retryable")),
                    "error": error,
                    "current_server_version": self._extract_current_server_version(error.get("detail")),
                },
            ).to_dict()

        snapshot_doc, snapshot_source, snapshot_warnings = await self._context_resolver.fetch_snapshot(
            canvas_id=context.get("canvas_id"),
            workspace_id=context.get("workspace_id"),
        )
        if not isinstance(snapshot_doc, dict):
            issue = VerificationIssue(
                code="snapshot_unavailable",
                message="Post-execution snapshot is unavailable.",
                severity="error",
                component="canvas_native_verifier",
                metadata={"snapshot_source": snapshot_source},
            )
            return VerificationReport.failed_report(
                "verification_snapshot_unavailable",
                issues=(issue,),
                metadata={
                    "retryable": True,
                    "snapshot_source": snapshot_source,
                    "snapshot_warnings": snapshot_warnings,
                },
            ).to_dict()

        issues: list[VerificationIssue] = []
        node_ids = {
            str(node.get("id"))
            for node in (snapshot_doc.get("nodes") or [])
            if isinstance(node, dict) and node.get("id")
        }
        connection_pairs = {
            (
                str(connection.get("from") or ""),
                str(connection.get("to") or ""),
            )
            for connection in (snapshot_doc.get("connections") or [])
            if isinstance(connection, dict)
        }
        node_positions = {
            str(node.get("id")): (
                float(node.get("x") or 0.0),
                float(node.get("y") or 0.0),
            )
            for node in (snapshot_doc.get("nodes") or [])
            if isinstance(node, dict) and node.get("id")
        }
        node_content = {
            str(node.get("id")): str(
                node.get("content")
                or node.get("text")
                or node.get("title")
                or node.get("label")
                or ""
            ).strip()
            for node in (snapshot_doc.get("nodes") or [])
            if isinstance(node, dict) and node.get("id")
        }
        transform_metadata = execution.get("transform_metadata") or {}

        expected_version = execution.get("expected_version")
        current_server_version = snapshot_doc.get("serverVersion")
        try:
            if expected_version is not None and current_server_version is not None and int(current_server_version) == int(expected_version):
                issues.append(
                    VerificationIssue(
                        code="server_version_unchanged",
                        message="Canvas server version did not advance after native execution.",
                        severity="error",
                        component="canvas_native_verifier",
                        metadata={
                            "expected_version": expected_version,
                            "current_server_version": current_server_version,
                        },
                    )
                )
        except Exception:
            pass

        for entity in task.get("entities") or []:
            entity_id = str(entity.get("entity_id") or "")
            if entity_id and entity_id not in node_ids:
                issues.append(
                    VerificationIssue(
                        code="missing_created_node",
                        message=f"Created node not found after execution: {entity_id}",
                        severity="error",
                        component="canvas_native_verifier",
                        metadata={"entity_id": entity_id},
                    )
                )

        for connection in task.get("connections") or []:
            pair = (
                str(connection.get("source_entity_id") or ""),
                str(connection.get("target_entity_id") or ""),
            )
            if pair[0] and pair[1] and pair not in connection_pairs:
                issues.append(
                    VerificationIssue(
                        code="missing_created_connection",
                        message=f"Created connection not found after execution: {pair[0]} -> {pair[1]}",
                        severity="error",
                        component="canvas_native_verifier",
                        metadata={"pair": pair},
                    )
                )

        expected_positions = execution.get("expected_positions") or {}
        for entity_id, target in expected_positions.items():
            if entity_id not in node_positions:
                continue
            current_x, current_y = node_positions[entity_id]
            try:
                target_x = float(target.get("x") or 0.0)
                target_y = float(target.get("y") or 0.0)
            except Exception:
                continue
            if abs(current_x - target_x) > 4.0 or abs(current_y - target_y) > 4.0:
                issues.append(
                    VerificationIssue(
                        code="layout_position_mismatch",
                        message=f"Layout verification mismatch for node {entity_id}",
                        severity="warning",
                        component="canvas_native_verifier",
                        metadata={
                            "entity_id": entity_id,
                            "expected": {"x": target_x, "y": target_y},
                            "actual": {"x": current_x, "y": current_y},
                        },
                        )
                    )

        for transform in task.get("transforms") or []:
            kind = str(transform.get("kind") or "")
            payload = transform.get("payload") or {}
            target_ids = [str(entity_id) for entity_id in (transform.get("target_entity_ids") or []) if entity_id]

            if kind == "retitle_selection":
                titles = [str(title).strip() for title in (payload.get("titles") or []) if str(title).strip()]
                for node_id, title in zip(target_ids, titles, strict=False):
                    if node_content.get(node_id) == title:
                        continue
                    issues.append(
                        VerificationIssue(
                            code="retitled_node_mismatch",
                            message=f"Retitled node content mismatch for {node_id}",
                            severity="error",
                            component="canvas_native_verifier",
                            metadata={
                                "entity_id": node_id,
                                "expected_title": title,
                                "actual_title": node_content.get(node_id),
                            },
                        )
                    )

            if kind == "split_node_into_children":
                parent_node_id = str(payload.get("parent_node_id") or (target_ids[0] if target_ids else ""))
                child_ids = [str(node_id) for node_id in (payload.get("child_node_ids") or []) if str(node_id)]
                child_titles = [str(title).strip() for title in (payload.get("titles") or []) if str(title).strip()]
                for child_id, child_title in zip(child_ids, child_titles, strict=False):
                    if child_id not in node_ids:
                        issues.append(
                            VerificationIssue(
                                code="missing_split_child_node",
                                message=f"Split child node not found after execution: {child_id}",
                                severity="error",
                                component="canvas_native_verifier",
                                metadata={"child_node_id": child_id, "parent_node_id": parent_node_id},
                            )
                        )
                        continue
                    if node_content.get(child_id) != child_title:
                        issues.append(
                            VerificationIssue(
                                code="split_child_title_mismatch",
                                message=f"Split child node content mismatch for {child_id}",
                                severity="error",
                                component="canvas_native_verifier",
                                metadata={
                                    "child_node_id": child_id,
                                    "expected_title": child_title,
                                    "actual_title": node_content.get(child_id),
                                },
                            )
                        )
                    pair = (parent_node_id, child_id)
                    if pair in connection_pairs:
                        continue
                    issues.append(
                        VerificationIssue(
                            code="missing_split_connection",
                            message=f"Split connection not found after execution: {parent_node_id} -> {child_id}",
                            severity="error",
                            component="canvas_native_verifier",
                            metadata={"pair": pair},
                        )
                    )
                continue

            if kind == "merge_selection_into_node":
                merged_node_id = str(payload.get("merged_node_id") or "")
                merged_title = str(payload.get("title") or "合并结果").strip() or "合并结果"
                if merged_node_id not in node_ids:
                    issues.append(
                        VerificationIssue(
                            code="missing_merged_node",
                            message=f"Merged node not found after execution: {merged_node_id}",
                            severity="error",
                            component="canvas_native_verifier",
                            metadata={"merged_node_id": merged_node_id},
                        )
                    )
                    continue
                if node_content.get(merged_node_id) != merged_title:
                    issues.append(
                        VerificationIssue(
                            code="merged_title_mismatch",
                            message=f"Merged node content mismatch for {merged_node_id}",
                            severity="error",
                            component="canvas_native_verifier",
                            metadata={
                                "merged_node_id": merged_node_id,
                                "expected_title": merged_title,
                                "actual_title": node_content.get(merged_node_id),
                            },
                        )
                    )
                for target_id in target_ids:
                    if target_id in node_ids:
                        issues.append(
                            VerificationIssue(
                                code="merged_source_not_deleted",
                                message=f"Merged source node still exists after execution: {target_id}",
                                severity="error",
                                component="canvas_native_verifier",
                                metadata={"entity_id": target_id, "merged_node_id": merged_node_id},
                            )
                        )
                merged_records = [
                    record
                    for record in (transform_metadata.get("merged_nodes") or [])
                    if isinstance(record, dict) and str(record.get("merged_node_id") or "") == merged_node_id
                ]
                for record in merged_records:
                    for pair in record.get("replacement_pairs") or []:
                        if not isinstance(pair, dict):
                            continue
                        pair_tuple = (str(pair.get("from") or ""), str(pair.get("to") or ""))
                        if not pair_tuple[0] or not pair_tuple[1] or pair_tuple in connection_pairs:
                            continue
                        issues.append(
                            VerificationIssue(
                                code="missing_merged_reconnection",
                                message=f"Merged reconnection not found after execution: {pair_tuple[0]} -> {pair_tuple[1]}",
                                severity="error",
                                component="canvas_native_verifier",
                                metadata={"pair": pair_tuple, "merged_node_id": merged_node_id},
                            )
                        )
                continue

            if kind != "create_summary_hub":
                continue

            summary_node_id = str(payload.get("summary_node_id") or "")
            summary_title = str(payload.get("title") or "总结").strip() or "总结"
            if summary_node_id not in node_ids:
                issues.append(
                    VerificationIssue(
                        code="missing_summary_node",
                        message=f"Summary node not found after execution: {summary_node_id}",
                        severity="error",
                        component="canvas_native_verifier",
                        metadata={"summary_node_id": summary_node_id},
                    )
                )
                continue
            if node_content.get(summary_node_id) != summary_title:
                issues.append(
                    VerificationIssue(
                        code="summary_title_mismatch",
                        message=f"Summary node content mismatch for {summary_node_id}",
                        severity="error",
                        component="canvas_native_verifier",
                        metadata={
                            "summary_node_id": summary_node_id,
                            "expected_title": summary_title,
                            "actual_title": node_content.get(summary_node_id),
                        },
                    )
                )
            for target_id in target_ids:
                pair = (summary_node_id, target_id)
                if pair in connection_pairs:
                    continue
                issues.append(
                    VerificationIssue(
                        code="missing_summary_connection",
                        message=f"Summary connection not found after execution: {summary_node_id} -> {target_id}",
                        severity="error",
                        component="canvas_native_verifier",
                        metadata={"pair": pair},
                    )
                )

        metadata = {
            "snapshot_source": snapshot_source,
            "snapshot_warnings": snapshot_warnings,
            "current_server_version": current_server_version,
            "issue_codes": [issue.code for issue in issues],
        }

        if issues:
            retryable = any(
                issue.code in {
                    "server_version_unchanged",
                    "missing_created_node",
                    "missing_created_connection",
                    "missing_summary_node",
                    "missing_summary_connection",
                    "missing_split_child_node",
                    "missing_split_connection",
                    "missing_merged_node",
                    "merged_source_not_deleted",
                    "missing_merged_reconnection",
                }
                for issue in issues
            )
            metadata["retryable"] = retryable
            metrics.incr("canvas_native.verify.failed", 1)
            return VerificationReport.failed_report(
                "verification_failed",
                issues=tuple(issues),
                metadata=metadata,
            ).to_dict()

        metrics.incr("canvas_native.verify.passed", 1)
        return VerificationReport.passed_report(
            "verification_passed",
            metadata=metadata,
        ).to_dict()

    def _extract_current_server_version(self, detail: Any) -> int | None:
        if not isinstance(detail, dict):
            return None
        raw_value = detail.get("serverVersion") or detail.get("server_version")
        try:
            return int(raw_value)
        except Exception:
            return None
