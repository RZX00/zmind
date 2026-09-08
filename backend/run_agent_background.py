import dotenv
dotenv.load_dotenv(".env")

import sentry
import asyncio
import json
import traceback
from datetime import datetime, timezone
from time import perf_counter
from typing import Any, Dict, List, Optional

import dramatiq
import os
import uuid

# Register background KB file job actors.
from core.knowledge_base.file_jobs import process_kb_file_job  # noqa: F401
# Register automation actors.
from core.automation.background_jobs import (  # noqa: F401
    dispatch_provider_event,
    dispatch_scheduled_automations,
    execute_automation_run,
)

from core.ai_models.registry import DEFAULT_FREE_MODEL, DEFAULT_PREMIUM_MODEL
from core.services.dramatiq_broker import configure_dramatiq
from core.services import redis
from core.services import metrics
from core.services.langfuse import langfuse
from core.services.supabase import DBConnection
from core.application.use_cases.agent.update_agent_run_status import UpdateAgentRunStatusUseCase
from core.infrastructure.agent.supabase_agent_run_repository import SupabaseAgentRunRepository
from core.utils.config import config
from core.utils.logger import logger, structlog
from core.utils.retry import retry


redis_broker = configure_dramatiq()


_initialized = False
db = DBConnection()
instance_id = "single"


def _normalize_model_value(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, str):
        cleaned = value.strip()
        if cleaned.lower() in ("", "none", "null", "undefined"):
            return None
        return cleaned
    return str(value)


def _normalize_run_mode(value: Optional[str]) -> str:
    if not value:
        return "agent"
    cleaned = str(value).strip().lower()
    return "chat" if cleaned == "chat" else "agent"


def _normalize_interaction_surface(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    cleaned = str(value).strip().lower()
    if cleaned in {"doc", "document"}:
        return "doc"
    if cleaned == "canvas":
        return "canvas"
    return None


def _extract_surface_from_metadata(raw_metadata: Any) -> Optional[str]:
    metadata = raw_metadata
    if isinstance(metadata, str):
        try:
            metadata = json.loads(metadata)
        except Exception:
            metadata = {}
    if not isinstance(metadata, dict):
        return None
    surface = _normalize_interaction_surface(metadata.get("surface"))
    if surface:
        return surface
    doc_context = metadata.get("doc_context")
    if isinstance(doc_context, dict):
        doc_surface = _normalize_interaction_surface(doc_context.get("surface"))
        if doc_surface:
            return doc_surface
    return None


def _parse_bool(value: Optional[str], default: bool = False) -> bool:
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _parse_int(
    value: Optional[str],
    default: int,
    *,
    minimum: Optional[int] = None,
    maximum: Optional[int] = None,
) -> int:
    parsed = default
    if value is not None:
        try:
            parsed = int(str(value).strip())
        except Exception:
            parsed = default
    if minimum is not None:
        parsed = max(minimum, parsed)
    if maximum is not None:
        parsed = min(maximum, parsed)
    return parsed


def _parse_iso_timestamp(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except Exception:
        return None


async def initialize():
    """Initialize the agent API with resources from the main API."""
    global db, instance_id, _initialized

    if not instance_id:
        instance_id = str(uuid.uuid4())[:8]
    await retry(lambda: redis.initialize_async())
    await db.initialize()

    _initialized = True
    logger.debug(f"Initialized agent API with instance ID: {instance_id}")

@dramatiq.actor
async def check_health(key: str):
    """Run the agent in the background using Redis for state."""
    structlog.contextvars.clear_contextvars()
    await redis.set(key, "healthy", ex=redis.REDIS_KEY_TTL)

@dramatiq.actor
async def run_agent_background(
    agent_run_id: str,
    thread_id: str,
    instance_id: str,
    project_id: str,
    model_name: str = DEFAULT_FREE_MODEL,
    enable_thinking: Optional[bool] = False,
    reasoning_effort: Optional[str] = 'low',
    stream: bool = True,
    enable_context_manager: bool = True,
    enable_prompt_caching: bool = True,
    agent_config: Optional[dict] = None,
    request_id: Optional[str] = None,
    requested_model_name: Optional[str] = None,
    run_mode: Optional[str] = None,
    interaction_surface: Optional[str] = None,
    selection_context: Optional[dict] = None,
    workspace_target: Optional[dict] = None,
    response_mode: Optional[str] = None,
    resume_token: Optional[str] = None,
    client_message: Optional[dict] = None,
):
    """Run the agent in the background using Redis for state."""
    structlog.contextvars.clear_contextvars()
    structlog.contextvars.bind_contextvars(
        agent_run_id=agent_run_id,
        thread_id=thread_id,
        request_id=request_id,
    )

    try:
        await initialize()
    except Exception as e:
        logger.critical(f"Failed to initialize Redis connection: {e}")
        raise e

    # Idempotency check: prevent duplicate runs
    run_lock_key = f"agent_run_lock:{agent_run_id}"
    
    # Normalize possibly stringified nulls coming from task queue serialization
    if project_id in (None, 'None', 'null', 'undefined', ''):
        project_id = None
    if instance_id in (None, 'None', 'null', 'undefined', ''):
        instance_id = str(uuid.uuid4())[:8]
    # Try to acquire a lock for this agent run
    lock_acquired = await redis.set(run_lock_key, instance_id, nx=True, ex=redis.REDIS_KEY_TTL)
    
    if not lock_acquired:
        # Check if the run is already being handled by another instance
        existing_instance = await redis.get(run_lock_key)
        if existing_instance:
            logger.info(f"Agent run {agent_run_id} is already being processed by instance {existing_instance.decode() if isinstance(existing_instance, bytes) else existing_instance}. Skipping duplicate execution.")
            return
        else:
            # Lock exists but no value, try to acquire again
            lock_acquired = await redis.set(run_lock_key, instance_id, nx=True, ex=redis.REDIS_KEY_TTL)
            if not lock_acquired:
                logger.info(f"Agent run {agent_run_id} is already being processed by another instance. Skipping duplicate execution.")
                return

    sentry.sentry.set_tag("thread_id", thread_id)

    logger.info(f"Starting background agent run: {agent_run_id} for thread: {thread_id} (Instance: {instance_id})")
    
    from core.ai_models import model_manager
    requested_model = _normalize_model_value(requested_model_name)
    model_name = _normalize_model_value(model_name)
    agent_model = _normalize_model_value(agent_config.get("model") if agent_config else None)

    base_model = requested_model or model_name
    model_source = "request" if requested_model else "task" if model_name else None

    is_tier_default = base_model in (DEFAULT_FREE_MODEL, DEFAULT_PREMIUM_MODEL) if base_model else False
    if not requested_model:
        if (is_tier_default or not base_model) and agent_model:
            base_model = agent_model
            model_source = "agent_config"
        elif not base_model and agent_model:
            base_model = agent_model
            model_source = "agent_config"

    if not base_model:
        base_model = DEFAULT_FREE_MODEL
        model_source = model_source or "fallback"

    effective_model = model_manager.resolve_model_id(base_model) or base_model
    logger.debug(
        "Resolved model selection",
        requested_model=requested_model,
        task_model=model_name,
        agent_model=agent_model,
        effective_model=effective_model,
        model_source=model_source,
    )
    
    client = await db.client
    start_time = datetime.now(timezone.utc)
    run_started_perf = perf_counter()
    first_chunk_written_perf: Optional[float] = None
    total_responses = 0
    pubsub = None
    stop_checker = None
    heartbeat_task = None
    stop_signal_received = False
    stop_event = asyncio.Event()
    run_complete_event = asyncio.Event()
    mcp_service_instance = None

    # Define Redis keys and channels
    response_list_key = f"agent_run:{agent_run_id}:responses"
    response_channel = f"agent_run:{agent_run_id}:new_response"
    instance_control_channel = f"agent_run:{agent_run_id}:control:{instance_id}"
    global_control_channel = f"agent_run:{agent_run_id}:control"
    instance_active_key = f"active_run:{instance_id}:{agent_run_id}"
    interaction_mode = _normalize_run_mode(run_mode)
    requested_surface = _normalize_interaction_surface(interaction_surface)
    resolved_surface = requested_surface or "canvas"
    surface_source = "request" if requested_surface else "default"

    async def heartbeat_loop():
        interval = max(5, int(config.AGENT_RUN_HEARTBEAT_INTERVAL_SEC))
        heartbeat_disabled = False
        ttl_warned = False
        while not run_complete_event.is_set():
            try:
                await asyncio.sleep(interval)
            except asyncio.CancelledError:
                return
            if run_complete_event.is_set():
                return

            if not heartbeat_disabled:
                try:
                    await client.table("agent_runs").update(
                        {
                            "worker_instance_id": instance_id,
                            "worker_heartbeat_at": datetime.now(timezone.utc).isoformat(),
                        }
                    ).eq("id", agent_run_id).execute()
                except Exception as exc:
                    heartbeat_disabled = True
                    logger.warning(
                        "Failed to update agent run heartbeat; disabling",
                        agent_run_id=agent_run_id,
                        error=str(exc),
                    )

            try:
                await redis.expire(run_lock_key, redis.REDIS_KEY_TTL)
                await redis.expire(instance_active_key, redis.REDIS_KEY_TTL)
            except Exception as ttl_err:
                if not ttl_warned:
                    ttl_warned = True
                    logger.warning(
                        "Failed to refresh Redis TTLs for agent run",
                        agent_run_id=agent_run_id,
                        error=str(ttl_err),
                    )

    try:
        await client.table("agent_runs").update(
            {
                "worker_instance_id": instance_id,
                "worker_heartbeat_at": datetime.now(timezone.utc).isoformat(),
            }
        ).eq("id", agent_run_id).execute()
    except Exception as exc:
        logger.warning(
            "Failed to record initial agent run heartbeat",
            agent_run_id=agent_run_id,
            error=str(exc),
        )

    heartbeat_task = asyncio.create_task(heartbeat_loop())

    async def check_for_stop_signal():
        nonlocal stop_signal_received
        if not pubsub: return
        last_ttl_refresh = datetime.now(timezone.utc)
        ttl_refresh_interval_sec = max(5, int(config.AGENT_RUN_HEARTBEAT_INTERVAL_SEC))
        try:
            while not stop_signal_received:
                message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=0.5)
                if message and message.get("type") == "message":
                    data = message.get("data")
                    if isinstance(data, bytes): data = data.decode('utf-8')
                    if data == "STOP":
                        logger.debug(f"Received STOP signal for agent run {agent_run_id} (Instance: {instance_id})")
                        stop_signal_received = True
                        stop_event.set()
                        break
                # Refresh TTL on interval (response-count based checks can flood Redis at run start).
                now = datetime.now(timezone.utc)
                if (now - last_ttl_refresh).total_seconds() >= ttl_refresh_interval_sec:
                    try:
                        await redis.expire(instance_active_key, redis.REDIS_KEY_TTL)
                        last_ttl_refresh = now
                    except Exception as ttl_err:
                        logger.warning(f"Failed to refresh TTL for {instance_active_key}: {ttl_err}")
                await asyncio.sleep(0.1) # Short sleep to prevent tight loop
        except asyncio.CancelledError:
            logger.debug(f"Stop signal checker cancelled for {agent_run_id} (Instance: {instance_id})")
        except Exception as e:
            logger.error(f"Error in stop signal checker for {agent_run_id}: {e}", exc_info=True)
            stop_signal_received = True # Stop the run if the checker fails

    trace = langfuse.trace(name="agent_run", id=agent_run_id, session_id=thread_id, metadata={"project_id": project_id, "instance_id": instance_id})

    # Ensure variables exist for `finally` block even if early failures happen.
    engine_version = os.getenv("LANGGRAPH_ENGINE_VERSION", "v1")
    engine_name = "langgraph"
    writer = None

    try:
        side_effect_policy = "allow_all"
        checkpoint_id = None
        account_id = None
        canvas_id = None
        thread_metadata: dict[str, Any] = {}
        doc_context: Optional[dict[str, Any]] = None
        doc_item_id: Optional[str] = None

        try:
            ar_res = await client.table("agent_runs").select("side_effect_policy, checkpoint_id, metadata, started_at").eq("id", agent_run_id).limit(1).execute()
            if getattr(ar_res, "data", None):
                ar_row = ar_res.data[0] or {}
                side_effect_policy = ar_row.get("side_effect_policy") or side_effect_policy
                checkpoint_id = ar_row.get("checkpoint_id")
                run_started_at = _parse_iso_timestamp(ar_row.get("started_at"))
                if run_started_at:
                    queue_wait_ms = (datetime.now(timezone.utc) - run_started_at).total_seconds() * 1000.0
                    if queue_wait_ms >= 0:
                        metrics.timing(
                            "agent_runs.worker.queue_wait_ms",
                            queue_wait_ms,
                            run_mode=interaction_mode,
                        )
                raw_meta = ar_row.get("metadata") or {}
                if isinstance(raw_meta, str):
                    try:
                        raw_meta = json.loads(raw_meta)
                    except Exception:
                        raw_meta = {}
                if run_mode is None:
                    interaction_mode = _normalize_run_mode(raw_meta.get("run_mode"))
                if requested_surface is None:
                    meta_surface = _normalize_interaction_surface(raw_meta.get("interaction_surface"))
                    if meta_surface:
                        resolved_surface = meta_surface
                        surface_source = "run_metadata"
                if selection_context is None and isinstance(raw_meta.get("selection_context"), dict):
                    selection_context = raw_meta.get("selection_context")
                if workspace_target is None and isinstance(raw_meta.get("workspace_target"), dict):
                    workspace_target = raw_meta.get("workspace_target")
                if response_mode is None and isinstance(raw_meta.get("response_mode"), str):
                    response_mode = raw_meta.get("response_mode")
                if resume_token is None and isinstance(raw_meta.get("resume_token"), str):
                    resume_token = raw_meta.get("resume_token")
        except Exception as _e:
            logger.debug(f"Agent run lookup failed for {agent_run_id}: {_e}")

        try:
            t_res = await client.table("threads").select("account_id, canvas_id, metadata").eq("thread_id", thread_id).limit(1).execute()
            if getattr(t_res, "data", None):
                row = t_res.data[0] or {}
                account_id = row.get("account_id")
                canvas_id = row.get("canvas_id")
                raw_thread_metadata = row.get("metadata") or {}
                if isinstance(raw_thread_metadata, str):
                    try:
                        raw_thread_metadata = json.loads(raw_thread_metadata)
                    except Exception:
                        raw_thread_metadata = {}
                thread_metadata = raw_thread_metadata if isinstance(raw_thread_metadata, dict) else {}
                if workspace_target is None and canvas_id:
                    workspace_target = {
                        "canvas_id": canvas_id,
                        "workspace_id": account_id,
                    }
                if resolved_surface == "doc":
                    try:
                        from core.docs.agent_context import normalize_doc_context_payload

                        normalized_doc_context, _doc_ctx_warnings = normalize_doc_context_payload(thread_metadata)
                        if isinstance(normalized_doc_context, dict):
                            doc_context = normalized_doc_context
                            candidate_doc_item_id = str(normalized_doc_context.get("doc_item_id") or "").strip()
                            if candidate_doc_item_id:
                                doc_item_id = candidate_doc_item_id
                    except Exception as doc_ctx_err:
                        logger.debug("Failed to normalize doc context from thread metadata", error=str(doc_ctx_err))
                if requested_surface is None:
                    thread_surface = _extract_surface_from_metadata(row.get("metadata"))
                    if thread_surface:
                        resolved_surface = thread_surface
                        surface_source = "thread_metadata"
        except Exception as _e:
            logger.debug(f"Account lookup failed for thread {thread_id}: {_e}")

        latest_user_metadata: Any = None
        if requested_surface is None and surface_source == "default":
            try:
                latest_user = (
                    await client.table("messages")
                    .select("metadata")
                    .eq("thread_id", thread_id)
                    .eq("type", "user")
                    .order("created_at", desc=True)
                    .limit(1)
                    .execute()
                )
                if latest_user.data:
                    latest_user_metadata = latest_user.data[0].get("metadata")
                    latest_surface = _extract_surface_from_metadata(latest_user_metadata)
                    if latest_surface:
                        resolved_surface = latest_surface
                        surface_source = "latest_message"
                    if selection_context is None and isinstance(latest_user_metadata, dict):
                        candidate_selection = latest_user_metadata.get("selection_context")
                        if isinstance(candidate_selection, dict):
                            selection_context = candidate_selection
                    if workspace_target is None and isinstance(latest_user_metadata, dict):
                        candidate_target = latest_user_metadata.get("workspace_target_canvas")
                        if isinstance(candidate_target, dict):
                            workspace_target = candidate_target
            except Exception as _e:
                logger.debug(f"Message surface lookup failed for thread {thread_id}: {_e}")

        if resolved_surface == "doc" and not doc_item_id:
            try:
                source_metadata = latest_user_metadata
                if source_metadata is None:
                    latest_user_for_doc = (
                        await client.table("messages")
                        .select("metadata")
                        .eq("thread_id", thread_id)
                        .eq("type", "user")
                        .order("created_at", desc=True)
                        .limit(1)
                        .execute()
                    )
                    if latest_user_for_doc.data:
                        source_metadata = latest_user_for_doc.data[0].get("metadata")
                if source_metadata is not None:
                    from core.docs.agent_context import normalize_doc_context_payload

                    normalized_doc_context, _doc_ctx_warnings = normalize_doc_context_payload(source_metadata)
                    if isinstance(normalized_doc_context, dict):
                        doc_context = normalized_doc_context
                        candidate_doc_item_id = str(normalized_doc_context.get("doc_item_id") or "").strip()
                        if candidate_doc_item_id:
                            doc_item_id = candidate_doc_item_id
            except Exception as doc_ctx_err:
                logger.debug("Failed to resolve doc context from latest user message", error=str(doc_ctx_err))

        if not account_id:
            raise RuntimeError("LangGraph engine requires thread.account_id")

        from core.langgraph_engine.supervisor.config import load_supervisor_config

        supervisor_config = load_supervisor_config(agent_config)
        # Canvas runs go straight to the thin single-model loop (read -> tool -> observe).
        # Gating supervisor off for surface==canvas removes BOTH the handoff path
        # (transfer_to_canvas_agent + a second nested LangGraphEngine — the 60-100s latency
        # and lost-request root cause) AND the pre-loop semantic-router / skill-routing LLM
        # hops (they live inside `if use_supervisor:` below). Flag-gated, reversible.
        canvas_direct_loop = (
            resolved_surface == "canvas"
            and getattr(config, "CANVAS_AGENTIC_LANE_ENABLED", False)
        )
        use_supervisor = (
            supervisor_config.enabled
            and interaction_mode != "chat"
            and resolved_surface != "doc"
            and not canvas_direct_loop
        )
        # Canvas execution is deterministic CRUD, not deep reasoning. Disable extended thinking
        # for the canvas loop: it cuts latency AND avoids the thinking->tool-call streaming
        # transition that intermittently mangles the first tool call into a name-less 'tool'
        # placeholder (-> tool_not_found, edit never runs). Flag-gated via canvas_direct_loop.
        if canvas_direct_loop and enable_thinking:
            enable_thinking = False
            logger.info("Canvas direct loop: disabled extended thinking", agent_run_id=agent_run_id)
        base_model_name = effective_model
        if use_supervisor and supervisor_config.model_name:
            configured_model = model_manager.resolve_model_id(supervisor_config.model_name) or supervisor_config.model_name
            logger.info(
                "Supervisor model override configured but disabled; keeping requested model",
                requested_model=base_model_name,
                configured_model=configured_model,
            )

        logger.info(
            f"🚀 Using model: {effective_model} (thinking: {enable_thinking}, reasoning_effort: {reasoning_effort})",
            run_mode=interaction_mode,
            interaction_surface=resolved_surface,
            interaction_surface_source=surface_source,
        )
        if agent_config:
            logger.debug(f"Using custom agent: {agent_config.get('name', 'Unknown')}")

        try:
            await client.table("agent_runs").update(
                {
                    "engine": engine_name,
                    "engine_version": engine_version,
                    "is_shadow": False,
                    "run_mode": "primary",
                    "side_effect_policy": side_effect_policy,
                }
            ).eq("id", agent_run_id).execute()
        except Exception as _e:
            logger.debug(f"Failed to persist engine selection for {agent_run_id}: {_e}")

        # Setup Pub/Sub listener for control signals
        pubsub = await redis.create_pubsub()
        try:
            await retry(lambda: pubsub.subscribe(instance_control_channel, global_control_channel))
        except Exception as e:
            logger.error(f"Redis failed to subscribe to control channels: {e}", exc_info=True)
            raise e

        logger.info(f"Subscribed to control channels: {instance_control_channel}, {global_control_channel}")
        stop_checker = asyncio.create_task(check_for_stop_signal())

        # Ensure active run key exists and has TTL
        await redis.set(instance_active_key, "running", ex=redis.REDIS_KEY_TTL)

        final_status = "running"
        error_message = None

        from core.langgraph_engine.stream import (
            RedisStreamWriter,
        )
        from core.agent_runtime_v2 import (
            AgentRunStartV2,
            AgentRuntimeKernelV2,
            RuntimeIdentityV2,
            SelectionContextV2,
            WorkspaceTargetV2,
        )
        from core.agent_runtime_v2.adapters.langgraph_general_lane import LangGraphGeneralLaneAdapter
        from core.agent_runtime_v2.adapters.persistence import RuntimePersistenceProjectionV2
        from core.agent_runtime_v2.continuity import MemoryContinuityStoreV2, SupabaseContinuityStoreV2
        from core.agent_runtime_v2.legacy_adapter import agent_event_v2_to_legacy_chunk
        from core.agent_runtime_v2.semantics import normalize_response_mode

        from core.langgraph_engine.checkpoint_store import MemoryCheckpointStore, SupabaseCheckpointStore
        from core.langgraph_engine.persistence.event_persister import EventPersister
        from core.langgraph_engine.tools.catalog import build_registry

        writer = RedisStreamWriter(agent_run_id)

        if interaction_mode != "chat" and agent_config and (agent_config.get("configured_mcps") or agent_config.get("custom_mcps")):
            try:
                from core.mcp_module import MCPService

                mcp_configs = await _build_mcp_configs(agent_config, account_id=account_id)
                if mcp_configs:
                    mcp_service_instance = MCPService()
                    await mcp_service_instance.connect_all(mcp_configs)
            except Exception as mcp_err:
                logger.warning("Failed to initialize MCP connections", agent_run_id=agent_run_id, error=str(mcp_err))

        supervisor_hint = None
        allowed_agent_names = None
        auto_run_invocation = None
        if use_supervisor:
            try:
                from core.langgraph_engine.supervisor.router import (
                    build_supervisor_hint,
                    fetch_latest_user_message,
                    route_from_semantic,
                    route_from_text,
                )

                latest_user_message = await fetch_latest_user_message(client, thread_id)
                route_hint = None
                if supervisor_config.router_enabled:
                    try:
                        route_hint = await route_from_semantic(
                            latest_user_message.text,
                            model_name=effective_model,
                            has_attachments=latest_user_message.has_attachments,
                            cta_action=latest_user_message.cta_action,
                        )
                    except Exception as semantic_err:
                        logger.debug(
                            "Semantic router failed; falling back to keyword routing",
                            error=str(semantic_err),
                        )
                if route_hint is None:
                    route_hint = route_from_text(
                        latest_user_message.text,
                        cta_action=latest_user_message.cta_action,
                    )
                auto_run_skill = None
                auto_run_score = None
                try:
                    from core.skills.orchestrator import build_skill_routing_plan

                    raw_threshold = os.getenv("ZMIND_SKILLS_AUTO_RUN_SCORE", "7")
                    try:
                        auto_run_threshold = max(0, int(raw_threshold))
                    except Exception:
                        auto_run_threshold = 7
                    routing_plan = await build_skill_routing_plan(
                        route_hint=route_hint,
                        message=latest_user_message.text,
                        has_attachments=latest_user_message.has_attachments,
                        db=db,
                        account_id=account_id,
                        auto_run_enabled=_parse_bool(os.getenv("ZMIND_SKILLS_AUTO_RUN"), False),
                        auto_run_threshold=auto_run_threshold,
                    )
                    route_hint = routing_plan.route_hint
                    auto_run_invocation = routing_plan.auto_invocation
                    if auto_run_invocation:
                        auto_run_skill = auto_run_invocation.skill_id
                        auto_run_score = auto_run_invocation.score
                except Exception as skill_err:
                    logger.debug(
                        "Skill routing plan failed",
                        agent_run_id=agent_run_id,
                        error=str(skill_err),
                    )
                supervisor_hint = build_supervisor_hint(route_hint)
                if auto_run_skill:
                    extra_lines = [
                        "Skill auto-run policy: enabled.",
                        (
                            f"Auto-run skill candidate: {auto_run_skill} "
                            f"(score={auto_run_score}, threshold={os.getenv('ZMIND_SKILLS_AUTO_RUN_SCORE', '7')})."
                        ),
                        "If safe and applicable, call run_skill immediately using the user's latest message as input.",
                    ]
                    if supervisor_hint:
                        supervisor_hint = supervisor_hint + "\n" + "\n".join(extra_lines)
                    else:
                        supervisor_hint = "\n".join(extra_lines)
                if (
                    supervisor_config.router_hard_gate
                    and route_hint
                    and route_hint.should_delegate
                    and route_hint.agents
                ):
                    # Optional strict mode: expose only routed handoff tools.
                    allowed_agent_names = tuple(route_hint.agents)
                    logger.info(
                        "Supervisor hard routing gate enabled",
                        agent_run_id=agent_run_id,
                        allowed_agent_names=list(allowed_agent_names),
                        route_reason=route_hint.reason,
                    )
                else:
                    # Default mode: keep all handoff tools available so we can switch
                    # (e.g., research -> canvas) freely. Routing hint is prompt guidance only.
                    allowed_agent_names = None
            except Exception as route_err:
                logger.debug("Supervisor routing failed; falling back to full tool set", error=str(route_err))
                allowed_agent_names = None

        try:
            enable_tool_policy_filter = _parse_bool(os.getenv("ENABLE_TOOL_POLICY_FILTER"), False)
            tool_policy_allowed_names = None
            tool_policy_allowed_prefixes = None
            if enable_tool_policy_filter and interaction_mode != "chat":
                try:
                    from core.langgraph_engine.tools.policy import resolve_tool_policy

                    tool_policy = resolve_tool_policy(
                        agent_config,
                        mcp_enabled=bool(mcp_service_instance),
                    )
                    tool_policy_allowed_names = tool_policy.allowed_names
                    tool_policy_allowed_prefixes = tool_policy.allowed_prefixes
                    if tool_policy.source != "none":
                        logger.debug(
                            "Tool policy resolved",
                            agent_run_id=agent_run_id,
                            source=tool_policy.source,
                            allowed_names_count=len(tool_policy_allowed_names or set()),
                            allowed_prefixes=sorted(list(tool_policy_allowed_prefixes or set())),
                        )
                except Exception as policy_err:
                    logger.warning(
                        "Tool policy resolution failed; falling back to full tool set",
                        agent_run_id=agent_run_id,
                        error=str(policy_err),
                    )

            if interaction_mode == "chat":
                from core.langgraph_engine.tools.registry import InMemoryToolRegistry

                tool_registry = InMemoryToolRegistry()
                logger.debug(
                    "Tools disabled for run",
                    agent_run_id=agent_run_id,
                    reason="chat_mode",
                )
            elif resolved_surface == "doc":
                from core.langgraph_engine.tools.doc_surface import DOC_SURFACE_ALLOWED_TOOL_NAMES

                tool_registry = build_registry(
                    mcp_service=None,
                    allowed_names=set(DOC_SURFACE_ALLOWED_TOOL_NAMES),
                    allowed_prefixes=None,
                )
                logger.debug(
                    "Doc surface tool allowlist applied",
                    agent_run_id=agent_run_id,
                    allowed_names=sorted(list(DOC_SURFACE_ALLOWED_TOOL_NAMES)),
                    doc_item_id=doc_item_id,
                )
            elif use_supervisor:
                from core.langgraph_engine.supervisor.registry import build_supervisor_registry
                from core.langgraph_engine.supervisor.agent_defs import MAIN_AGENT_ALLOWED_TOOL_NAMES

                native_allowed_names = MAIN_AGENT_ALLOWED_TOOL_NAMES if supervisor_config.include_native_tools else None
                native_allowed_prefixes = {"mcp__"} if supervisor_config.include_native_tools else None

                if enable_tool_policy_filter and supervisor_config.include_native_tools:
                    if tool_policy_allowed_names is not None:
                        native_allowed_names = set(native_allowed_names or set()) & set(tool_policy_allowed_names)
                    if tool_policy_allowed_prefixes is not None:
                        native_allowed_prefixes = set(native_allowed_prefixes or set()) & set(tool_policy_allowed_prefixes)

                tool_registry = build_supervisor_registry(
                    allowed_agent_names=allowed_agent_names,
                    include_native_tools=supervisor_config.include_native_tools,
                    native_allowed_names=native_allowed_names,
                    native_allowed_prefixes=native_allowed_prefixes,
                    mcp_service=mcp_service_instance if supervisor_config.include_native_tools else None,
                )
            elif canvas_direct_loop:
                # Thin canvas loop: offer ONLY the ~5 canvas tools, not all ~52 static tools.
                # Fewer tool schemas = smaller prompt, faster + more focused tool selection
                # (the model was weighing 52 irrelevant tools like web_search/doc_*/kb_* per turn).
                from core.langgraph_engine.supervisor.agent_defs import CANVAS_TOOL_NAMES

                canvas_allowed = set(CANVAS_TOOL_NAMES)
                if enable_tool_policy_filter and tool_policy_allowed_names is not None:
                    canvas_allowed &= set(tool_policy_allowed_names)
                tool_registry = build_registry(
                    mcp_service=None,
                    allowed_names=canvas_allowed,
                    allowed_prefixes=None,
                )
            else:
                allowed_names = tool_policy_allowed_names if enable_tool_policy_filter else None
                allowed_prefixes = tool_policy_allowed_prefixes if enable_tool_policy_filter else None
                tool_registry = build_registry(
                    mcp_service=mcp_service_instance,
                    allowed_names=allowed_names,
                    allowed_prefixes=allowed_prefixes,
                )
                if resolved_surface != "doc" and not canvas_direct_loop:
                    try:
                        from core.langgraph_engine.supervisor.handoff_tools import build_handoff_tool_specs

                        for spec in build_handoff_tool_specs():
                            tool_registry.register(spec)
                    except Exception as handoff_err:
                        logger.warning(
                            "Failed to register supervisor handoff tools",
                            agent_run_id=agent_run_id,
                            error=str(handoff_err),
                        )
            if hasattr(tool_registry, "schema_warnings"):
                warnings = tool_registry.schema_warnings()
                if warnings:
                    logger.warning("Tool schema warnings detected", warnings=warnings, agent_run_id=agent_run_id)
        except Exception as build_err:
            logger.exception("Failed to build tool registry; continuing without tools", agent_run_id=agent_run_id, error=build_err)
            tool_registry = None

        checkpoint_backend = os.getenv("LANGGRAPH_CHECKPOINT_BACKEND", "supabase").lower()
        if checkpoint_backend == "memory":
            checkpoint_store = MemoryCheckpointStore()
        else:
            try:
                checkpoint_store = SupabaseCheckpointStore()
            except Exception as checkpoint_err:
                logger.warning(
                    "Falling back to in-memory checkpoint store",
                    agent_run_id=agent_run_id,
                    error=str(checkpoint_err),
                )
                checkpoint_store = MemoryCheckpointStore()

        tool_context = {
            "db_connection": db,
            "thread_id": thread_id,
            "project_id": project_id,
            "account_id": account_id,
            "canvas_id": canvas_id,
            "interaction_mode": interaction_mode,
            "interaction_surface": resolved_surface,
        }
        if isinstance(selection_context, dict):
            tool_context["selection_context"] = selection_context
        if isinstance(workspace_target, dict):
            tool_context["workspace_target"] = workspace_target
        if response_mode:
            tool_context["response_mode"] = response_mode
        if resume_token:
            tool_context["resume_token"] = resume_token
        if client_message:
            tool_context["client_message_hint"] = client_message
        if resolved_surface == "doc":
            if doc_item_id:
                tool_context["doc_item_id"] = doc_item_id
            if isinstance(doc_context, dict):
                tool_context["doc_context"] = doc_context
        if use_supervisor:
            tool_context["supervisor_mode"] = supervisor_config.mode
            if supervisor_hint:
                tool_context["supervisor_hint"] = supervisor_hint
            if auto_run_invocation:
                tool_context["forced_tool_call"] = auto_run_invocation.to_tool_payload()
                tool_context["forced_tool_call_reason"] = auto_run_invocation.reason
            if base_model_name != effective_model:
                tool_context["supervisor_base_model"] = base_model_name
        if mcp_service_instance:
            tool_context["mcp_service"] = mcp_service_instance

        logger.info("Using graph engine", engine=engine_name)

        async_event_persistence = _parse_bool(os.getenv("LANGGRAPH_ASYNC_EVENT_PERSIST"), True)
        async_checkpoint_saves = _parse_bool(os.getenv("LANGGRAPH_ASYNC_CHECKPOINT"), True)
        async_event_queue_size = _parse_int(
            os.getenv("LANGGRAPH_ASYNC_EVENT_QUEUE_SIZE"),
            256,
            minimum=8,
        )
        async_checkpoint_queue_size = _parse_int(
            os.getenv("LANGGRAPH_ASYNC_CHECKPOINT_QUEUE_SIZE"),
            2,
            minimum=1,
        )
        stream_write_batch_size = _parse_int(
            os.getenv("AGENT_STREAM_WRITE_BATCH_SIZE"),
            8,
            minimum=1,
            maximum=256,
        )
        stream_write_batch_window_ms = _parse_int(
            os.getenv("AGENT_STREAM_WRITE_BATCH_WINDOW_MS"),
            8,
            minimum=0,
            maximum=1000,
        )
        stream_write_batch_window_sec = stream_write_batch_window_ms / 1000.0

        continuity_store = (
            MemoryContinuityStoreV2()
            if checkpoint_backend == "memory"
            else SupabaseContinuityStoreV2()
        )
        general_lane_adapter = LangGraphGeneralLaneAdapter(
            checkpoint_store=checkpoint_store,
            async_event_persistence=async_event_persistence,
            async_event_queue_size=async_event_queue_size,
            async_checkpoint_saves=async_checkpoint_saves,
            async_checkpoint_queue_size=async_checkpoint_queue_size,
        )
        response_mode_value = normalize_response_mode(response_mode)
        workspace_target_payload = workspace_target if isinstance(workspace_target, dict) else {}
        start_input = AgentRunStartV2(
            identity=RuntimeIdentityV2(
                run_id=agent_run_id,
                thread_id=thread_id,
                account_id=account_id,
                project_id=project_id,
            ),
            surface=resolved_surface if resolved_surface in {"canvas", "doc"} else None,
            interaction_mode=interaction_mode,
            response_mode=response_mode_value,
            user_input=client_message if isinstance(client_message, dict) else None,
            latest_user_text="",
            workspace_target=WorkspaceTargetV2(
                workspace_id=str(workspace_target_payload.get("workspace_id") or account_id or ""),
                canvas_id=workspace_target_payload.get("canvas_id") or canvas_id,
                doc_item_id=doc_item_id,
                metadata=workspace_target_payload,
            ),
            selection_context=SelectionContextV2(
                canvas_id=workspace_target_payload.get("canvas_id") or canvas_id,
                raw_payload=selection_context if isinstance(selection_context, dict) else None,
            ),
            model_name=effective_model,
            enable_thinking=enable_thinking,
            reasoning_effort=reasoning_effort,
            enable_context_manager=enable_context_manager,
            enable_prompt_caching=enable_prompt_caching,
            agent_config=agent_config,
            tool_context=tool_context,
            checkpoint_id=checkpoint_id,
            resume_token=resume_token,
            stop_event=stop_event,
        )
        kernel = AgentRuntimeKernelV2(
            continuity_store=continuity_store,
            general_lane_adapter=general_lane_adapter,
            persistence_projection=RuntimePersistenceProjectionV2(EventPersister()),
        )

        metrics.timing(
            "agent_runs.worker.bootstrap_ms",
            (perf_counter() - run_started_perf) * 1000.0,
            run_mode=interaction_mode,
        )

        pending_chunks: List[Dict[str, Any]] = []
        last_stream_flush_perf = perf_counter()

        async def flush_stream_chunks(*, force: bool = False) -> int:
            nonlocal first_chunk_written_perf, total_responses, last_stream_flush_perf, pending_chunks
            if not pending_chunks:
                return 0

            if not force and len(pending_chunks) < stream_write_batch_size:
                elapsed = perf_counter() - last_stream_flush_perf
                if elapsed < stream_write_batch_window_sec:
                    return 0

            chunks_to_write = pending_chunks
            pending_chunks = []

            if len(chunks_to_write) == 1:
                await writer.write_chunk(chunks_to_write[0])
                written = 1
            else:
                written = await writer.write_chunks(chunks_to_write)

            now_perf = perf_counter()
            last_stream_flush_perf = now_perf
            total_responses += written

            if first_chunk_written_perf is None and written > 0:
                first_chunk_written_perf = now_perf
                metrics.timing(
                    "agent_runs.worker.ttft_ms",
                    (first_chunk_written_perf - run_started_perf) * 1000.0,
                    run_mode=interaction_mode,
                )

            return written

        async for runtime_event in kernel.run(start_input, tool_registry=tool_registry):
            if stop_signal_received:
                logger.debug(f"Agent run {agent_run_id} stopped by signal.")
                final_status = "stopped"
                await flush_stream_chunks(force=True)
                break

            legacy_chunk = agent_event_v2_to_legacy_chunk(runtime_event)
            pending_chunks.append(legacy_chunk)

            should_break = False

            runtime_event_type = str(runtime_event.get("type") or runtime_event.get("event_type") or "")
            runtime_payload = runtime_event.get("payload") or {}
            if runtime_event_type == "run.completed":
                final_status = "completed"
                should_break = True
            elif runtime_event_type == "run.failed":
                error_message = runtime_payload.get("message") or runtime_payload.get("error") or runtime_event_type
                final_status = "failed"
                should_break = True
            elif runtime_event_type == "run.cancelled":
                error_message = runtime_payload.get("message") or runtime_event_type
                final_status = "stopped"
                should_break = True

            force_flush = should_break or first_chunk_written_perf is None
            await flush_stream_chunks(force=force_flush)

            if should_break:
                break
        await flush_stream_chunks(force=True)
        # If loop finished without explicit completion/error/stop signal, mark as completed
        if final_status == "running":
            final_status = "completed"
            duration = (datetime.now(timezone.utc) - start_time).total_seconds()
            logger.info(
                f"Agent run {agent_run_id} completed normally (duration: {duration:.2f}s, responses: {total_responses})"
            )
            completion_message = {"type": "status", "status": "completed", "message": "Agent run completed successfully"}
            try:
                if hasattr(trace, "span"):
                    trace.span(name="agent_run_completed").end(status_message="agent_run_completed")
            except Exception:
                pass
            if writer is not None:
                await writer.write_chunk(completion_message)  # type: ignore[arg-type]
            else:
                await redis.rpush(response_list_key, json.dumps(completion_message))
                await redis.publish(response_channel, "new")

        control_signal = "END_STREAM" if final_status == "completed" else "ERROR" if final_status == "failed" else "STOP"
        try:
            await redis.publish(global_control_channel, control_signal)
            # No need to publish to instance channel as the run is ending on this instance
            logger.debug(f"Published final control signal '{control_signal}' to {global_control_channel}")
        except Exception as e:
            logger.warning(f"Failed to publish final control signal {control_signal}: {str(e)}")

        # Update DB status after notifying stream consumers to minimize perceived completion latency.
        await update_agent_run_status(client, agent_run_id, final_status, error=error_message)

    except Exception as e:
        error_message = str(e)
        traceback_str = traceback.format_exc()
        duration = (datetime.now(timezone.utc) - start_time).total_seconds()
        logger.error(f"Error in agent run {agent_run_id} after {duration:.2f}s: {error_message}\n{traceback_str} (Instance: {instance_id})")
        final_status = "failed"
        try:
            if hasattr(trace, "span"):
                trace.span(name="agent_run_failed").end(status_message=error_message, level="ERROR")
        except Exception:
            pass

        # Push error message to Redis list
        error_response = {"type": "status", "status": "error", "message": error_message}
        try:
            if writer is not None:
                await writer.write_chunk(error_response)  # type: ignore[arg-type]
            else:
                await redis.rpush(response_list_key, json.dumps(error_response))
                await redis.publish(response_channel, "new")
        except Exception as redis_err:
             logger.error(f"Failed to push error response to Redis for {agent_run_id}: {redis_err}")

        # Publish ERROR signal
        try:
            await redis.publish(global_control_channel, "ERROR")
            logger.debug(f"Published ERROR signal to {global_control_channel}")
        except Exception as e:
            logger.warning(f"Failed to publish ERROR signal: {str(e)}")

        # Update DB status after notifying stream consumers to minimize perceived completion latency.
        await update_agent_run_status(client, agent_run_id, "failed", error=f"{error_message}\n{traceback_str}")

    finally:
        run_complete_event.set()
        if heartbeat_task and not heartbeat_task.done():
            heartbeat_task.cancel()
            try:
                await heartbeat_task
            except asyncio.CancelledError:
                pass
            except Exception as e:
                logger.warning(f"Error during heartbeat_task cancellation: {e}")
        # Cleanup stop checker task
        if stop_checker and not stop_checker.done():
            stop_checker.cancel()
            try: await stop_checker
            except asyncio.CancelledError: pass
            except Exception as e: logger.warning(f"Error during stop_checker cancellation: {e}")

        # Close pubsub connection
        if pubsub:
            try:
                await pubsub.unsubscribe()
                await pubsub.close()
                logger.debug(f"Closed pubsub connection for {agent_run_id}")
            except Exception as e:
                logger.warning(f"Error closing pubsub for {agent_run_id}: {str(e)}")

        # Set TTL on the response list in Redis
        await _cleanup_redis_response_list(agent_run_id, ttl=None)

        # Remove the instance-specific active run key
        await _cleanup_redis_instance_key(agent_run_id, instance_id_value=instance_id)

        # Clean up the run lock
        await _cleanup_redis_run_lock(agent_run_id)

        if mcp_service_instance and hasattr(mcp_service_instance, "disconnect_all"):
            try:
                await mcp_service_instance.disconnect_all()
            except Exception as mcp_cleanup_err:
                logger.warning("Failed to disconnect MCP services", agent_run_id=agent_run_id, error=str(mcp_cleanup_err))

        total_ms = (perf_counter() - run_started_perf) * 1000.0
        metrics.timing(
            "agent_runs.worker.total_ms",
            total_ms,
            status=final_status,
            run_mode=interaction_mode,
        )
        if first_chunk_written_perf is not None:
            metrics.timing(
                "agent_runs.worker.post_ttft_ms",
                (perf_counter() - first_chunk_written_perf) * 1000.0,
                status=final_status,
                run_mode=interaction_mode,
            )
        else:
            metrics.incr(
                "agent_runs.worker.no_stream_chunks",
                1,
                status=final_status,
                run_mode=interaction_mode,
            )

        logger.debug(f"Agent run background task fully completed for: {agent_run_id} (Instance: {instance_id}) with final status: {final_status}")

async def _build_mcp_configs(agent_config: Dict[str, Any], *, account_id: str) -> List[Dict[str, Any]]:
    if not agent_config:
        return []

    configs: List[Dict[str, Any]] = []

    configured_mcps = agent_config.get("configured_mcps") or []
    for mcp in configured_mcps:
        if not isinstance(mcp, dict):
            continue
        config = dict(mcp)
        if "qualifiedName" not in config and config.get("mcp_qualified_name"):
            config["qualifiedName"] = config.get("mcp_qualified_name")
        if "config" not in config or not isinstance(config.get("config"), dict):
            config["config"] = {}
        if "enabledTools" not in config and config.get("enabled_tools") is not None:
            config["enabledTools"] = config.get("enabled_tools")
        configs.append(config)

    custom_mcps = agent_config.get("custom_mcps") or []
    for custom_mcp in custom_mcps:
        if not isinstance(custom_mcp, dict):
            continue

        custom_type = custom_mcp.get("customType", custom_mcp.get("type", "sse"))
        name = custom_mcp.get("name", "Custom MCP")
        config = dict(custom_mcp.get("config") or {})
        enabled_tools = custom_mcp.get("enabledTools", custom_mcp.get("enabled_tools", []))
        qualified_name = (
            custom_mcp.get("qualifiedName")
            or custom_mcp.get("mcp_qualified_name")
            or config.get("qualifiedName")
            or config.get("mcp_qualified_name")
        )

        if custom_type == "composio":
            profile_id = config.get("profile_id") or custom_mcp.get("selectedProfileId")
            if profile_id and "profile_id" not in config:
                config["profile_id"] = profile_id
            if not qualified_name:
                safe_name = str(name).replace(" ", "_").lower()
                qualified_name = f"composio.{safe_name}"
            configs.append(
                {
                    "name": name,
                    "qualifiedName": qualified_name,
                    "config": config,
                    "enabledTools": enabled_tools,
                    "type": "composio",
                    "customType": "composio",
                    "isCustom": True,
                }
            )
            continue

        if custom_type == "pipedream":
            profile_id = config.get("profile_id") or custom_mcp.get("profile_id")
            external_user_id = config.get("external_user_id")
            oauth_app_id = config.get("oauth_app_id")
            app_slug = config.get("app_slug")

            header_app_slug = None
            if isinstance(config.get("headers"), dict):
                header_app_slug = config["headers"].get("x-pd-app-slug")

            if not app_slug:
                app_slug = header_app_slug

            if not app_slug and qualified_name and qualified_name.startswith("pipedream:"):
                app_slug = qualified_name.split("pipedream:", 1)[1]

            if profile_id and (not external_user_id or not app_slug or not oauth_app_id):
                try:
                    from pipedream import profile_service

                    profile = await profile_service.get_profile(account_id, profile_id)
                    if profile:
                        external_user_id = external_user_id or profile.external_user_id
                        oauth_app_id = oauth_app_id or profile.oauth_app_id
                        app_slug = app_slug or profile.app_slug
                        if name == "Custom MCP" and profile.app_name:
                            name = profile.app_name
                except Exception as exc:
                    logger.warning(
                        "Failed to resolve Pipedream profile for MCP config",
                        profile_id=profile_id,
                        error=str(exc),
                    )

            headers = dict(config.get("headers") or {})
            if app_slug:
                headers.setdefault("x-pd-app-slug", app_slug)
            if external_user_id:
                headers.setdefault("x-pd-external-user-id", external_user_id)
            if oauth_app_id:
                headers.setdefault("x-pd-oauth-app-id", oauth_app_id)

            project_id = os.getenv("PIPEDREAM_PROJECT_ID")
            environment = os.getenv("PIPEDREAM_X_PD_ENVIRONMENT", "development")
            if project_id:
                headers.setdefault("x-pd-project-id", project_id)
            if environment:
                headers.setdefault("x-pd-environment", environment)

            if "Authorization" not in headers:
                client_id = os.getenv("PIPEDREAM_CLIENT_ID")
                client_secret = os.getenv("PIPEDREAM_CLIENT_SECRET")
                if project_id and client_id and client_secret:
                    try:
                        from pipedream import connection_service

                        access_token = await connection_service._ensure_access_token()
                        headers["Authorization"] = f"Bearer {access_token}"
                        rate_limit_token = getattr(connection_service, "rate_limit_token", None)
                        if rate_limit_token:
                            headers.setdefault("x-pd-rate-limit", rate_limit_token)
                    except Exception as exc:
                        logger.warning(
                            "Failed to fetch Pipedream access token for MCP config",
                            mcp_name=name,
                            error=str(exc),
                        )

            if not qualified_name:
                if app_slug:
                    qualified_name = f"pipedream:{app_slug}"
                else:
                    safe_name = str(name).replace(" ", "_").lower()
                    qualified_name = f"custom_pipedream_{safe_name}"

            if headers:
                config["headers"] = headers
            if app_slug:
                config["app_slug"] = app_slug
            if external_user_id:
                config["external_user_id"] = external_user_id

            configs.append(
                {
                    "name": name,
                    "qualifiedName": qualified_name,
                    "config": config,
                    "enabledTools": enabled_tools,
                    "type": "pipedream",
                    "customType": "pipedream",
                    "isCustom": True,
                    "external_user_id": external_user_id,
                }
            )
            continue

        if custom_type not in ("http", "sse", "custom"):
            logger.warning(
                "Skipping unsupported custom MCP type for LangGraph",
                custom_type=custom_type,
                mcp_name=name,
            )
            continue

        if not qualified_name:
            safe_name = str(name).replace(" ", "_").lower()
            qualified_name = f"custom_{custom_type}_{safe_name}"

        configs.append(
            {
                "name": name,
                "qualifiedName": qualified_name,
                "config": config,
                "enabledTools": enabled_tools,
                "type": custom_type,
                "customType": custom_type,
                "isCustom": True,
            }
        )

    return configs

async def _cleanup_redis_instance_key(agent_run_id: str, *, instance_id_value: str | None = None):
    """Clean up the instance-specific Redis key for an agent run."""
    resolved_instance_id = instance_id_value or instance_id
    if not resolved_instance_id:
        logger.warning("Instance ID not set, cannot clean up instance key.")
        return
    key = f"active_run:{resolved_instance_id}:{agent_run_id}"
    # logger.debug(f"Cleaning up Redis instance key: {key}")
    try:
        await redis.delete(key)
        # logger.debug(f"Successfully cleaned up Redis key: {key}")
    except Exception as e:
        logger.warning(f"Failed to clean up Redis key {key}: {str(e)}")

async def _cleanup_redis_run_lock(agent_run_id: str):
    """Clean up the run lock Redis key for an agent run."""
    run_lock_key = f"agent_run_lock:{agent_run_id}"
    # logger.debug(f"Cleaning up Redis run lock key: {run_lock_key}")
    try:
        await redis.delete(run_lock_key)
        # logger.debug(f"Successfully cleaned up Redis run lock key: {run_lock_key}")
    except Exception as e:
        logger.warning(f"Failed to clean up Redis run lock key {run_lock_key}: {str(e)}")


# TTL for Redis response lists (24 hours)
REDIS_RESPONSE_LIST_TTL = 3600 * 24

async def _cleanup_redis_response_list(agent_run_id: str, *, ttl: int | None = None):
    """Set TTL on the Redis response list."""
    response_list_key = f"agent_run:{agent_run_id}:responses"
    try:
        ttl_to_set = ttl if ttl is not None else REDIS_RESPONSE_LIST_TTL
        await redis.expire(response_list_key, ttl_to_set)
        # logger.debug(f"Set TTL ({ttl_to_set}s) on response list: {response_list_key}")
    except Exception as e:
        logger.warning(f"Failed to set TTL on response list {response_list_key}: {str(e)}")

async def update_agent_run_status(
    client,
    agent_run_id: str,
    status: str,
    error: Optional[str] = None,
) -> bool:
    """
    Centralized function to update agent run status.
    Returns True if update was successful.
    """
    def _parse_iso(ts: Optional[str]) -> Optional[datetime]:
        if not ts:
            return None
        try:
            return datetime.fromisoformat(ts.replace("Z", "+00:00"))
        except Exception:
            return None

    async def _persist_run_timing(
        started_at: Optional[str],
        completed_at: Optional[str],
        final_status: str,
    ) -> None:
        if final_status not in {"completed", "failed", "stopped", "error"}:
            return
        started_dt = _parse_iso(started_at)
        completed_dt = _parse_iso(completed_at)
        if not started_dt or not completed_dt:
            return
        elapsed_ms = int((completed_dt - started_dt).total_seconds() * 1000)
        if elapsed_ms < 0:
            return

        try:
            msg_res = await client.table("messages").select("message_id, metadata").like(
                "message_dedup_key", f"{agent_run_id}:assistant_final:%"
            ).order("created_at", desc=True).limit(1).execute()
            if not getattr(msg_res, "data", None):
                return
            row = msg_res.data[0] or {}
            message_id = row.get("message_id")
            if not message_id:
                return
            metadata = row.get("metadata") or {}
            if isinstance(metadata, str):
                try:
                    metadata = json.loads(metadata)
                except Exception:
                    metadata = {}
            if not isinstance(metadata, dict):
                metadata = {}
            metadata.update(
                {
                    "run_elapsed_ms": elapsed_ms,
                    "run_status": final_status,
                    "run_started_at": started_at,
                    "run_completed_at": completed_at,
                }
            )
            await client.table("messages").update({"metadata": metadata}).eq(
                "message_id", message_id
            ).execute()
        except Exception as meta_err:
            logger.warning(
                "Failed to persist run timing metadata to assistant message",
                agent_run_id=agent_run_id,
                error=str(meta_err),
            )

    try:
        completed_at = datetime.now(timezone.utc).isoformat()
        use_case = UpdateAgentRunStatusUseCase(SupabaseAgentRunRepository())

        # Retry up to 3 times
        for retry in range(3):
            try:
                run = await use_case.execute(
                    agent_run_id=agent_run_id,
                    status=status,
                    error=error,
                    completed_at=completed_at,
                )

                if run:
                    await _persist_run_timing(run.started_at, run.completed_at, status)
                    return True

                logger.warning(
                    f"Database update returned no data for agent run {agent_run_id} on retry {retry}"
                )
                if retry == 2:
                    logger.error(f"Failed to update agent run status after all retries: {agent_run_id}")
                    return False
            except Exception as db_error:
                logger.error(f"Database error on retry {retry} updating status for {agent_run_id}: {str(db_error)}")
                if retry < 2:
                    await asyncio.sleep(0.5 * (2 ** retry))
                else:
                    logger.error(f"Failed to update agent run status after all retries: {agent_run_id}", exc_info=True)
                    return False
    except Exception as e:
        logger.error(f"Unexpected error updating agent run status for {agent_run_id}: {str(e)}", exc_info=True)
        return False

    return False
