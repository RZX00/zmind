from __future__ import annotations

import json
import os
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

from langgraph.graph import END, START, StateGraph
from langgraph.types import Send

from core.langgraph_engine.billing.billing_guard import BillingGuard
from core.langgraph_engine.contracts.engine_interface import RunConfig
from core.langgraph_engine.contracts.event_schema import StatusEvent, ToolMessageEvent
from core.langgraph_engine.contracts.tool_interface import ToolCall, ToolExecutionResult, ToolRegistry
from core.langgraph_engine.tools.adapters.structured_output_adapter import wrap_raw_output
from core.langgraph_engine.tools.catalog import build_registry
from core.services.llm import make_llm_api_call
from core.utils.logger import logger

from .prompts import (
    get_answer_prompt,
    get_clarify_prompt,
    get_current_date,
    get_extract_claims_prompt,
    get_query_writer_prompt,
    get_reflection_prompt,
    get_rewrite_prompt,
    get_verify_claims_prompt,
)
from .schemas import (
    ClaimExtractionResult,
    ClaimVerificationResult,
    ClarificationResult,
    ReflectionResult,
    ResearchPlanPayload,
    ResearchRewriteResult,
    SearchQueryList,
)
from .state import (
    ClaimExtractionState,
    ClaimVerificationState,
    CitationValidationState,
    ClarificationState,
    ConfidenceScoreState,
    ConflictDetectionState,
    QueryGenerationState,
    ReflectionState,
    ResearchGraphState,
    RewriteState,
    WebSearchState,
)
from .utils import (
    append_sources_section,
    apply_source_links,
    assign_source_ids,
    collect_sources,
    dedupe_sources,
    extract_json_payload,
    extract_top_urls,
    extract_research_topic,
    format_extracted_summary,
    format_search_summary,
    normalize_message_content,
    normalize_query_list,
    normalize_extract_response,
    normalize_search_response,
)
from .publication import ResearchPublicationRequest, ResearchPublicationService
from .verification import (
    build_verification_summary,
    compute_citation_coverage,
    detect_conflicts,
    merge_claims,
    normalize_claim_candidates,
    normalize_verification_payload,
    prioritize_claims_for_follow_up,
    score_claim_confidence,
    validate_citation_consistency,
)


EventEmitter = Callable[[dict[str, Any]], Awaitable[None]]


@dataclass(frozen=True)
class ResearchGraphConfig:
    enable_clarify: bool
    enable_rewrite: bool
    enable_plan_confirmation: bool
    phase2_enabled: bool
    phase2_priority_followup_enabled: bool
    phase2_cross_claim_conflict_enabled: bool
    phase2_citation_guard_enabled: bool
    initial_query_count: int
    max_research_loops: int
    max_total_queries: int
    results_per_query: int
    deep_fetch_per_query: int
    max_tool_calls: int
    max_extract_urls: int
    max_runtime_seconds: int
    max_claims: int
    max_evidence_per_claim: int
    phase2_follow_up_claim_limit: int
    phase2_high_importance_min_evidence: int
    publish_enabled: bool
    publish_kb_enabled: bool
    publish_canvas_enabled: bool
    publish_kb_folder_name: str
    publish_canvas_claim_limit: int
    clarify_model: str | None
    rewrite_model: str | None
    query_model: str | None
    claim_model: str | None
    verify_model: str | None
    reflection_model: str | None
    answer_model: str | None


@dataclass
class ResearchGraphContext:
    run_config: RunConfig
    tool_registry: ToolRegistry
    tool_context: dict[str, Any]
    emit: EventEmitter | None
    config: ResearchGraphConfig
    billing_guard: BillingGuard
    tool_calls_used: int = 0
    extracted_urls_count: int = 0
    budget_exhausted_reason: str | None = None
    started_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


def _mark_budget_exhausted(ctx: ResearchGraphContext, reason: str) -> None:
    if not reason:
        return
    if ctx.budget_exhausted_reason:
        return
    ctx.budget_exhausted_reason = reason
    logger.info(
        "Research graph budget exhausted",
        reason=reason,
        agent_run_id=ctx.run_config.agent_run_id,
        thread_id=ctx.run_config.thread_id,
    )


def _runtime_exceeded(ctx: ResearchGraphContext) -> bool:
    if ctx.config.max_runtime_seconds <= 0:
        return False
    elapsed = (datetime.now(timezone.utc) - ctx.started_at).total_seconds()
    return elapsed >= ctx.config.max_runtime_seconds


def _remaining_extract_urls(ctx: ResearchGraphContext) -> int:
    return max(0, ctx.config.max_extract_urls - ctx.extracted_urls_count)


def _remaining_queries(total_ran_queries: int, max_total_queries: int) -> int:
    return max(0, int(max_total_queries) - int(total_ran_queries))


def _get_attr(obj: Any, key: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        return obj.get(key, default)
    try:
        if hasattr(obj, key):
            return getattr(obj, key)
    except Exception:
        return default
    return default


def _extract_llm_text(response: Any) -> str:
    choices = _get_attr(response, "choices", []) or []
    if choices:
        choice0 = choices[0]
        message = _get_attr(choice0, "message", None)
        content = _get_attr(message, "content", None)
        if content is None:
            content = _get_attr(message, "parts", None)
        if content is not None:
            return normalize_message_content(content)
    return normalize_message_content(response)


def _extract_usage(response: Any) -> dict[str, Any]:
    usage_obj = _get_attr(response, "usage", None)
    if usage_obj is None:
        return {}
    try:
        if hasattr(usage_obj, "model_dump"):
            return usage_obj.model_dump()  # type: ignore[no-any-return]
        if isinstance(usage_obj, dict):
            return dict(usage_obj)
    except Exception:
        return {}
    return {}


async def _bill_llm_call(ctx: ResearchGraphContext, usage: dict[str, Any], model_name: str) -> None:
    if not usage:
        return
    try:
        event = {
            "type": "llm_response_end",
            "timestamp": _now_iso(),
            "agent_run_id": ctx.run_config.agent_run_id,
            "thread_id": ctx.run_config.thread_id,
            "message_id": str(uuid.uuid4()),
            "llm_response_id": f"llm_{uuid.uuid4().hex}",
            "model": model_name,
            "usage": usage,
            "finish_reason": "stop",
        }
        state = {
            "agent_run_id": ctx.run_config.agent_run_id,
            "thread_id": ctx.run_config.thread_id,
            "project_id": ctx.run_config.project_id,
            "account_id": ctx.run_config.account_id,
            "model_name": model_name,
            "enable_thinking": ctx.run_config.enable_thinking,
            "reasoning_effort": ctx.run_config.reasoning_effort,
            "enable_context_manager": ctx.run_config.enable_context_manager,
            "enable_prompt_caching": ctx.run_config.enable_prompt_caching,
            "agent_config": ctx.run_config.agent_config,
            "messages_context": [],
            "session_index": 0,
            "iteration": 0,
            "max_iterations": ctx.run_config.max_iterations,
            "pending_tool_calls": [],
            "tool_results": [],
            "termination": {"should_terminate": False, "reason": "running"},
            "checkpoint_id": None,
            "checkpoint_thread_id": ctx.run_config.agent_run_id,
            "engine": ctx.run_config.engine,
            "engine_version": ctx.run_config.engine_version,
            "is_shadow": ctx.run_config.is_shadow,
            "shadow_parent_run_id": ctx.run_config.shadow_parent_run_id,
            "side_effect_policy": ctx.run_config.side_effect_policy,
        }
        await ctx.billing_guard.deduct_once(state, event)  # type: ignore[arg-type]
    except Exception as exc:
        logger.debug("Subagent billing failed", error=str(exc))


async def _call_llm(
    ctx: ResearchGraphContext,
    *,
    prompt: str,
    temperature: float,
    model_name: str | None = None,
    response_format: dict[str, Any] | None = None,
) -> str:
    messages = [
        {"role": "system", "content": "You are a careful research assistant."},
        {"role": "user", "content": prompt},
    ]
    resolved_model = model_name or ctx.run_config.model_name
    response = await make_llm_api_call(
        messages=messages,
        model_name=resolved_model,
        temperature=temperature,
        response_format=response_format,
        enable_thinking=ctx.run_config.enable_thinking,
        reasoning_effort=ctx.run_config.reasoning_effort,
    )
    text = _extract_llm_text(response)
    usage = _extract_usage(response)
    await _bill_llm_call(ctx, usage, resolved_model)
    return text


async def _call_llm_json(
    ctx: ResearchGraphContext,
    *,
    prompt: str,
    model_name: str | None,
    temperature: float,
    schema_type: type[Any] | None = None,
) -> dict[str, Any]:
    response_text = await _call_llm(
        ctx,
        prompt=prompt,
        temperature=temperature,
        model_name=model_name,
        response_format={"type": "json_object"},
    )
    payload = extract_json_payload(response_text)
    if isinstance(payload, dict):
        if schema_type:
            try:
                validated = schema_type.model_validate(payload)
                return validated.model_dump()
            except Exception:
                return payload
        return payload

    # One-shot repair if response was not JSON.
    repair_prompt = (
        "Fix the following output into a JSON object with the required keys only. "
        "Return JSON only.\n\n"
        f"OUTPUT:\n{response_text}"
    )
    repair_text = await _call_llm(
        ctx,
        prompt=repair_prompt,
        temperature=0.0,
        model_name=model_name,
        response_format={"type": "json_object"},
    )
    repaired = extract_json_payload(repair_text)
    if isinstance(repaired, dict):
        if schema_type:
            try:
                validated = schema_type.model_validate(repaired)
                return validated.model_dump()
            except Exception:
                return repaired
        return repaired
    return {"_raw_text": response_text}


async def _emit_tool_event(
    ctx: ResearchGraphContext,
    *,
    event: dict[str, Any],
) -> None:
    if ctx.emit is None:
        return
    try:
        await ctx.emit(event)
    except Exception as exc:
        logger.debug("Subagent tool event forward failed", error=str(exc))


async def _emit_tool_started(
    ctx: ResearchGraphContext,
    *,
    tool_name: str,
    tool_call_id: str,
    tool_index: int,
) -> None:
    await _emit_tool_event(
        ctx,
        event=StatusEvent(
            type="status",
            timestamp=_now_iso(),
            agent_run_id=ctx.run_config.agent_run_id,
            thread_id=ctx.run_config.thread_id,
            status_type="tool_started",
            message=f"Starting execution of {tool_name}",
            data={
                "role": "assistant",
                "tool": tool_name,
                "function_name": tool_name,
                "xml_tag_name": None,
                "message": f"Starting execution of {tool_name}",
                "tool_index": tool_index,
                "tool_call_id": tool_call_id,
            },
        ),
    )


async def _emit_tool_message(
    ctx: ResearchGraphContext,
    *,
    tool_call: ToolCall,
    result: ToolExecutionResult,
    tool_index: int,
) -> None:
    content_payload = result.get("output")
    if content_payload is None and result.get("error"):
        content_payload = {"error": result.get("error")}
    content_str = json.dumps(content_payload or {})
    tool_exec = {
        "function_name": tool_call.get("name"),
        "xml_tag_name": None,
        "tool_call_id": tool_call.get("id"),
        "arguments": tool_call.get("arguments"),
        "result": {
            "success": result.get("success", False),
            "output": content_payload,
            "error": result.get("error"),
        },
        "execution_details": {
            "started_at": result.get("started_at"),
            "ended_at": result.get("ended_at"),
        },
    }
    metadata = dict(result.get("metadata") or {})
    frontend_content = metadata.get("frontend_content")
    if not isinstance(frontend_content, dict):
        frontend_content = {}
    frontend_content.setdefault("tool_execution", tool_exec)
    metadata["frontend_content"] = frontend_content

    await _emit_tool_event(
        ctx,
        event=ToolMessageEvent(
            type="tool_message",
            timestamp=_now_iso(),
            agent_run_id=ctx.run_config.agent_run_id,
            thread_id=ctx.run_config.thread_id,
            tool_call_id=tool_call.get("id") or "",
            name=tool_call.get("name") or "",
            message_id=str(uuid.uuid4()),
            content=content_str,
            success=bool(result.get("success")),
            error=result.get("error"),
            metadata=metadata or None,
        ),
    )

    status_type = "tool_completed" if result.get("success", False) else "tool_failed"
    await _emit_tool_event(
        ctx,
        event=StatusEvent(
            type="status",
            timestamp=_now_iso(),
            agent_run_id=ctx.run_config.agent_run_id,
            thread_id=ctx.run_config.thread_id,
            status_type=status_type,
            message=f"Tool {tool_call.get('name')} {'completed successfully' if status_type == 'tool_completed' else 'failed'}",
            data={
                "role": "assistant",
                "tool": tool_call.get("name"),
                "function_name": tool_call.get("name"),
                "xml_tag_name": None,
                "message": f"Tool {tool_call.get('name')} {'completed successfully' if status_type == 'tool_completed' else 'failed'}",
                "tool_index": tool_index,
                "tool_call_id": tool_call.get("id"),
                "error": result.get("error"),
            },
        ),
    )


async def _execute_tool_call(
    ctx: ResearchGraphContext,
    *,
    tool_name: str,
    args: dict[str, Any],
    tool_index: int,
) -> ToolExecutionResult:
    tool_call_id = str(uuid.uuid4())
    tool_call: ToolCall = {"id": tool_call_id, "name": tool_name, "arguments": args}
    started_at = _now_iso()
    await _emit_tool_started(ctx, tool_name=tool_name, tool_call_id=tool_call_id, tool_index=tool_index)

    if _runtime_exceeded(ctx):
        _mark_budget_exhausted(ctx, "max_runtime_seconds_reached")
        budget_result: ToolExecutionResult = {
            "tool_call_id": tool_call_id,
            "name": tool_name,
            "success": False,
            "started_at": started_at,
            "ended_at": _now_iso(),
            "error": "budget_exhausted:max_runtime_seconds",
            "metadata": {"budget_exhausted_reason": ctx.budget_exhausted_reason},
        }
        await _emit_tool_message(ctx, tool_call=tool_call, result=budget_result, tool_index=tool_index)
        return budget_result

    if ctx.tool_calls_used >= ctx.config.max_tool_calls:
        _mark_budget_exhausted(ctx, "max_tool_calls_reached")
        budget_result = {
            "tool_call_id": tool_call_id,
            "name": tool_name,
            "success": False,
            "started_at": started_at,
            "ended_at": _now_iso(),
            "error": "budget_exhausted:max_tool_calls",
            "metadata": {"budget_exhausted_reason": ctx.budget_exhausted_reason},
        }
        await _emit_tool_message(ctx, tool_call=tool_call, result=budget_result, tool_index=tool_index)
        return budget_result

    context = dict(ctx.tool_context or {})
    context.setdefault("run_config", ctx.run_config)
    context.setdefault("thread_id", ctx.run_config.thread_id)
    context.setdefault("project_id", ctx.run_config.project_id)
    context.setdefault("agent_config", ctx.run_config.agent_config)
    context.setdefault("side_effect_policy", ctx.run_config.side_effect_policy)
    context.setdefault("is_shadow", ctx.run_config.is_shadow)

    ctx.tool_calls_used += 1
    result = await ctx.tool_registry.execute_tool_call(tool_call, context)
    result = wrap_raw_output(result)
    await _emit_tool_message(ctx, tool_call=tool_call, result=result, tool_index=tool_index)
    return result


def _resolve_config(run_config: RunConfig) -> ResearchGraphConfig:
    agent_cfg = run_config.agent_config or {}

    def _coerce_int(value: Any, fallback: int) -> int:
        try:
            return max(1, int(value))
        except Exception:
            return fallback

    def _coerce_nonneg(value: Any, fallback: int) -> int:
        try:
            return max(0, int(value))
        except Exception:
            return fallback

    def _coerce_bool(value: Any, fallback: bool) -> bool:
        if value is None:
            return fallback
        if isinstance(value, bool):
            return value
        return str(value).strip().lower() in ("1", "true", "yes", "on")

    enable_clarify = _coerce_bool(agent_cfg.get("research_enable_clarify"), True)
    enable_rewrite = _coerce_bool(agent_cfg.get("research_enable_rewrite"), True)
    enable_plan_confirmation = _coerce_bool(agent_cfg.get("research_enable_plan_confirmation"), True)
    phase2_enabled = _coerce_bool(agent_cfg.get("research_phase2_enabled"), True)
    phase2_priority_followup_enabled = _coerce_bool(
        agent_cfg.get("research_phase2_priority_followup_enabled"),
        True,
    )
    phase2_cross_claim_conflict_enabled = _coerce_bool(
        agent_cfg.get("research_phase2_cross_claim_conflict_enabled"),
        True,
    )
    phase2_citation_guard_enabled = _coerce_bool(
        agent_cfg.get("research_phase2_citation_guard_enabled"),
        True,
    )
    initial_query_count = _coerce_int(agent_cfg.get("research_query_count"), 4)
    max_research_loops = _coerce_int(agent_cfg.get("research_max_loops"), 2)
    max_total_queries = _coerce_int(agent_cfg.get("research_max_total_queries"), 10)
    results_per_query = _coerce_int(agent_cfg.get("research_results_per_query"), 8)
    deep_fetch_per_query = _coerce_nonneg(agent_cfg.get("research_deep_fetch_per_query"), 2)
    max_tool_calls = _coerce_int(agent_cfg.get("research_max_tool_calls"), 24)
    max_extract_urls = _coerce_nonneg(agent_cfg.get("research_max_extract_urls"), 24)
    max_runtime_seconds = _coerce_nonneg(agent_cfg.get("research_max_runtime_seconds"), 300)
    max_claims = _coerce_int(agent_cfg.get("research_max_claims"), 8)
    max_evidence_per_claim = _coerce_int(agent_cfg.get("research_max_evidence_per_claim"), 3)
    phase2_follow_up_claim_limit = _coerce_int(agent_cfg.get("research_phase2_follow_up_claim_limit"), 3)
    phase2_high_importance_min_evidence = _coerce_int(
        agent_cfg.get("research_phase2_high_importance_min_evidence"),
        2,
    )
    publish_enabled = _coerce_bool(agent_cfg.get("research_publish_enabled"), True)
    publish_kb_enabled = _coerce_bool(
        agent_cfg.get("research_publish_kb_enabled"),
        True,
    )
    publish_canvas_enabled = _coerce_bool(
        agent_cfg.get("research_publish_canvas_enabled"),
        True,
    )
    publish_kb_folder_name = str(
        agent_cfg.get("research_publish_kb_folder_name") or "Deep Research Reports"
    ).strip() or "Deep Research Reports"
    publish_canvas_claim_limit = _coerce_int(
        agent_cfg.get("research_publish_canvas_claim_limit"),
        4,
    )
    clarify_model = agent_cfg.get("research_clarify_model")
    rewrite_model = agent_cfg.get("research_rewrite_model")
    query_model = agent_cfg.get("research_query_model")
    claim_model = agent_cfg.get("research_claim_model")
    verify_model = agent_cfg.get("research_verify_model")
    reflection_model = agent_cfg.get("research_reflection_model")
    answer_model = agent_cfg.get("research_answer_model")
    return ResearchGraphConfig(
        enable_clarify=enable_clarify,
        enable_rewrite=enable_rewrite,
        enable_plan_confirmation=enable_plan_confirmation,
        phase2_enabled=phase2_enabled,
        phase2_priority_followup_enabled=phase2_priority_followup_enabled,
        phase2_cross_claim_conflict_enabled=phase2_cross_claim_conflict_enabled,
        phase2_citation_guard_enabled=phase2_citation_guard_enabled,
        initial_query_count=initial_query_count,
        max_research_loops=max_research_loops,
        max_total_queries=max_total_queries,
        results_per_query=results_per_query,
        deep_fetch_per_query=deep_fetch_per_query,
        max_tool_calls=max_tool_calls,
        max_extract_urls=max_extract_urls,
        max_runtime_seconds=max_runtime_seconds,
        max_claims=max_claims,
        max_evidence_per_claim=max_evidence_per_claim,
        phase2_follow_up_claim_limit=phase2_follow_up_claim_limit,
        phase2_high_importance_min_evidence=phase2_high_importance_min_evidence,
        publish_enabled=publish_enabled,
        publish_kb_enabled=publish_kb_enabled,
        publish_canvas_enabled=publish_canvas_enabled,
        publish_kb_folder_name=publish_kb_folder_name,
        publish_canvas_claim_limit=publish_canvas_claim_limit,
        clarify_model=clarify_model,
        rewrite_model=rewrite_model,
        query_model=query_model,
        claim_model=claim_model,
        verify_model=verify_model,
        reflection_model=reflection_model,
        answer_model=answer_model,
    )


def _normalize_follow_up_queries(raw: Any, fallback: list[str]) -> list[str]:
    queries = normalize_query_list(raw)
    if queries:
        return queries
    return fallback


def _build_graph(ctx: ResearchGraphContext) -> StateGraph:
    def _resolved_research_topic(state: ResearchGraphState) -> str:
        rewritten = str(state.get("rewritten_task") or "").strip()
        if rewritten:
            return rewritten
        clarified = str(state.get("clarified_task") or "").strip()
        if clarified:
            return clarified
        return extract_research_topic(state.get("messages", []))

    async def clarify_intent(state: ResearchGraphState) -> ClarificationState:
        # Skip if already populated (confirmed_queries flow)
        existing = str(state.get("clarified_task") or "").strip()
        if existing:
            return {"clarified_task": existing, "clarification_notes": str(state.get("clarification_notes") or "")}

        raw_topic = extract_research_topic(state.get("messages", []))
        if not ctx.config.enable_clarify:
            return {"clarified_task": raw_topic, "clarification_notes": ""}

        prompt = get_clarify_prompt(
            current_date=get_current_date(),
            research_topic=raw_topic,
        )
        payload = await _call_llm_json(
            ctx,
            prompt=prompt,
            temperature=0.2,
            model_name=ctx.config.clarify_model,
            schema_type=ClarificationResult,
        )
        clarified_task = raw_topic
        clarification_notes = ""
        if isinstance(payload, dict):
            candidate = str(payload.get("clarified_task") or "").strip()
            if candidate:
                clarified_task = candidate
            needs_clarification = bool(payload.get("needs_clarification"))
            clarification_notes = str(payload.get("clarification_note") or "").strip()
            assumptions = normalize_query_list(payload.get("assumptions"))
            if assumptions:
                clarification_notes = "\n".join(
                    [clarification_notes] + [f"- {assumption}" for assumption in assumptions]
                ).strip()
            if needs_clarification and clarification_notes:
                clarification_notes = f"Needs clarification:\n{clarification_notes}"

        return {"clarified_task": clarified_task, "clarification_notes": clarification_notes}

    async def rewrite_task(state: ResearchGraphState) -> RewriteState:
        # Skip if already populated (confirmed_queries flow)
        existing = str(state.get("rewritten_task") or "").strip()
        if existing:
            return {"rewritten_task": existing, "rewrite_notes": str(state.get("rewrite_notes") or "")}

        clarified_topic = str(state.get("clarified_task") or "").strip() or extract_research_topic(state.get("messages", []))
        if not ctx.config.enable_rewrite:
            return {"rewritten_task": clarified_topic, "rewrite_notes": ""}

        prompt = get_rewrite_prompt(
            current_date=get_current_date(),
            clarified_task=clarified_topic,
            clarification_notes=str(state.get("clarification_notes") or ""),
        )
        payload = await _call_llm_json(
            ctx,
            prompt=prompt,
            temperature=0.3,
            model_name=ctx.config.rewrite_model,
            schema_type=ResearchRewriteResult,
        )
        rewritten_task = clarified_topic
        rewrite_notes = ""
        if isinstance(payload, dict):
            candidate = str(payload.get("rewritten_task") or "").strip()
            if candidate:
                rewritten_task = candidate
            focus_areas = normalize_query_list(payload.get("focus_areas"))
            if focus_areas:
                rewrite_notes = "\n".join(f"- {area}" for area in focus_areas)

        return {"rewritten_task": rewritten_task, "rewrite_notes": rewrite_notes}

    async def generate_query(state: ResearchGraphState) -> QueryGenerationState:
        # Skip if already populated (confirmed_queries flow).
        # Return empty list to avoid duplication — search_query uses operator.add.
        existing_queries = state.get("search_query") or []
        if existing_queries:
            return {"search_query": [], "query_rationale": str(state.get("query_rationale") or "")}

        topic = _resolved_research_topic(state)
        max_queries = min(
            int(state.get("initial_search_query_count") or ctx.config.initial_query_count),
            int(state.get("max_total_queries") or ctx.config.max_total_queries),
        )
        prompt = get_query_writer_prompt(
            current_date=get_current_date(),
            research_topic=topic,
            number_queries=max_queries,
        )
        payload = await _call_llm_json(
            ctx,
            prompt=prompt,
            temperature=0.9,
            model_name=ctx.config.query_model,
            schema_type=SearchQueryList,
        )
        rationale = ""
        if isinstance(payload, dict):
            rationale = str(payload.get("rationale") or "").strip()
        queries = normalize_query_list(payload.get("query") if isinstance(payload, dict) else None)
        if not queries:
            raw_text = payload.get("_raw_text") if isinstance(payload, dict) else None
            queries = normalize_query_list(raw_text)
        if not queries:
            queries = [topic]

        queries = [q for q in queries if q.strip()]
        seen = set()
        deduped: list[str] = []
        for query in queries:
            if query in seen:
                continue
            seen.add(query)
            deduped.append(query)
            if len(deduped) >= max_queries:
                break

        return {"search_query": deduped, "query_rationale": rationale}

    def continue_to_web_research(state: QueryGenerationState):
        if _runtime_exceeded(ctx):
            _mark_budget_exhausted(ctx, "max_runtime_seconds_reached")
            return []
        queries = state.get("search_query") or []
        return [
            Send("web_research", {"search_query": query, "query_index": int(idx)})
            for idx, query in enumerate(queries)
        ]

    async def web_research(state: WebSearchState) -> ResearchGraphState:
        query = state.get("search_query", "")
        query_index = int(state.get("query_index", 0))
        if not query:
            return {"search_query": [], "web_research_result": [], "sources_gathered": []}
        if _runtime_exceeded(ctx):
            _mark_budget_exhausted(ctx, "max_runtime_seconds_reached")
            return {
                "search_query": [query],
                "web_research_result": ["Research budget exhausted before web search execution."],
                "sources_gathered": [],
            }
        if ctx.budget_exhausted_reason:
            return {
                "search_query": [query],
                "web_research_result": [f"Research budget exhausted: {ctx.budget_exhausted_reason}."],
                "sources_gathered": [],
            }

        result = await _execute_tool_call(
            ctx,
            tool_name="intelligent_web_search",
            args={
                "query": query,
                "num_results": ctx.config.results_per_query,
                "search_depth": "advanced",
                "include_images": False,
            },
            tool_index=query_index,
        )

        output = result.get("output")
        response = normalize_search_response(output)
        summary = format_search_summary(query, response, max_items=min(6, ctx.config.results_per_query))
        sources = collect_sources(query, response)

        deep_summary = ""
        if ctx.config.deep_fetch_per_query > 0:
            remaining_extract_urls = _remaining_extract_urls(ctx)
            if remaining_extract_urls <= 0:
                _mark_budget_exhausted(ctx, "max_extract_urls_reached")
                urls = []
            else:
                urls = extract_top_urls(response, limit=min(ctx.config.deep_fetch_per_query, remaining_extract_urls))
            if urls:
                ctx.extracted_urls_count += len(urls)
                extract_result = await _execute_tool_call(
                    ctx,
                    tool_name="extract_web_content",
                    args={
                        "urls": ", ".join(urls),
                        "extract_mode": "structured",
                        "summarize": True,
                    },
                    tool_index=query_index,
                )
                extracted_items = normalize_extract_response(extract_result.get("output"))
                deep_summary = format_extracted_summary(
                    extracted_items,
                    max_items=min(4, len(extracted_items)),
                )
                if extracted_items:
                    existing_urls = {source.get("url") for source in sources if source.get("url")}
                    for item in extracted_items:
                        url = item.get("url")
                        if not url or url in existing_urls:
                            continue
                        sources.append(
                            {
                                "title": item.get("title") or "Source",
                                "url": url,
                                "snippet": (item.get("summary") or "")[:360],
                                "query": query,
                                "published_at": "",
                            }
                        )
                        existing_urls.add(url)

        if deep_summary:
            summary = f"{summary}\n\n{deep_summary}"

        return {
            "search_query": [query],
            "web_research_result": [summary],
            "sources_gathered": sources,
        }

    async def extract_claims(state: ResearchGraphState) -> ClaimExtractionState:
        if not ctx.config.phase2_enabled:
            return {"claims": state.get("claims") or []}

        topic = _resolved_research_topic(state)
        summaries = "\n\n---\n\n".join(state.get("web_research_result") or [])
        if not summaries.strip():
            return {"claims": state.get("claims") or []}

        prompt = get_extract_claims_prompt(
            current_date=get_current_date(),
            research_topic=topic,
            summaries=summaries,
        )
        payload = await _call_llm_json(
            ctx,
            prompt=prompt,
            temperature=0.2,
            model_name=ctx.config.claim_model or ctx.config.reflection_model,
            schema_type=ClaimExtractionResult,
        )
        candidates = normalize_claim_candidates(
            payload.get("claims") if isinstance(payload, dict) else None,
            max_claims=ctx.config.max_claims,
        )
        merged_claims = merge_claims(
            state.get("claims") or [],
            candidates,
            max_claims=ctx.config.max_claims,
        )
        return {"claims": merged_claims}

    async def verify_claims(state: ResearchGraphState) -> ClaimVerificationState:
        claims = state.get("claims") or []
        if not claims:
            verification_summary = build_verification_summary(
                claims=[],
                claim_verdicts=[],
                evidence_graph=[],
                conflicts=[],
                confidence_scores=[],
                citation_issues=[],
                citation_coverage={},
            )
            return {
                "claim_verdicts": [],
                "evidence_graph": [],
                "verification_summary": verification_summary,
            }

        if not ctx.config.phase2_enabled:
            verification_summary = build_verification_summary(
                claims=claims,
                claim_verdicts=state.get("claim_verdicts") or [],
                evidence_graph=state.get("evidence_graph") or [],
                conflicts=state.get("conflicts") or [],
                confidence_scores=state.get("confidence_scores") or [],
                citation_issues=state.get("citation_issues") or [],
                citation_coverage=state.get("citation_coverage") or {},
            )
            return {
                "claim_verdicts": state.get("claim_verdicts") or [],
                "evidence_graph": state.get("evidence_graph") or [],
                "verification_summary": verification_summary,
            }

        topic = _resolved_research_topic(state)
        summaries = "\n\n---\n\n".join(state.get("web_research_result") or [])
        sources = assign_source_ids(dedupe_sources(state.get("sources_gathered") or []))
        payload: dict[str, Any] = {}
        if sources:
            prompt = get_verify_claims_prompt(
                current_date=get_current_date(),
                research_topic=topic,
                claims_json=json.dumps(claims, ensure_ascii=False),
                sources_json=json.dumps(sources, ensure_ascii=False),
                summaries=summaries,
            )
            raw_payload = await _call_llm_json(
                ctx,
                prompt=prompt,
                temperature=0.1,
                model_name=ctx.config.verify_model or ctx.config.reflection_model,
                schema_type=ClaimVerificationResult,
            )
            if isinstance(raw_payload, dict):
                payload = raw_payload

        evidence_graph, claim_verdicts = normalize_verification_payload(
            payload,
            claims=claims,
            sources=sources,
            max_evidence_per_claim=ctx.config.max_evidence_per_claim,
        )
        verification_summary = build_verification_summary(
            claims=claims,
            claim_verdicts=claim_verdicts,
            evidence_graph=evidence_graph,
            conflicts=state.get("conflicts") or [],
            confidence_scores=state.get("confidence_scores") or [],
            citation_issues=state.get("citation_issues") or [],
            citation_coverage=state.get("citation_coverage") or {},
        )
        return {
            "claim_verdicts": claim_verdicts,
            "evidence_graph": evidence_graph,
            "verification_summary": verification_summary,
        }

    async def detect_conflicts_node(state: ResearchGraphState) -> ConflictDetectionState:
        if not ctx.config.phase2_enabled:
            return {
                "conflicts": state.get("conflicts") or [],
                "verification_summary": state.get("verification_summary") or "",
            }

        claims = state.get("claims") or []
        claim_verdicts = state.get("claim_verdicts") or []
        evidence_graph = state.get("evidence_graph") or []
        conflicts = detect_conflicts(
            claim_verdicts,
            evidence_graph,
            claims=claims,
            enable_cross_claim=ctx.config.phase2_cross_claim_conflict_enabled,
        )
        verification_summary = build_verification_summary(
            claims=claims,
            claim_verdicts=claim_verdicts,
            evidence_graph=evidence_graph,
            conflicts=conflicts,
            confidence_scores=state.get("confidence_scores") or [],
            citation_issues=state.get("citation_issues") or [],
            citation_coverage=state.get("citation_coverage") or {},
        )
        return {
            "conflicts": conflicts,
            "verification_summary": verification_summary,
        }

    async def score_confidence_node(state: ResearchGraphState) -> ConfidenceScoreState:
        if not ctx.config.phase2_enabled:
            return {
                "confidence_scores": state.get("confidence_scores") or [],
                "verification_summary": state.get("verification_summary") or "",
            }

        claims = state.get("claims") or []
        claim_verdicts = state.get("claim_verdicts") or []
        evidence_graph = state.get("evidence_graph") or []
        conflicts = state.get("conflicts") or []
        confidence_scores = score_claim_confidence(
            claims=claims,
            claim_verdicts=claim_verdicts,
            evidence_graph=evidence_graph,
            conflicts=conflicts,
        )
        verification_summary = build_verification_summary(
            claims=claims,
            claim_verdicts=claim_verdicts,
            evidence_graph=evidence_graph,
            conflicts=conflicts,
            confidence_scores=confidence_scores,
            citation_issues=state.get("citation_issues") or [],
            citation_coverage=state.get("citation_coverage") or {},
        )
        return {
            "confidence_scores": confidence_scores,
            "verification_summary": verification_summary,
        }

    async def validate_citations_node(state: ResearchGraphState) -> CitationValidationState:
        if not ctx.config.phase2_enabled or not ctx.config.phase2_citation_guard_enabled:
            return {
                "citation_issues": state.get("citation_issues") or [],
                "citation_coverage": state.get("citation_coverage") or {},
                "verification_summary": state.get("verification_summary") or "",
            }

        claims = state.get("claims") or []
        evidence_graph = state.get("evidence_graph") or []
        confidence_scores = state.get("confidence_scores") or []
        sources = assign_source_ids(dedupe_sources(state.get("sources_gathered") or []))

        citation_coverage = compute_citation_coverage(claims, evidence_graph)
        citation_issues = validate_citation_consistency(
            claims,
            evidence_graph,
            sources,
            confidence_scores,
            min_evidence_for_high_importance=ctx.config.phase2_high_importance_min_evidence,
        )

        verification_summary = build_verification_summary(
            claims=claims,
            claim_verdicts=state.get("claim_verdicts") or [],
            evidence_graph=evidence_graph,
            conflicts=state.get("conflicts") or [],
            confidence_scores=confidence_scores,
            citation_issues=citation_issues,
            citation_coverage=citation_coverage,
        )
        return {
            "citation_issues": citation_issues,
            "citation_coverage": citation_coverage,
            "verification_summary": verification_summary,
        }

    async def reflection(state: ResearchGraphState) -> ReflectionState:
        topic = _resolved_research_topic(state)
        summaries = "\n\n---\n\n".join(state.get("web_research_result") or [])
        prompt = get_reflection_prompt(
            current_date=get_current_date(),
            research_topic=topic,
            summaries=summaries,
            verification_summary=str(state.get("verification_summary") or ""),
        )
        payload = await _call_llm_json(
            ctx,
            prompt=prompt,
            temperature=0.6,
            model_name=ctx.config.reflection_model,
            schema_type=ReflectionResult,
        )

        is_sufficient = bool(payload.get("is_sufficient")) if isinstance(payload, dict) else True
        knowledge_gap = ""
        follow_up_queries: list[str] = []
        if isinstance(payload, dict):
            knowledge_gap = str(payload.get("knowledge_gap") or "").strip()
            follow_up_queries = _normalize_follow_up_queries(payload.get("follow_up_queries"), [])

        research_loop_count = state.get("research_loop_count", 0) + 1
        number_of_ran_queries = len(state.get("search_query") or [])
        query_budget_remaining = _remaining_queries(
            total_ran_queries=number_of_ran_queries,
            max_total_queries=state.get("max_total_queries") or ctx.config.max_total_queries,
        )

        if not summaries.strip():
            is_sufficient = False
            follow_up_queries = [topic]

        if ctx.config.phase2_enabled and query_budget_remaining > 0:
            claims = state.get("claims") or []
            citation_issues = state.get("citation_issues") or []
            blocking_citation_issues = [
                issue
                for issue in citation_issues
                if isinstance(issue, dict) and str(issue.get("severity") or "").lower() == "error"
            ]

            prioritized_claims: list[dict[str, Any]] = []
            if ctx.config.phase2_priority_followup_enabled:
                prioritized_claims = prioritize_claims_for_follow_up(
                    claims=claims,
                    claim_verdicts=state.get("claim_verdicts") or [],
                    confidence_scores=state.get("confidence_scores") or [],
                    conflicts=state.get("conflicts") or [],
                    citation_issues=citation_issues,
                    max_items=ctx.config.phase2_follow_up_claim_limit,
                )

            should_force_followup = bool(prioritized_claims or blocking_citation_issues)
            if should_force_followup:
                is_sufficient = False
                if not knowledge_gap:
                    knowledge_gap = "High-priority claims are still weakly verified or citation consistency is incomplete."

                if not follow_up_queries:
                    for item in prioritized_claims[:query_budget_remaining]:
                        claim_text = str(item.get("text") or "").strip()
                        if claim_text:
                            follow_up_queries.append(f"{topic} verify with primary sources: {claim_text}")

                if len(follow_up_queries) < query_budget_remaining and blocking_citation_issues:
                    claim_text_by_id = {
                        str(claim.get("claim_id")): str(claim.get("text") or "").strip()
                        for claim in claims
                        if isinstance(claim, dict) and claim.get("claim_id")
                    }
                    for issue in blocking_citation_issues:
                        if len(follow_up_queries) >= query_budget_remaining:
                            break
                        claim_id = str(issue.get("claim_id") or "").strip()
                        claim_text = str(issue.get("claim_text") or "").strip() or claim_text_by_id.get(claim_id, "")
                        if not claim_text:
                            continue
                        follow_up_queries.append(f"{topic} source consistency check: {claim_text}")

        if query_budget_remaining <= 0:
            _mark_budget_exhausted(ctx, "max_total_queries_reached")
            follow_up_queries = []
        elif follow_up_queries and len(follow_up_queries) > query_budget_remaining:
            follow_up_queries = follow_up_queries[:query_budget_remaining]

        if follow_up_queries:
            deduped_follow_up: list[str] = []
            seen_queries: set[str] = set()
            for query in follow_up_queries:
                normalized_query = query.strip()
                if not normalized_query or normalized_query in seen_queries:
                    continue
                seen_queries.add(normalized_query)
                deduped_follow_up.append(normalized_query)
            follow_up_queries = deduped_follow_up

        return {
            "is_sufficient": is_sufficient,
            "knowledge_gap": knowledge_gap,
            "follow_up_queries": follow_up_queries,
            "research_loop_count": research_loop_count,
            "number_of_ran_queries": number_of_ran_queries,
        }

    def evaluate_research(state: ReflectionState):
        if _runtime_exceeded(ctx):
            _mark_budget_exhausted(ctx, "max_runtime_seconds_reached")
            return "finalize_answer"
        if ctx.budget_exhausted_reason:
            return "finalize_answer"
        max_loops = state.get("max_research_loops") or ctx.config.max_research_loops
        if state.get("is_sufficient") or state.get("research_loop_count", 0) >= max_loops:
            return "finalize_answer"
        follow_up_queries = state.get("follow_up_queries") or []
        if not follow_up_queries:
            return "finalize_answer"
        base_index = state.get("number_of_ran_queries", 0)
        return [
            Send(
                "web_research",
                {"search_query": query, "query_index": base_index + int(idx)},
            )
            for idx, query in enumerate(follow_up_queries)
        ]

    async def publish_research_artifacts(
        *,
        topic: str,
        content: str,
        sources: list[dict[str, Any]],
        verification_payload: dict[str, Any],
    ) -> dict[str, Any]:
        if not ctx.config.publish_enabled:
            return {"status": "disabled"}
        db_connection = ctx.tool_context.get("db_connection")
        if db_connection is None:
            return {"status": "skipped", "warnings": ["missing_db_connection"]}

        try:
            service = ResearchPublicationService(db_connection=db_connection)
            request = ResearchPublicationRequest(
                agent_run_id=ctx.run_config.agent_run_id,
                thread_id=ctx.run_config.thread_id,
                account_id=ctx.run_config.account_id,
                topic=topic,
                final_answer=content,
                sources=sources,
                verification=verification_payload,
                canvas_id=ctx.tool_context.get("canvas_id"),
                publish_kb_enabled=ctx.config.publish_kb_enabled,
                publish_canvas_enabled=ctx.config.publish_canvas_enabled,
                kb_folder_name=ctx.config.publish_kb_folder_name,
                canvas_claim_limit=ctx.config.publish_canvas_claim_limit,
            )
            result = await service.publish(request)
            return result.to_dict()
        except Exception as exc:
            logger.warning(
                "Research artifact publication failed",
                error=str(exc),
                agent_run_id=ctx.run_config.agent_run_id,
                thread_id=ctx.run_config.thread_id,
            )
            return {"status": "failed", "errors": [str(exc)]}

    async def finalize_answer(state: ResearchGraphState) -> ResearchGraphState:
        topic = extract_research_topic(state.get("messages", []))
        summaries = "\n\n---\n\n".join(state.get("web_research_result") or [])
        sources = assign_source_ids(dedupe_sources(state.get("sources_gathered") or []))
        verification_payload = {
            "claims": state.get("claims") or [],
            "claim_verdicts": state.get("claim_verdicts") or [],
            "evidence_graph": state.get("evidence_graph") or [],
            "conflicts": state.get("conflicts") or [],
            "confidence_scores": state.get("confidence_scores") or [],
            "citation_issues": state.get("citation_issues") or [],
            "citation_coverage": state.get("citation_coverage") or {},
            "verification_summary": state.get("verification_summary") or "",
        }
        prompt = get_answer_prompt(
            current_date=get_current_date(),
            research_topic=topic,
            summaries=summaries,
            sources_json=json.dumps(sources, ensure_ascii=False),
            verification_json=json.dumps(verification_payload, ensure_ascii=False),
        )
        content = await _call_llm(
            ctx,
            prompt=prompt,
            temperature=0.2,
            model_name=ctx.config.answer_model,
        )
        if ctx.budget_exhausted_reason:
            content = (
                f"{content.rstrip()}\n\n"
                f"Limitations:\n- Research stopped early due to budget guard: `{ctx.budget_exhausted_reason}`."
            )
        content = apply_source_links(content, sources)
        if "Sources:" not in content:
            content = append_sources_section(content, sources)
        publication = await publish_research_artifacts(
            topic=topic,
            content=content,
            sources=sources,
            verification_payload=verification_payload,
        )
        if publication.get("status") in {"published", "partial"}:
            publish_lines: list[str] = []
            kb_entry_id = publication.get("kb_entry_id")
            canvas_group = publication.get("canvas_group_node_id")
            if kb_entry_id:
                publish_lines.append(f"- Saved to your knowledge base (entry `{kb_entry_id}`).")
            if canvas_group:
                publish_lines.append("- Added a structured research board to your canvas.")
            if publish_lines:
                content = f"{content.rstrip()}\n\nSaved for reuse:\n" + "\n".join(publish_lines)
        return {
            "final_answer": content,
            "final_sources": sources,
            "final_verification": verification_payload,
            "publication": publication,
        }

    graph = StateGraph(ResearchGraphState)
    graph.add_node("clarify_intent", clarify_intent)
    graph.add_node("rewrite_task", rewrite_task)
    graph.add_node("generate_query", generate_query)
    graph.add_node("web_research", web_research)
    graph.add_node("extract_claims", extract_claims)
    graph.add_node("verify_claims", verify_claims)
    graph.add_node("detect_conflicts", detect_conflicts_node)
    graph.add_node("score_confidence", score_confidence_node)
    graph.add_node("validate_citations", validate_citations_node)
    graph.add_node("reflection", reflection)
    graph.add_node("finalize_answer", finalize_answer)

    graph.add_edge(START, "clarify_intent")
    graph.add_edge("clarify_intent", "rewrite_task")
    graph.add_edge("rewrite_task", "generate_query")
    graph.add_conditional_edges("generate_query", continue_to_web_research, ["web_research"])
    if ctx.config.phase2_enabled:
        graph.add_edge("web_research", "extract_claims")
        graph.add_edge("extract_claims", "verify_claims")
        graph.add_edge("verify_claims", "detect_conflicts")
        graph.add_edge("detect_conflicts", "score_confidence")
        graph.add_edge("score_confidence", "validate_citations")
        graph.add_edge("validate_citations", "reflection")
    else:
        graph.add_edge("web_research", "reflection")
    graph.add_conditional_edges("reflection", evaluate_research, ["web_research", "finalize_answer"])
    graph.add_edge("finalize_answer", END)
    return graph.compile(name="research-graph-agent")


def _build_plan_only_graph(ctx: ResearchGraphContext) -> StateGraph:
    """Build a minimal graph that only runs clarify → rewrite → generate_query → END."""

    async def clarify_intent(state: ResearchGraphState) -> ClarificationState:
        raw_topic = extract_research_topic(state.get("messages", []))
        if not ctx.config.enable_clarify:
            return {"clarified_task": raw_topic, "clarification_notes": ""}

        prompt = get_clarify_prompt(
            current_date=get_current_date(),
            research_topic=raw_topic,
        )
        payload = await _call_llm_json(
            ctx,
            prompt=prompt,
            temperature=0.2,
            model_name=ctx.config.clarify_model,
            schema_type=ClarificationResult,
        )
        clarified_task = raw_topic
        clarification_notes = ""
        if isinstance(payload, dict):
            candidate = str(payload.get("clarified_task") or "").strip()
            if candidate:
                clarified_task = candidate
            needs_clarification = bool(payload.get("needs_clarification"))
            clarification_notes = str(payload.get("clarification_note") or "").strip()
            assumptions = normalize_query_list(payload.get("assumptions"))
            if assumptions:
                clarification_notes = "\n".join(
                    [clarification_notes] + [f"- {assumption}" for assumption in assumptions]
                ).strip()
            if needs_clarification and clarification_notes:
                clarification_notes = f"Needs clarification:\n{clarification_notes}"

        return {"clarified_task": clarified_task, "clarification_notes": clarification_notes}

    async def rewrite_task(state: ResearchGraphState) -> RewriteState:
        clarified_topic = str(state.get("clarified_task") or "").strip() or extract_research_topic(state.get("messages", []))
        if not ctx.config.enable_rewrite:
            return {"rewritten_task": clarified_topic, "rewrite_notes": ""}

        prompt = get_rewrite_prompt(
            current_date=get_current_date(),
            clarified_task=clarified_topic,
            clarification_notes=str(state.get("clarification_notes") or ""),
        )
        payload = await _call_llm_json(
            ctx,
            prompt=prompt,
            temperature=0.3,
            model_name=ctx.config.rewrite_model,
            schema_type=ResearchRewriteResult,
        )
        rewritten_task = clarified_topic
        rewrite_notes = ""
        if isinstance(payload, dict):
            candidate = str(payload.get("rewritten_task") or "").strip()
            if candidate:
                rewritten_task = candidate
            focus_areas = normalize_query_list(payload.get("focus_areas"))
            if focus_areas:
                rewrite_notes = "\n".join(f"- {area}" for area in focus_areas)

        return {"rewritten_task": rewritten_task, "rewrite_notes": rewrite_notes}

    async def generate_query(state: ResearchGraphState) -> QueryGenerationState:
        rewritten = str(state.get("rewritten_task") or "").strip()
        clarified = str(state.get("clarified_task") or "").strip()
        topic = rewritten or clarified or extract_research_topic(state.get("messages", []))

        max_queries = min(
            int(state.get("initial_search_query_count") or ctx.config.initial_query_count),
            int(state.get("max_total_queries") or ctx.config.max_total_queries),
        )
        prompt = get_query_writer_prompt(
            current_date=get_current_date(),
            research_topic=topic,
            number_queries=max_queries,
        )
        payload = await _call_llm_json(
            ctx,
            prompt=prompt,
            temperature=0.9,
            model_name=ctx.config.query_model,
            schema_type=SearchQueryList,
        )
        rationale = ""
        if isinstance(payload, dict):
            rationale = str(payload.get("rationale") or "").strip()
        queries = normalize_query_list(payload.get("query") if isinstance(payload, dict) else None)
        if not queries:
            raw_text = payload.get("_raw_text") if isinstance(payload, dict) else None
            queries = normalize_query_list(raw_text)
        if not queries:
            queries = [topic]

        queries = [q for q in queries if q.strip()]
        seen = set()
        deduped: list[str] = []
        for query in queries:
            if query in seen:
                continue
            seen.add(query)
            deduped.append(query)
            if len(deduped) >= max_queries:
                break

        return {"search_query": deduped, "query_rationale": rationale}

    graph = StateGraph(ResearchGraphState)
    graph.add_node("clarify_intent", clarify_intent)
    graph.add_node("rewrite_task", rewrite_task)
    graph.add_node("generate_query", generate_query)
    graph.add_edge(START, "clarify_intent")
    graph.add_edge("clarify_intent", "rewrite_task")
    graph.add_edge("rewrite_task", "generate_query")
    graph.add_edge("generate_query", END)
    return graph.compile(name="research-plan-graph")


def _build_subgraph_wrapper(subgraph: Any):
    """
    Wrap the research graph as a subgraph node in a parent graph.

    This enables LangGraph's native `subgraphs=True` streaming shape:
    `(namespace_tuple, chunk)`, where namespace reflects nested subgraph paths.
    """
    wrapper = StateGraph(ResearchGraphState)
    wrapper.add_node("research", subgraph)
    wrapper.add_edge(START, "research")
    wrapper.add_edge("research", END)
    return wrapper.compile(name="research-graph-wrapper")


async def run_research_graph(
    *,
    task: str,
    context: str | None,
    messages_context: list[dict[str, Any]],
    parent_run_config: RunConfig,
    tool_context: dict[str, Any],
    output_mode: str,
    event_forwarder: EventEmitter | None = None,
    plan_only: bool = False,
    confirmed_queries: list[str] | None = None,
    confirmed_task: str | None = None,
) -> dict[str, Any]:
    try:
        if not messages_context:
            user_payload = f"Task: {task}"
            if context:
                user_payload = f"{user_payload}\nContext: {context}"
            messages_context = [{"role": "user", "content": user_payload}]

        tool_registry = build_registry(
            allowed_names={"intelligent_web_search", "extract_web_content"},
        )

        config = _resolve_config(parent_run_config)
        ctx = ResearchGraphContext(
            run_config=parent_run_config,
            tool_registry=tool_registry,
            tool_context=tool_context,
            emit=event_forwarder,
            config=config,
            billing_guard=BillingGuard(),
        )

        initial_state: ResearchGraphState = {
            "messages": messages_context,
            "clarified_task": "",
            "clarification_notes": "",
            "rewritten_task": "",
            "rewrite_notes": "",
            "search_query": [],
            "web_research_result": [],
            "sources_gathered": [],
            "claims": [],
            "claim_verdicts": [],
            "evidence_graph": [],
            "conflicts": [],
            "confidence_scores": [],
            "citation_issues": [],
            "citation_coverage": {},
            "verification_summary": "",
            "follow_up_queries": [],
            "query_rationale": "",
            "initial_search_query_count": config.initial_query_count,
            "max_research_loops": config.max_research_loops,
            "max_total_queries": config.max_total_queries,
            "research_loop_count": 0,
            "is_sufficient": False,
            "knowledge_gap": "",
            "number_of_ran_queries": 0,
            "tool_calls_used": 0,
            "extracted_urls_count": 0,
            "budget_exhausted_reason": "",
            "final_answer": "",
            "final_sources": [],
            "final_verification": {},
            "publication": {},
        }

        # ── plan_only mode: run only clarify → rewrite → generate_query ──
        if plan_only:
            plan_graph = _build_plan_only_graph(ctx)
            plan_state = await plan_graph.ainvoke(
                initial_state,
                config={"recursion_limit": 10},
            )
            if not isinstance(plan_state, dict):
                plan_state = {}
            rewrite_notes = str(plan_state.get("rewrite_notes") or "").strip()
            focus_areas: list[str] = []
            if rewrite_notes:
                focus_areas = [
                    line.lstrip("- ").strip()
                    for line in rewrite_notes.split("\n")
                    if line.strip().startswith("- ")
                ]
                focus_areas = [a for a in focus_areas if a]
            plan_payload: ResearchPlanPayload = {
                "status": "plan_generated",
                "clarified_task": str(plan_state.get("clarified_task") or "").strip(),
                "clarification_notes": str(plan_state.get("clarification_notes") or "").strip(),
                "rewritten_task": str(plan_state.get("rewritten_task") or "").strip(),
                "focus_areas": focus_areas,
                "queries": list(plan_state.get("search_query") or []),
                "query_rationale": str(plan_state.get("query_rationale") or "").strip(),
                "config_summary": {
                    "query_count": config.initial_query_count,
                    "max_loops": config.max_research_loops,
                    "phase2_enabled": config.phase2_enabled,
                    "max_total_queries": config.max_total_queries,
                    "results_per_query": config.results_per_query,
                },
            }
            output_payload = {
                "agent": "deep_research_agent",
                "display_name": "Deep Research Agent",
                "status": "plan_generated",
                "plan": plan_payload,
            }
            return {"success": True, "output": output_payload, "error": None}

        # ── confirmed_queries mode: inject pre-confirmed queries, skip planning ──
        if confirmed_queries:
            resolved_task = (confirmed_task or task or "").strip()
            if resolved_task:
                initial_state["clarified_task"] = resolved_task
                initial_state["rewritten_task"] = resolved_task
            initial_state["search_query"] = list(confirmed_queries)

        recursion_limit = max(50, config.max_research_loops * 6 + 20)
        subgraph = _build_graph(ctx)
        final_state: dict[str, Any] | None = None

        # Phase 1 (migration): run the research workflow as a LangGraph subgraph node.
        # This aligns execution with the official subgraph mechanism (namespace-aware streaming),
        # while keeping our existing tool/status event emission unchanged for compatibility.
        if _env_bool("LANGGRAPH_SUBGRAPH_ENABLED", False):
            try:
                wrapper = _build_subgraph_wrapper(subgraph)
                async for item in wrapper.astream(
                    initial_state,
                    config={"recursion_limit": recursion_limit},
                    stream_mode="values",
                    subgraphs=True,
                ):
                    namespace: tuple[str, ...] = ()
                    payload: Any = item
                    if (
                        isinstance(item, tuple)
                        and len(item) == 2
                        and isinstance(item[0], tuple)
                    ):
                        namespace, payload = item  # type: ignore[misc]
                    if not namespace and isinstance(payload, dict):
                        final_state = payload
                if final_state is None:
                    final_state = await subgraph.ainvoke(
                        initial_state,
                        config={"recursion_limit": recursion_limit},
                    )
            except TypeError:
                # Backwards-compatible fallback for older LangGraph stream signatures.
                final_state = await subgraph.ainvoke(
                    initial_state,
                    config={"recursion_limit": recursion_limit},
                )
        else:
            final_state = await subgraph.ainvoke(
                initial_state,
                config={"recursion_limit": recursion_limit},
            )

        if not isinstance(final_state, dict):
            final_state = {}

        final_answer = final_state.get("final_answer") or ""
        final_sources = final_state.get("final_sources") or []
        final_verification = final_state.get("final_verification") or {}
        publication = final_state.get("publication") or {}
        if not final_answer:
            final_answer = "I could not find enough information to answer the question."

        if output_mode == "full_history":
            output_payload = {
                "messages": [{"role": "assistant", "content": final_answer}],
                "sources": final_sources,
                "verification": final_verification,
                "publication": publication,
            }
            return {"success": True, "output": output_payload, "error": None}

        output_payload = {
            "agent": "deep_research_agent",
            "display_name": "Deep Research Agent",
            "content": final_answer,
            "sources": final_sources,
            "verification": final_verification,
            "publication": publication,
        }
        return {"success": True, "output": output_payload, "error": None}
    except Exception as exc:
        logger.exception("Research graph run failed")
        return {"success": False, "error": str(exc)}
