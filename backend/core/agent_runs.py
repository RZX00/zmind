import asyncio
import json
import traceback
import uuid
import os
from datetime import datetime, timezone
from time import perf_counter
from typing import Any, Optional, List, Tuple, Dict
from fastapi import APIRouter, HTTPException, Depends, Request, Body, File, UploadFile, Form
from fastapi.responses import StreamingResponse

from core.utils.auth_utils import (
    verify_and_get_user_id_from_jwt,
    get_user_id_from_stream_auth,
    verify_and_authorize_thread_access,
    resolve_user_and_workspace,
)
from core.utils.logger import logger, structlog
from core.utils.idempotency import get_idempotency_key
from core.utils.errors import raise_api_error
from core.application.use_cases.agent.start_agent_run import StartAgentRunUseCase
from core.infrastructure.agent.supabase_agent_run_repository import SupabaseAgentRunRepository
from core.services import metrics
# Billing checks now handled by billing_integration.check_model_and_billing_access
from core.billing.billing_integration import billing_integration
from core.billing.provider_policy_service import provider_policy_service
from core.utils.config import config, EnvMode
from core.services import redis
from redis import exceptions as redis_exceptions
# Removed sandbox imports as part of Daytona removal
from run_agent_background import run_agent_background
from core.ai_models import model_manager
from core.agent_runtime_v2.semantics import normalize_response_mode

from .api_models import AgentStartRequest, AgentVersionResponse, AgentResponse, ThreadAgentResponse, InitiateAgentResponse
from . import core_utils as utils
from .core_utils import (
    stop_agent_run_with_helpers as stop_agent_run, get_agent_run_with_access_check, 
    _get_version_service, generate_and_update_project_name
)
from .config_helper import extract_agent_config
from .core_utils import check_agent_run_limit, check_project_count_limit

router = APIRouter()

async def check_billing_status(client, user_id: str) -> Tuple[bool, str, Optional[Dict]]:
    """
    Compatibility wrapper for the new credit-based billing system.
    Converts new credit system response to match old billing status format.
    """
    can_run, message, reservation_id = await billing_integration.check_and_reserve_credits(user_id)
    
    # Create a subscription-like object for backward compatibility
    subscription_info = {
        "price_id": "credit_based",
        "plan_name": "Credit System",
        "minutes_limit": "credit based"
    }
    
    return can_run, message, subscription_info


def _normalize_model_name(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, str):
        cleaned = value.strip()
        if cleaned.lower() in ("", "none", "null", "undefined"):
            return None
        return cleaned
    return str(value)


async def _resolve_attachment_metadata(
    client,
    account_id: str,
    attachments_payload: Optional[list],
) -> list[dict]:
    attachment_file_ids: list[str] = []
    attachment_name_map: dict[str, str] = {}
    attachments_meta: list[dict] = []

    if not attachments_payload:
        return attachments_meta

    for item in attachments_payload:
        candidate = None
        candidate_name = None
        if isinstance(item, str):
            candidate = item.strip()
        elif isinstance(item, dict):
            for key in ("file_id", "fileId", "id"):
                value = item.get(key)
                if isinstance(value, str) and value.strip():
                    candidate = value.strip()
                    break
            name_value = item.get("name") or item.get("filename") or item.get("original_filename")
            if isinstance(name_value, str):
                trimmed = name_value.strip()
                if trimmed:
                    candidate_name = trimmed[:255]
        if not candidate:
            continue
        try:
            uuid.UUID(candidate)
        except Exception:
            continue
        if candidate not in attachment_file_ids:
            attachment_file_ids.append(candidate)
        if candidate_name and candidate not in attachment_name_map:
            attachment_name_map[candidate] = candidate_name

    if not attachment_file_ids:
        return attachments_meta

    files_resp = await client.table('file_uploads') \
        .select('id, original_filename, file_size, content_type, status, storage_path') \
        .eq('account_id', account_id) \
        .in_('id', attachment_file_ids) \
        .execute()
    records = files_resp.data or []
    record_map = {str(r.get('id')): r for r in records}
    missing_ids = [fid for fid in attachment_file_ids if fid not in record_map]
    invalid_ids = [
        fid for fid in attachment_file_ids
        if record_map.get(fid, {}).get('status') not in (None, 'uploaded', 'processing', 'ready')
    ]
    if missing_ids or invalid_ids:
        raise HTTPException(
            status_code=400,
            detail="One or more attachments are invalid or not uploaded yet",
        )

    for fid in attachment_file_ids:
        record = record_map[fid]
        display_name = attachment_name_map.get(fid) or record.get('original_filename') or 'file'
        attachments_meta.append({
            "file_id": fid,
            "name": display_name,
            "size": record.get('file_size') or 0,
            "content_type": record.get('content_type') or 'application/octet-stream',
            "storage_path": record.get('storage_path'),
        })

    return attachments_meta


async def _resolve_effective_model(
    requested_model_name: Optional[str],
    agent_config: Optional[dict],
    account_id: str,
    client,
) -> Tuple[str, Optional[str], str]:
    async def _apply_policy_fallback(candidate_model: str, source: str) -> Tuple[str, str]:
        if not candidate_model:
            return candidate_model, source
        try:
            policy = await provider_policy_service.get_policy(account_id, client=client)
            model_obj = model_manager.get_model(candidate_model)
            provider_id = None
            if model_obj and model_obj.provider:
                provider_id = model_obj.provider.value
            elif "/" in candidate_model:
                provider_id = candidate_model.split("/", 1)[0].strip().lower()

            if provider_id and provider_id in set(policy.enabled_providers):
                return candidate_model, source

            all_models = model_manager.list_available_models(include_disabled=False)
            enabled_providers = set(policy.enabled_providers)
            allowed_model_ids = {
                m["id"] for m in all_models
                if m.get("id") and str(m.get("provider") or "").strip().lower() in enabled_providers
            }
            replacement = provider_policy_service.pick_default_model(
                policy=policy,
                allowed_model_ids=allowed_model_ids,
            )
            if replacement and replacement != candidate_model:
                logger.info(
                    "Model replaced by provider policy fallback",
                    account_id=account_id,
                    original_model=candidate_model,
                    fallback_model=replacement,
                    source=source,
                    provider_id=provider_id,
                )
                return replacement, f"{source}_policy_fallback"
        except Exception as exc:
            logger.warning(
                "Failed to apply provider policy fallback; keeping original model",
                account_id=account_id,
                model=candidate_model,
                source=source,
                error=str(exc),
            )
        return candidate_model, source

    requested = _normalize_model_name(requested_model_name)
    if requested:
        resolved = model_manager.resolve_model_id(requested) or requested
        return resolved, requested, "request"

    agent_model = _normalize_model_name(agent_config.get("model") if agent_config else None)
    if agent_model:
        resolved = model_manager.resolve_model_id(agent_model) or agent_model
        resolved, source = await _apply_policy_fallback(resolved, "agent_config")
        return resolved, None, source

    default_model = await model_manager.get_default_model_for_user(client, account_id)
    resolved_default = model_manager.resolve_model_id(default_model) or default_model
    resolved_default, source = await _apply_policy_fallback(resolved_default, "tier_default")
    return resolved_default, None, source


@router.post("/thread/{thread_id}/agent/start")
async def start_agent(
    thread_id: str,
    request: Request,
    body: AgentStartRequest = Body(...),
    user_id: str = Depends(verify_and_get_user_id_from_jwt)
):
    """Start an agent for a specific thread in the background"""
    request_started_at = perf_counter()
    structlog.contextvars.bind_contextvars(
        thread_id=thread_id,
    )
    if not utils.instance_id:
        raise HTTPException(status_code=500, detail="Agent API not initialized with instance ID")

    logger.debug(f"Requested model_name from request: {body.model_name}")
    client = await utils.db.client


    thread_result = await client.table('threads').select('project_id', 'account_id', 'canvas_id', 'metadata').eq('thread_id', thread_id).execute()

    if not thread_result.data:
        raise HTTPException(status_code=404, detail="Thread not found")
    thread_data = thread_result.data[0]
    project_id = thread_data.get('project_id')
    account_id = thread_data.get('account_id')
    thread_canvas_id = thread_data.get('canvas_id')
    thread_metadata = thread_data.get('metadata', {})
    if isinstance(thread_metadata, str):
        try:
            thread_metadata = json.loads(thread_metadata)
        except Exception:
            thread_metadata = {}
    if not isinstance(thread_metadata, dict):
        thread_metadata = {}

    run_mode = (body.run_mode or "agent").strip().lower()
    if run_mode not in ("agent", "chat"):
        run_mode = "agent"
    interaction_surface = (body.interaction_surface or "").strip().lower()
    if interaction_surface not in ("canvas", "doc"):
        thread_surface = str(thread_metadata.get("surface") or "").strip().lower()
        interaction_surface = thread_surface if thread_surface in ("canvas", "doc") else "canvas"

    is_chat_mode = run_mode == "chat"
    if is_chat_mode:
        # Chat mode includes full context (no compression).
        body.enable_context_manager = False

    if account_id != user_id:
        await verify_and_authorize_thread_access(client, thread_id, user_id)

    idempotency_key = get_idempotency_key(request)
    if idempotency_key:
        try:
            existing_run = (
                await client.table('agent_runs')
                .select('id, status')
                .eq('thread_id', thread_id)
                .eq('idempotency_key', idempotency_key)
                .limit(1)
                .execute()
            )
            if existing_run.data:
                row = existing_run.data[0]
                metrics.incr("agent_runs.idempotency_hit", 1)
                metrics.timing(
                    "agent_runs.start.total_ms",
                    (perf_counter() - request_started_at) * 1000.0,
                    result="duplicate_precheck",
                    run_mode=run_mode,
                )
                return {
                    "agent_run_id": row.get('id'),
                    "status": row.get('status', 'running'),
                    "duplicate": True,
                }
        except Exception as e:
            logger.warning(
                "Idempotency lookup failed; proceeding without dedupe",
                thread_id=thread_id,
                error=str(e),
            )

    structlog.contextvars.bind_contextvars(
        project_id=project_id,
        account_id=account_id,
        thread_metadata=thread_metadata,
    )
    
    # Load agent configuration with version support
    agent_config = None
    effective_agent_id = None if is_chat_mode else body.agent_id  # Optional agent ID from request
    
    logger.debug(f"[AGENT LOAD] Agent loading flow:")
    logger.debug(f"  - body.agent_id: {body.agent_id}")
    logger.debug(f"  - effective_agent_id: {effective_agent_id}")

    if is_chat_mode:
        if body.agent_id:
            logger.debug(f"[AGENT LOAD] Chat mode: ignoring agent_id {body.agent_id}")
        logger.debug("[AGENT LOAD] Chat mode: skipping agent config and default agent lookup")
    else:
        if effective_agent_id and effective_agent_id not in ['default', 'Zmind']:
            logger.debug(f"[AGENT LOAD] Querying for agent: {effective_agent_id}")
            # Get agent
            agent_result = await client.table('agents').select('*').eq('agent_id', effective_agent_id).eq('account_id', account_id).execute()
            logger.debug(f"[AGENT LOAD] Query result: found {len(agent_result.data) if agent_result.data else 0} agents")
            
            if not agent_result.data:
                if body.agent_id:
                    raise HTTPException(status_code=404, detail="Agent not found or access denied")
                else:
                    logger.debug(f"Stored agent_id {effective_agent_id} not found, falling back to built-in defaults")
                    effective_agent_id = None
            else:
                agent_data = agent_result.data[0]
                version_data = None
                if agent_data.get('current_version_id'):
                    try:
                        version_service = await _get_version_service()
                        version_obj = await version_service.get_version(
                            agent_id=effective_agent_id,
                            version_id=agent_data['current_version_id'],
                            user_id=user_id
                        )
                        version_data = version_obj.to_dict()
                        logger.debug(f"[AGENT LOAD] Got version data from version manager: {version_data.get('version_name')}")
                    except Exception as e:
                        logger.warning(f"[AGENT LOAD] Failed to get version data: {e}")
                
                logger.debug(f"[AGENT LOAD] About to call extract_agent_config with agent_data keys: {list(agent_data.keys())}")
                # logger.debug(f"[AGENT LOAD] version_data type: {type(version_data)}, has data: {version_data is not None}")
                
                agent_config = extract_agent_config(agent_data, version_data)
                
                if version_data:
                    logger.debug(f"Using agent {agent_config['name']} ({effective_agent_id}) version {agent_config.get('version_name', 'v1')}")
                else:
                    logger.debug(f"Using agent {agent_config['name']} ({effective_agent_id}) - no version data")
                source = "request" if body.agent_id else "fallback"
        else:
            logger.debug(f"[AGENT LOAD] No effective_agent_id, will try default agent")

        if not agent_config:
            logger.debug(f"[AGENT LOAD] No agent config yet, querying for default agent")
            default_agent_result = await client.table('agents').select('*').eq('account_id', account_id).eq('is_default', True).execute()
            logger.debug(f"[AGENT LOAD] Default agent query result: found {len(default_agent_result.data) if default_agent_result.data else 0} default agents")
            
            if default_agent_result.data:
                agent_data = default_agent_result.data[0]
                
                # Use versioning system to get current version
                version_data = None
                if agent_data.get('current_version_id'):
                    try:
                        version_service = await _get_version_service()
                        version_obj = await version_service.get_version(
                            agent_id=agent_data['agent_id'],
                            version_id=agent_data['current_version_id'],
                            user_id=user_id
                        )
                        version_data = version_obj.to_dict()
                        logger.debug(f"[AGENT LOAD] Got default agent version from version manager: {version_data.get('version_name')}")
                    except Exception as e:
                        logger.debug(f"[AGENT LOAD] Failed to get default agent version data: {e}")
                        pass
                
                logger.debug(f"[AGENT LOAD] About to call extract_agent_config for DEFAULT agent with version data: {version_data is not None}")
                
                agent_config = extract_agent_config(agent_data, version_data)
                
                if version_data:
                    logger.debug(f"Using default agent: {agent_config['name']} ({agent_config['agent_id']}) version {agent_config.get('version_name', 'v1')}")
                else:
                    logger.debug(f"Using default agent: {agent_config['name']} ({agent_config['agent_id']}) - no version data")
            else:
                logger.debug(f"[AGENT LOAD] No default agent found for account {account_id}; using built-in defaults")

    logger.debug(f"[AGENT LOAD] Final agent_config: {agent_config is not None}")
    if agent_config:
        logger.debug(f"[AGENT LOAD] Agent config keys: {list(agent_config.keys())}")
        logger.debug(f"Using agent {agent_config['agent_id']} for this agent run (thread remains agent-agnostic)")

    effective_model, requested_model, model_source = await _resolve_effective_model(
        body.model_name,
        agent_config,
        account_id,
        client,
    )

    # Default-thinking policy from model metadata
    try:
        model_obj = model_manager.get_model(effective_model)
        if body.enable_thinking is None and model_obj and model_obj.supports_thinking:
            default_thinking = bool((model_obj.metadata or {}).get('default_thinking', False))
            body.enable_thinking = default_thinking
    except Exception:
        pass

    logger.debug(
        "Starting new agent for thread",
        thread_id=thread_id,
        model=effective_model,
        requested_model=requested_model,
        model_source=model_source,
        thinking=body.enable_thinking,
        reasoning_effort=body.reasoning_effort,
        stream=body.stream,
        context_manager=body.enable_context_manager,
        run_mode=run_mode,
        instance_id=utils.instance_id,
    )

    # Unified billing and model access check
    can_proceed, error_message, context = await billing_integration.check_model_and_billing_access(
        account_id, effective_model, client
    )
    
    if not can_proceed:
        if context.get("error_type") == "model_access_denied":
            raise_api_error(
                403,
                error_message,
                error_code="MODEL_ACCESS_DENIED",
                retryable=False,
                extra={"allowed_models": context.get("allowed_models", [])},
            )
        elif context.get("error_type") == "insufficient_credits":
            raise_api_error(
                402,
                error_message,
                error_code="INSUFFICIENT_CREDITS",
                retryable=False,
            )
        else:
            raise_api_error(
                500,
                error_message,
                error_code="BILLING_CHECK_FAILED",
                retryable=True,
            )
    
    # Check agent run limits (only if not in local mode)
    if config.ENV_MODE != EnvMode.LOCAL and run_mode != "chat":
        limit_check = await check_agent_run_limit(client, account_id)
        if not limit_check['can_start']:
            error_detail = {
                "message": f"Maximum of {config.MAX_PARALLEL_AGENT_RUNS} parallel agent runs allowed within 24 hours. You currently have {limit_check['running_count']} running.",
                "running_thread_ids": limit_check['running_thread_ids'],
                "running_count": limit_check['running_count'],
                "limit": config.MAX_PARALLEL_AGENT_RUNS
            }
            logger.warning(f"Agent run limit exceeded for account {account_id}: {limit_check['running_count']} running agents")
            raise_api_error(
                429,
                error_detail["message"],
                error_code="AGENT_RUN_LIMIT_EXCEEDED",
                retryable=True,
                extra=error_detail,
            )

    client_message_hint = None
    if getattr(body, "client_message", None):
        try:
            client_message_hint = body.client_message.model_dump()
        except Exception:
            try:
                client_message_hint = body.client_message.dict()
            except Exception:
                client_message_hint = None
        if isinstance(client_message_hint, dict):
            allowed_keys = {"message_id", "content", "metadata", "role", "type"}
            client_message_hint = {
                key: value
                for key, value in client_message_hint.items()
                if key in allowed_keys and value is not None
            }
        else:
            client_message_hint = None

    selection_context_payload = body.selection_context if isinstance(body.selection_context, dict) else None
    workspace_target_payload = body.workspace_target if isinstance(body.workspace_target, dict) else None
    if workspace_target_payload is None and interaction_surface == "canvas" and thread_canvas_id:
        workspace_target_payload = {
            "canvas_id": thread_canvas_id,
            "workspace_id": account_id,
        }
    response_mode = normalize_response_mode(body.response_mode)
    resume_token = body.resume_token.strip() if isinstance(body.resume_token, str) and body.resume_token.strip() else None

    started_at = datetime.now(timezone.utc).isoformat()
    run_metadata = {
        "model_name": effective_model,
        "requested_model": requested_model,
        "model_source": model_source,
        "enable_thinking": body.enable_thinking,
        "reasoning_effort": body.reasoning_effort,
        "enable_context_manager": body.enable_context_manager,
        "run_mode": run_mode,
        "interaction_surface": interaction_surface,
        "selection_context": selection_context_payload,
        "workspace_target": workspace_target_payload,
        "response_mode": response_mode,
        "resume_token": resume_token,
    }
    if client_message_hint and client_message_hint.get("message_id"):
        run_metadata["client_message_id"] = client_message_hint.get("message_id")

    use_case = StartAgentRunUseCase(SupabaseAgentRunRepository())
    run, duplicate = await use_case.execute(
        thread_id=thread_id,
        status="running",
        started_at=started_at,
        agent_id=str(agent_config.get('agent_id')) if agent_config else None,
        agent_version_id=str(agent_config.get('current_version_id')) if agent_config else None,
        metadata=run_metadata,
        idempotency_key=idempotency_key,
        skip_idempotency_lookup=bool(idempotency_key),
        tenant_id=account_id,
        actor_id=user_id,
        event_payload={
            "model_name": effective_model,
        },
    )

    if duplicate:
        metrics.incr("agent_runs.idempotency_hit", 1)
        metrics.timing(
            "agent_runs.start.total_ms",
            (perf_counter() - request_started_at) * 1000.0,
            result="duplicate_repository",
            run_mode=run_mode,
        )
        return {
            "agent_run_id": run.id,
            "status": run.status or "running",
            "duplicate": True,
        }

    agent_run_id = run.id
    structlog.contextvars.bind_contextvars(
        agent_run_id=agent_run_id,
    )
    logger.debug(f"Created new agent run: {agent_run_id}")

    instance_key = f"active_run:{utils.instance_id}:{agent_run_id}"
    try:
        await redis.set(instance_key, "running", ex=redis.REDIS_KEY_TTL)
    except Exception as e:
        logger.warning(f"Failed to register agent run in Redis ({instance_key}): {str(e)}")

    request_id = structlog.contextvars.get_contextvars().get('request_id')

    pre_enqueue_ms = (perf_counter() - request_started_at) * 1000.0
    dispatch_started_at = perf_counter()

    run_agent_background.send(
        agent_run_id=agent_run_id, thread_id=thread_id, instance_id=utils.instance_id,
        project_id=project_id,
        model_name=effective_model,
        enable_thinking=body.enable_thinking, reasoning_effort=body.reasoning_effort,
        stream=body.stream, enable_context_manager=body.enable_context_manager,
        enable_prompt_caching=body.enable_prompt_caching,
        agent_config=agent_config,  # Pass agent configuration
        request_id=request_id,
        requested_model_name=requested_model,
        run_mode=run_mode,
        interaction_surface=interaction_surface,
        selection_context=selection_context_payload,
        workspace_target=workspace_target_payload,
        response_mode=response_mode,
        resume_token=resume_token,
        client_message=client_message_hint,
    )

    dispatch_ms = (perf_counter() - dispatch_started_at) * 1000.0
    total_ms = (perf_counter() - request_started_at) * 1000.0
    metrics.timing("agent_runs.start.pre_enqueue_ms", pre_enqueue_ms, run_mode=run_mode)
    metrics.timing("agent_runs.start.dispatch_ms", dispatch_ms, run_mode=run_mode)
    metrics.timing("agent_runs.start.total_ms", total_ms, run_mode=run_mode, result="enqueued")

    return {"agent_run_id": agent_run_id, "status": "running"}

@router.post("/agent-run/{agent_run_id}/stop")
async def stop_agent(agent_run_id: str, user_id: str = Depends(verify_and_get_user_id_from_jwt)):
    """Stop a running agent."""
    structlog.contextvars.bind_contextvars(
        agent_run_id=agent_run_id,
    )
    logger.debug(f"Received request to stop agent run: {agent_run_id}")
    client = await utils.db.client
    await get_agent_run_with_access_check(client, agent_run_id, user_id)
    await stop_agent_run(agent_run_id)
    return {"status": "stopped"}

@router.get("/thread/{thread_id}/agent-runs")
async def get_agent_runs(thread_id: str, user_id: str = Depends(verify_and_get_user_id_from_jwt)):
    """Get all agent runs for a thread."""
    structlog.contextvars.bind_contextvars(
        thread_id=thread_id,
    )
    logger.debug(f"Fetching agent runs for thread: {thread_id}")
    client = await utils.db.client
    await verify_and_authorize_thread_access(client, thread_id, user_id)
    agent_runs = await client.table('agent_runs').select('id, thread_id, status, started_at, completed_at, error, created_at, updated_at').eq("thread_id", thread_id).order('created_at', desc=True).execute()
    logger.debug(f"Found {len(agent_runs.data)} agent runs for thread: {thread_id}")
    return {"agent_runs": agent_runs.data}

@router.get("/agent-run/{agent_run_id}")
async def get_agent_run(agent_run_id: str, user_id: str = Depends(verify_and_get_user_id_from_jwt)):
    """Get agent run status and responses."""
    structlog.contextvars.bind_contextvars(
        agent_run_id=agent_run_id,
    )
    logger.debug(f"Fetching agent run details: {agent_run_id}")
    client = await utils.db.client
    agent_run_data = await get_agent_run_with_access_check(client, agent_run_id, user_id)
    # Note: Responses are not included here by default, they are in the stream or DB
    return {
        "id": agent_run_data['id'],
        "threadId": agent_run_data['thread_id'],
        "status": agent_run_data['status'],
        "startedAt": agent_run_data['started_at'],
        "completedAt": agent_run_data['completed_at'],
        "error": agent_run_data['error']
    }

@router.get("/thread/{thread_id}/agent", response_model=ThreadAgentResponse)
async def get_thread_agent(thread_id: str, user_id: str = Depends(verify_and_get_user_id_from_jwt)):
    """Get the agent details for a specific thread. Since threads are fully agent-agnostic, 
    this returns the most recently used agent from agent_runs only."""
    structlog.contextvars.bind_contextvars(
        thread_id=thread_id,
    )
    logger.debug(f"Fetching agent details for thread: {thread_id}")
    client = await utils.db.client
    
    try:
        # Verify thread access and get thread data
        await verify_and_authorize_thread_access(client, thread_id, user_id)
        thread_result = await client.table('threads').select('account_id').eq('thread_id', thread_id).execute()
        
        if not thread_result.data:
            raise HTTPException(status_code=404, detail="Thread not found")
        
        thread_data = thread_result.data[0]
        account_id = thread_data.get('account_id')
        
        effective_agent_id = None
        agent_source = "none"
        
        # Get the most recently used agent from agent_runs
        recent_agent_result = await client.table('agent_runs').select('agent_id', 'agent_version_id').eq('thread_id', thread_id).not_.is_('agent_id', 'null').order('created_at', desc=True).limit(1).execute()
        if recent_agent_result.data:
            effective_agent_id = recent_agent_result.data[0]['agent_id']
            recent_version_id = recent_agent_result.data[0].get('agent_version_id')
            agent_source = "recent"
            logger.debug(f"Found most recently used agent: {effective_agent_id} (version: {recent_version_id})")
        
        # If no agent found in agent_runs
        if not effective_agent_id:
            return {
                "agent": None,
                "source": "none",
                "message": "No agent has been used in this thread yet. Threads are agent-agnostic - use /agent/start to select an agent."
            }
        
        # Fetch the agent details
        agent_result = await client.table('agents').select('*').eq('agent_id', effective_agent_id).eq('account_id', account_id).execute()
        
        if not agent_result.data:
            # Agent was deleted or doesn't exist
            return {
                "agent": None,
                "source": "missing",
                "message": f"Agent {effective_agent_id} not found or was deleted. You can select a different agent."
            }
        
        agent_data = agent_result.data[0]
        
        # Use versioning system to get current version data
        version_data = None
        current_version = None
        if agent_data.get('current_version_id'):
            try:
                version_service = await _get_version_service()
                current_version_obj = await version_service.get_version(
                    agent_id=effective_agent_id,
                    version_id=agent_data['current_version_id'],
                    user_id=user_id
                )
                current_version_data = current_version_obj.to_dict()
                version_data = current_version_data
                
                # Create AgentVersionResponse from version data
                current_version = AgentVersionResponse(
                    version_id=current_version_data['version_id'],
                    agent_id=current_version_data['agent_id'],
                    version_number=current_version_data['version_number'],
                    version_name=current_version_data['version_name'],
                    system_prompt=current_version_data['system_prompt'],
                    model=current_version_data.get('model'),
                    configured_mcps=current_version_data.get('configured_mcps', []),
                    custom_mcps=current_version_data.get('custom_mcps', []),
                    native_tools=current_version_data.get('native_tools', {}),
                    is_active=current_version_data.get('is_active', True),
                    created_at=current_version_data['created_at'],
                    updated_at=current_version_data.get('updated_at', current_version_data['created_at']),
                    created_by=current_version_data.get('created_by')
                )
                
                logger.debug(f"Using agent {agent_data['name']} version {current_version_data.get('version_name', 'v1')}")
            except Exception as e:
                logger.warning(f"Failed to get version data for agent {effective_agent_id}: {e}")
        
        version_data = None
        if current_version:
            version_data = {
                'version_id': current_version.version_id,
                'agent_id': current_version.agent_id,
                'version_number': current_version.version_number,
                'version_name': current_version.version_name,
                'system_prompt': current_version.system_prompt,
                'model': current_version.model,
                'configured_mcps': current_version.configured_mcps,
                'custom_mcps': current_version.custom_mcps,
                'native_tools': current_version.native_tools,
                'is_active': current_version.is_active,
                'created_at': current_version.created_at,
                'updated_at': current_version.updated_at,
                'created_by': current_version.created_by
            }
        
        from .config_helper import extract_agent_config
        agent_config = extract_agent_config(agent_data, version_data)
        
        system_prompt = agent_config['system_prompt']
        configured_mcps = agent_config['configured_mcps']
        custom_mcps = agent_config['custom_mcps']
        native_tools = agent_config['native_tools']
        
        return {
            "agent": AgentResponse(
                agent_id=agent_data['agent_id'],
                name=agent_data['name'],
                description=agent_data.get('description'),
                system_prompt=system_prompt,
                configured_mcps=configured_mcps,
                custom_mcps=custom_mcps,
                native_tools=native_tools,
                is_default=agent_data.get('is_default', False),
                is_public=agent_data.get('is_public', False),
                tags=agent_data.get('tags', []),
                profile_image_url=agent_config.get('profile_image_url'),
                created_at=agent_data['created_at'],
                updated_at=agent_data.get('updated_at', agent_data['created_at']),
                current_version_id=agent_data.get('current_version_id'),
                version_count=agent_data.get('version_count', 1),
                current_version=current_version,
                metadata=agent_data.get('metadata')
            ),
            "source": agent_source,
            "message": f"Using {agent_source} agent: {agent_data['name']}. Threads are agent-agnostic - you can change agents anytime."
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching agent for thread {thread_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch thread agent: {str(e)}")

@router.get("/agent-run/{agent_run_id}/stream")
async def stream_agent_run(
    agent_run_id: str,
    token: Optional[str] = None,
    request: Request = None
):
    """Stream the responses of an agent run using Redis Lists and Pub/Sub."""
    logger.debug(f"Starting stream for agent run: {agent_run_id}")
    client = await utils.db.client

    user_id = await get_user_id_from_stream_auth(request, token) # practically instant
    agent_run_data = await get_agent_run_with_access_check(client, agent_run_id, user_id) # 1 db query

    structlog.contextvars.bind_contextvars(
        agent_run_id=agent_run_id,
        user_id=user_id,
    )

    response_list_key = f"agent_run:{agent_run_id}:responses"
    response_channel = f"agent_run:{agent_run_id}:new_response"
    control_channel = f"agent_run:{agent_run_id}:control" # Global control channel

    async def stream_generator(agent_run_data):
        logger.debug(f"Streaming responses for {agent_run_id} using Redis list {response_list_key} and channel {response_channel}")
        last_processed_index = -1
        stream_started_perf = perf_counter()
        subscribed_perf: Optional[float] = None
        first_response_emitted = False

        def _mark_first_response_emit() -> None:
            nonlocal first_response_emitted
            if first_response_emitted:
                return
            first_response_emitted = True
            now = perf_counter()
            metrics.timing("agent_stream.first_response_emit_ms", (now - stream_started_perf) * 1000.0)
            if subscribed_perf is not None:
                metrics.timing(
                    "agent_stream.first_response_post_subscribe_ms",
                    (now - subscribed_perf) * 1000.0,
                )
        # Support SSE resume via Last-Event-ID header (or query param fallback)
        try:
            last_event_id_header = request.headers.get("Last-Event-ID") if request else None
            resume_source = "header"
            if last_event_id_header is None and request:
                last_event_id_header = request.query_params.get("lastEventId")
                resume_source = "query"
            if last_event_id_header is not None:
                last_processed_index = int(last_event_id_header)
                metrics.incr("agent_stream.resume", 1, source=resume_source)
                logger.debug(f"Resuming stream from Last-Event-ID={last_processed_index}")
        except Exception as _e:
            metrics.incr("agent_stream.resume_invalid", 1)
            logger.debug(f"Ignoring invalid Last-Event-ID: {_e}")
        # Single pubsub used for response + control
        listener_task = None
        terminate_stream = False
        initial_yield_complete = False
        last_ping_ts = datetime.now(timezone.utc)

        def _payload_to_json(raw_payload: Any) -> str:
            if isinstance(raw_payload, bytes):
                return raw_payload.decode("utf-8")
            if isinstance(raw_payload, str):
                return raw_payload
            return json.dumps(raw_payload)

        def _extract_terminal_status(payload_json: str) -> Optional[str]:
            if '"status"' not in payload_json or '"type"' not in payload_json:
                return None
            try:
                parsed = json.loads(payload_json)
            except Exception:
                return None
            if not isinstance(parsed, dict) or parsed.get("type") != "status":
                return None
            status = parsed.get("status")
            if isinstance(status, str) and status in {"completed", "failed", "stopped"}:
                return status
            return None

        try:
            # 1. Fetch and yield initial responses from Redis list
            # If resuming, only emit after last_processed_index
            initial_start_index = max(0, last_processed_index + 1)
            initial_responses_json = await redis.lrange(response_list_key, initial_start_index, -1)
            if initial_responses_json:
                logger.debug(f"Sending {len(initial_responses_json)} initial responses for {agent_run_id}")
                # Emit with SSE event IDs so clients can resume
                for offset, raw_response in enumerate(initial_responses_json, start=initial_start_index):
                    payload_json = _payload_to_json(raw_response)
                    _mark_first_response_emit()
                    yield f"id: {offset}\n"
                    yield f"data: {payload_json}\n\n"
                # Update last_processed_index to last emitted index
                last_processed_index = initial_start_index + len(initial_responses_json) - 1
            initial_yield_complete = True

            # 2. Check run status
            current_status = agent_run_data.get('status') if agent_run_data else None

            if current_status != 'running':
                status_map = {
                    "completed": "completed",
                    "failed": "error",
                    "error": "error",
                    "stopped": "stopped",
                }
                mapped_status = status_map.get(current_status, "completed")
                logger.debug(f"Agent run {agent_run_id} is not running (status: {current_status}). Ending stream.")
                # Flush any responses that landed after the initial lrange but before we checked status.
                try:
                    new_start_index = last_processed_index + 1
                    remaining = await redis.lrange(response_list_key, new_start_index, -1)
                    if remaining:
                        for i, raw_response in enumerate(remaining):
                            payload_json = _payload_to_json(raw_response)
                            current_index = new_start_index + i
                            _mark_first_response_emit()
                            yield f"id: {current_index}\n"
                            yield f"data: {payload_json}\n\n"
                        last_processed_index = new_start_index + len(remaining) - 1
                except Exception as _flush_err:
                    logger.debug(f"Flush remaining responses failed for {agent_run_id}: {_flush_err}")
                yield f"data: {json.dumps({'type': 'status', 'status': mapped_status})}\n\n"
                return
          
            structlog.contextvars.bind_contextvars(
                thread_id=agent_run_data.get('thread_id'),
            )

            # 3. Use a single Pub/Sub connection subscribed to both channels
            pubsub = await redis.create_pubsub()
            await pubsub.subscribe(response_channel, control_channel)
            subscribed_perf = perf_counter()
            metrics.timing(
                "agent_stream.subscribe_ready_ms",
                (subscribed_perf - stream_started_perf) * 1000.0,
            )
            logger.debug(f"Subscribed to channels: {response_channel}, {control_channel}")

            # Queue to communicate between listeners and the main generator loop.
            # Keep bounded to prevent unbounded memory growth under backpressure.
            message_queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=256)
            new_response_queued = False

            async def queue_message(item: dict) -> None:
                nonlocal new_response_queued
                item_type = item.get("type")
                if item_type == "new_response":
                    if new_response_queued:
                        return
                    new_response_queued = True
                    try:
                        message_queue.put_nowait(item)
                    except asyncio.QueueFull:
                        new_response_queued = False
                        metrics.incr("agent_stream.queue_full", 1, item_type="new_response")
                    return

                try:
                    message_queue.put_nowait(item)
                except asyncio.QueueFull:
                    metrics.incr("agent_stream.queue_full", 1, item_type=item_type or "unknown")
                    await message_queue.put(item)

            async def flush_new_responses():
                nonlocal last_processed_index, terminate_stream, new_response_queued
                new_response_queued = False
                new_start_index = last_processed_index + 1
                new_responses_json = await redis.lrange(response_list_key, new_start_index, -1)
                if not new_responses_json:
                    return

                num_new = len(new_responses_json)
                metrics.gauge("agent_stream.flush_batch_size", num_new)
                for i, raw_response in enumerate(new_responses_json):
                    payload_json = _payload_to_json(raw_response)
                    current_index = new_start_index + i
                    _mark_first_response_emit()
                    yield f"id: {current_index}\n"
                    yield f"data: {payload_json}\n\n"
                    terminal_status = _extract_terminal_status(payload_json)
                    if terminal_status:
                        logger.debug(f"Detected run completion via status message in stream: {terminal_status}")
                        terminate_stream = True
                        break
                last_processed_index = new_start_index + num_new - 1

            async def listen_messages():
                try:
                    async for message in pubsub.listen():
                        if terminate_stream:
                            return
                        if message and isinstance(message, dict) and message.get("type") == "message":
                            channel = message.get("channel")
                            data = message.get("data")
                            if isinstance(data, bytes):
                                data = data.decode('utf-8')

                            if channel == response_channel and data == "new":
                                await queue_message({"type": "new_response"})
                            elif channel == control_channel and data in ["STOP", "END_STREAM", "ERROR"]:
                                logger.debug(f"Received control signal '{data}' for {agent_run_id}")
                                await queue_message({"type": "control", "data": data})
                                return  # Stop listening on control signal
                except asyncio.CancelledError:
                    logger.debug(f"Listener cancelled for {agent_run_id}.")
                    return
                except redis_exceptions.ConnectionError as e:
                    # Redis connection closed (e.g., during shutdown/cleanup); treat as graceful stop.
                    logger.debug(f"Listener connection closed for {agent_run_id}: {e}")
                    await queue_message({"type": "control", "data": "END_STREAM"})
                    return
                except Exception as e:
                    logger.error(f"Error in listener for {agent_run_id}: {e}")
                    await queue_message({"type": "error", "data": "Listener failed"})
                    return


            listener_task = asyncio.create_task(listen_messages())

            # Catch up after subscribing to avoid missing responses between initial fetch and pubsub
            try:
                catchup_start = last_processed_index + 1
                catchup_json = await redis.lrange(response_list_key, catchup_start, -1)
                if catchup_json:
                    for offset, raw_response in enumerate(catchup_json, start=catchup_start):
                        payload_json = _payload_to_json(raw_response)
                        _mark_first_response_emit()
                        yield f"id: {offset}\n"
                        yield f"data: {payload_json}\n\n"
                    last_processed_index = catchup_start + len(catchup_json) - 1
            except Exception as _catchup_err:
                logger.debug(f"Catch-up fetch failed for {agent_run_id}: {_catchup_err}")

            # 4. Main loop to process messages from the queue
            while not terminate_stream:
                try:
                    # Periodically emit ping to keep connection alive
                    try:
                        queue_item = await asyncio.wait_for(message_queue.get(), timeout=15.0)
                    except asyncio.TimeoutError:
                        # Fallback catch-up to tolerate dropped pubsub wakeups under queue pressure.
                        async for payload in flush_new_responses():
                            yield payload
                        if terminate_stream:
                            break
                        now = datetime.now(timezone.utc)
                        # Emit ping every ~15s
                        if (now - last_ping_ts).total_seconds() >= 15:
                            yield f"event: ping\n"
                            yield f"data: {json.dumps({'type': 'ping'})}\n\n"
                            last_ping_ts = now
                        continue

                    if queue_item["type"] == "new_response":
                        async for payload in flush_new_responses():
                            yield payload
                        if terminate_stream:
                            break

                    elif queue_item["type"] == "control":
                        control_signal = queue_item["data"]
                        # Before terminating, flush any remaining responses
                        try:
                            new_start_index = last_processed_index + 1
                            remaining = await redis.lrange(response_list_key, new_start_index, -1)
                            if remaining:
                                for i, raw_response in enumerate(remaining):
                                    payload_json = _payload_to_json(raw_response)
                                    current_index = new_start_index + i
                                    _mark_first_response_emit()
                                    yield f"id: {current_index}\n"
                                    yield f"data: {payload_json}\n\n"
                                last_processed_index = new_start_index + len(remaining) - 1
                        except Exception as _flush_err:
                            logger.debug(f"Flush remaining responses failed for {agent_run_id}: {_flush_err}")

                        # Map control signals to standard statuses for clients
                        mapped = 'completed' if control_signal == 'END_STREAM' else 'stopped' if control_signal == 'STOP' else 'error'
                        terminate_stream = True # Stop the stream on any control signal
                        yield f"data: {json.dumps({'type': 'status', 'status': mapped})}\n\n"
                        break

                    elif queue_item["type"] == "error":
                        logger.error(f"Listener error for {agent_run_id}: {queue_item['data']}")
                        terminate_stream = True
                        yield f"data: {json.dumps({'type': 'status', 'status': 'error'})}\n\n"
                        break

                except asyncio.CancelledError:
                     logger.debug(f"Stream generator main loop cancelled for {agent_run_id}")
                     terminate_stream = True
                     break
                except Exception as loop_err:
                    logger.error(f"Error in stream generator main loop for {agent_run_id}: {loop_err}", exc_info=True)
                    terminate_stream = True
                    yield f"data: {json.dumps({'type': 'status', 'status': 'error', 'message': f'Stream failed: {loop_err}'})}\n\n"
                    break

        except Exception as e:
            logger.error(f"Error setting up stream for agent run {agent_run_id}: {e}", exc_info=True)
            # Only yield error if initial yield didn't happen
            if not initial_yield_complete:
                 yield f"data: {json.dumps({'type': 'status', 'status': 'error', 'message': f'Failed to start stream: {e}'})}\n\n"
        finally:
            terminate_stream = True
            if listener_task:
                listener_task.cancel()
                try:
                    await listener_task  # Reap inner tasks & swallow their errors
                except asyncio.CancelledError:
                    pass
                except Exception as e:
                    logger.debug(f"listener_task ended with: {e}")
            # Graceful shutdown order: cancel → unsubscribe → close
            try:
                if 'pubsub' in locals() and pubsub:
                    await pubsub.unsubscribe(response_channel, control_channel)
                    await pubsub.close()
            except Exception as e:
                logger.debug(f"Error during pubsub cleanup for {agent_run_id}: {e}")
            # Wait briefly for tasks to cancel
            await asyncio.sleep(0.1)
            logger.debug(f"Streaming cleanup complete for agent run: {agent_run_id}")

    return StreamingResponse(stream_generator(agent_run_data), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache, no-transform", "Connection": "keep-alive",
        "X-Accel-Buffering": "no", "Content-Type": "text/event-stream",
        "Access-Control-Allow-Origin": "*"
    })



@router.post("/agent/initiate", response_model=InitiateAgentResponse)
async def initiate_agent_with_files(
    prompt: str = Form(...),
    model_name: Optional[str] = Form(None),  # Default to None to use default model
    enable_thinking: Optional[bool] = Form(None),
    reasoning_effort: Optional[str] = Form("low"),
    stream: Optional[bool] = Form(True),
    enable_context_manager: Optional[bool] = Form(False),
    enable_prompt_caching: Optional[bool] = Form(False),
    agent_id: Optional[str] = Form(None),  # Add agent_id parameter
    files: List[UploadFile] = File(default=[]),
    attachments: Optional[str] = Form(None),
    user_workspace: tuple[str, str] = Depends(resolve_user_and_workspace),
):
    """
    Initiate a new agent session with optional file attachments.

    [WARNING] Keep in sync with create thread endpoint.
    """
    if not utils.instance_id:
        raise HTTPException(status_code=500, detail="Agent API not initialized with instance ID")

    logger.debug(f"Requested model_name from request: {model_name}")
    client = await utils.db.client
    user_id, account_id = user_workspace

    attachments_meta: list[dict] = []
    if attachments:
        try:
            parsed = json.loads(attachments)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid attachments payload")
        if not isinstance(parsed, list):
            raise HTTPException(status_code=400, detail="Invalid attachments payload")
        attachments_meta = await _resolve_attachment_metadata(client, account_id, parsed)
    
    # Load agent configuration with version support (same as start_agent endpoint)
    agent_config = None
    
    logger.debug(f"[AGENT INITIATE] Agent loading flow:")
    logger.debug(f"  - agent_id param: {agent_id}")
    
    if agent_id and agent_id not in ['default', 'Zmind']:
        logger.debug(f"[AGENT INITIATE] Querying for specific agent: {agent_id}")
        # Get agent
        agent_result = await client.table('agents').select('*').eq('agent_id', agent_id).eq('account_id', account_id).execute()
        logger.debug(f"[AGENT INITIATE] Query result: found {len(agent_result.data) if agent_result.data else 0} agents")
        
        if not agent_result.data:
            raise HTTPException(status_code=404, detail="Agent not found or access denied")
        
        agent_data = agent_result.data[0]
        
        # Use versioning system to get current version
        version_data = None
        if agent_data.get('current_version_id'):
            try:
                version_service = await _get_version_service()
                version_obj = await version_service.get_version(
                    agent_id=agent_id,
                    version_id=agent_data['current_version_id'],
                    user_id=user_id
                )
                version_data = version_obj.to_dict()
                logger.debug(f"[AGENT INITIATE] Got version data from version manager: {version_data.get('version_name')}")
                logger.debug(f"[AGENT INITIATE] Version data: {version_data}")
            except Exception as e:
                logger.warning(f"[AGENT INITIATE] Failed to get version data: {e}")
        
        logger.debug(f"[AGENT INITIATE] About to call extract_agent_config with version data: {version_data is not None}")
        
        agent_config = extract_agent_config(agent_data, version_data)
        
        if version_data:
            logger.debug(f"Using custom agent: {agent_config['name']} ({agent_id}) version {agent_config.get('version_name', 'v1')}")
        else:
            logger.debug(f"Using custom agent: {agent_config['name']} ({agent_id}) - no version data")
    else:
        logger.debug(f"[AGENT INITIATE] No agent_id provided, querying for default agent")
        # Try to get default agent for the account
        default_agent_result = await client.table('agents').select('*').eq('account_id', account_id).eq('is_default', True).execute()
        logger.debug(f"[AGENT INITIATE] Default agent query result: found {len(default_agent_result.data) if default_agent_result.data else 0} default agents")
        
        if default_agent_result.data:
            agent_data = default_agent_result.data[0]
            
            # Use versioning system to get current version
            version_data = None
            if agent_data.get('current_version_id'):
                try:
                    version_service = await _get_version_service()
                    version_obj = await version_service.get_version(
                        agent_id=agent_data['agent_id'],
                        version_id=agent_data['current_version_id'],
                        user_id=user_id
                    )
                    version_data = version_obj.to_dict()
                    logger.debug(f"[AGENT INITIATE] Got default agent version from version manager: {version_data.get('version_name')}")
                except Exception as e:
                    logger.debug(f"[AGENT INITIATE] Failed to get default agent version data: {e}")
            
            logger.debug(f"[AGENT INITIATE] About to call extract_agent_config for DEFAULT agent with version data: {version_data is not None}")
            
            agent_config = extract_agent_config(agent_data, version_data)
            
            if version_data:
                logger.debug(f"Using default agent: {agent_config['name']} ({agent_config['agent_id']}) version {agent_config.get('version_name', 'v1')}")
            else:
                logger.debug(f"Using default agent: {agent_config['name']} ({agent_config['agent_id']}) - no version data")
        else:
            logger.debug(f"[AGENT INITIATE] No default agent found for account {account_id}; using built-in defaults")
    
    logger.debug(f"[AGENT INITIATE] Final agent_config: {agent_config is not None}")
    if agent_config:
        logger.debug(f"[AGENT INITIATE] Agent config keys: {list(agent_config.keys())}")

    effective_model, requested_model, model_source = await _resolve_effective_model(
        model_name,
        agent_config,
        account_id,
        client,
    )

    # Default-thinking policy from model metadata
    try:
        model_obj = model_manager.get_model(effective_model)
        if enable_thinking is None and model_obj and model_obj.supports_thinking:
            default_thinking = bool((model_obj.metadata or {}).get('default_thinking', False))
            enable_thinking = default_thinking
    except Exception:
        pass

    logger.debug(
        "Initiating agent with prompt and files",
        model=effective_model,
        requested_model=requested_model,
        model_source=model_source,
        enable_thinking=enable_thinking,
        reasoning_effort=reasoning_effort,
        stream=stream,
        context_manager=enable_context_manager,
        instance_id=utils.instance_id,
        file_count=len(files or []),
    )

    # Unified billing and model access check
    can_proceed, error_message, context = await billing_integration.check_model_and_billing_access(
        account_id, effective_model, client
    )
    
    if not can_proceed:
        if context.get("error_type") == "model_access_denied":
            raise HTTPException(status_code=403, detail={
                "message": error_message, 
                "allowed_models": context.get("allowed_models", [])
            })
        elif context.get("error_type") == "insufficient_credits":
            raise HTTPException(status_code=402, detail={"message": error_message})
        else:
            raise HTTPException(status_code=500, detail={"message": error_message})
    
    # Check additional limits (only if not in local mode)
    if config.ENV_MODE != EnvMode.LOCAL:
        # Check agent run limit and project limit concurrently
        limit_check_task = asyncio.create_task(check_agent_run_limit(client, account_id))
        project_limit_check_task = asyncio.create_task(check_project_count_limit(client, account_id))
        
        limit_check, project_limit_check = await asyncio.gather(
            limit_check_task, project_limit_check_task
        )
        
        # Check agent run limit (maximum parallel runs in past 24 hours)
        if not limit_check['can_start']:
            error_detail = {
                "message": f"Maximum of {config.MAX_PARALLEL_AGENT_RUNS} parallel agent runs allowed within 24 hours. You currently have {limit_check['running_count']} running.",
                "running_thread_ids": limit_check['running_thread_ids'],
                "running_count": limit_check['running_count'],
                "limit": config.MAX_PARALLEL_AGENT_RUNS
            }
            logger.warning(f"Agent run limit exceeded for account {account_id}: {limit_check['running_count']} running agents")
            raise HTTPException(status_code=429, detail=error_detail)

        if not project_limit_check['can_create']:
            error_detail = {
                "message": f"Maximum of {project_limit_check['limit']} projects allowed for your current plan. You have {project_limit_check['current_count']} projects.",
                "current_count": project_limit_check['current_count'],
                "limit": project_limit_check['limit'],
                "tier_name": project_limit_check['tier_name'],
                "error_code": "PROJECT_LIMIT_EXCEEDED"
            }
            logger.warning(f"Project limit exceeded for account {account_id}: {project_limit_check['current_count']}/{project_limit_check['limit']} projects")
            raise HTTPException(status_code=402, detail=error_detail)

    try:
        # 1. Create Project
        placeholder_name = f"{prompt[:30]}..." if len(prompt) > 30 else prompt
        project = await client.table('projects').insert({
            "project_id": str(uuid.uuid4()), "account_id": account_id, "name": placeholder_name,
            "created_at": datetime.now(timezone.utc).isoformat()
        }).execute()
        project_id = project.data[0]['project_id']
        logger.info(f"Created new project: {project_id}")

        # 3. Create Thread
        thread_data = {
            "thread_id": str(uuid.uuid4()), 
            "project_id": project_id, 
            "account_id": account_id,
            "created_at": datetime.now(timezone.utc).isoformat()
        }

        structlog.contextvars.bind_contextvars(
            thread_id=thread_data["thread_id"],
            project_id=project_id,
            account_id=account_id,
        )
        
        # Don't store agent_id in thread since threads are now agent-agnostic
        # The agent selection will be handled per message/agent run
        if agent_config:
            logger.debug(f"Using agent {agent_config['agent_id']} for this conversation (thread remains agent-agnostic)")
            structlog.contextvars.bind_contextvars(
                agent_id=agent_config['agent_id'],
            )
        
        thread = await client.table('threads').insert(thread_data).execute()
        thread_id = thread.data[0]['thread_id']
        logger.debug(f"Created new thread: {thread_id}")

        # Trigger Background Naming Task
        asyncio.create_task(generate_and_update_project_name(project_id=project_id, prompt=prompt))

        # 4. Upload Files to Cloud Storage (if any)
        message_content = prompt
        if files:
            from core.utils.s3_upload_utils import upload_bytes_to_r2

            uploaded_attachments: list[dict] = []
            failed_uploads: list[str] = []

            for file in files:
                filename = getattr(file, "filename", None)
                if not filename:
                    continue
                safe_filename = filename.replace('/', '_').replace('\\', '_')
                try:
                    logger.debug(f"Attempting to upload {safe_filename} to cloud storage")
                    content = await file.read()
                    if len(content) == 0:
                        failed_uploads.append(f"{safe_filename} (empty file)")
                        continue

                    result = await upload_bytes_to_r2(
                        content,
                        filename=safe_filename,
                        content_type=file.content_type or "application/octet-stream",
                        account_id=account_id,
                        user_id=user_id,
                        source="agent-initiate",
                        path_prefix="agent-files",
                        project_id=project_id,
                    )

                    file_id = result.get("file_id")
                    storage_path = result.get("storage_path")
                    if file_id and storage_path:
                        uploaded_attachments.append({
                            "file_id": file_id,
                            "name": safe_filename,
                            "size": len(content),
                            "content_type": file.content_type or "application/octet-stream",
                            "storage_path": storage_path,
                        })
                except Exception as file_error:
                    logger.error(f"Error processing file {safe_filename}: {str(file_error)}", exc_info=True)
                    failed_uploads.append(safe_filename)
                finally:
                    await file.close()

            if uploaded_attachments:
                attachments_meta.extend(uploaded_attachments)
            if failed_uploads:
                message_content += "\n\nFailed uploads:\n"
                for failed_file in failed_uploads:
                    message_content += f"- {failed_file}\n"

        # 5. Add initial user message to thread
        message_id = str(uuid.uuid4())
        message_payload = {"role": "user", "content": message_content}
        message_metadata = {}
        if attachments_meta:
            message_metadata["attachments"] = attachments_meta
        await client.table('messages').insert({
            "message_id": message_id, "thread_id": thread_id, "type": "user",
            "is_llm_message": True, "content": json.dumps(message_payload),
            "metadata": message_metadata,
            "created_at": datetime.now(timezone.utc).isoformat()
        }).execute()

        if attachments_meta:
            try:
                await client.table('file_links').upsert(
                    [
                        {
                            "file_id": att["file_id"],
                            "entity_type": "message",
                            "entity_id": message_id,
                        }
                        for att in attachments_meta
                    ],
                    on_conflict="file_id,entity_type,entity_id",
                ).execute()
            except Exception as e:
                logger.warning(f"Failed to link attachments to message {message_id}: {e}")

        started_at = datetime.now(timezone.utc).isoformat()
        run_metadata = {
            "model_name": effective_model,
            "requested_model": requested_model,
            "model_source": model_source,
            "enable_thinking": enable_thinking,
            "reasoning_effort": reasoning_effort,
            "enable_context_manager": enable_context_manager,
            "run_mode": "agent",
            "interaction_surface": "canvas",
            "response_mode": "auto",
            "workspace_target": {
                "canvas_id": canvas['id'],
                "workspace_id": account_id,
            },
        }
        use_case = StartAgentRunUseCase(SupabaseAgentRunRepository())
        run, _duplicate = await use_case.execute(
            thread_id=thread_id,
            status="running",
            started_at=started_at,
            agent_id=str(agent_config.get('agent_id')) if agent_config else None,
            agent_version_id=str(agent_config.get('current_version_id')) if agent_config else None,
            metadata=run_metadata,
            idempotency_key=None,
            tenant_id=account_id,
            actor_id=user_id,
            event_payload={
                "model_name": effective_model,
            },
        )
        agent_run_id = run.id
        logger.debug(f"Created new agent run: {agent_run_id}")
        structlog.contextvars.bind_contextvars(
            agent_run_id=agent_run_id,
        )

        # Register run in Redis
        instance_key = f"active_run:{utils.instance_id}:{agent_run_id}"
        try:
            await redis.set(instance_key, "running", ex=redis.REDIS_KEY_TTL)
        except Exception as e:
            logger.warning(f"Failed to register agent run in Redis ({instance_key}): {str(e)}")

        request_id = structlog.contextvars.get_contextvars().get('request_id')

        # Run agent in background
        run_agent_background.send(
            agent_run_id=agent_run_id, thread_id=thread_id, instance_id=utils.instance_id,
            project_id=project_id,
            model_name=effective_model,
            enable_thinking=enable_thinking, reasoning_effort=reasoning_effort,
            stream=stream, enable_context_manager=enable_context_manager,
            enable_prompt_caching=enable_prompt_caching,
            agent_config=agent_config,  # Pass agent configuration
            request_id=request_id,
            requested_model_name=requested_model,
            interaction_surface="canvas",
            workspace_target={
                "canvas_id": canvas['id'],
                "workspace_id": account_id,
            },
            response_mode="auto",
        )

        return {"thread_id": thread_id, "agent_run_id": agent_run_id}

    except Exception as e:
        logger.error(f"Error in agent initiation: {str(e)}\n{traceback.format_exc()}")
        # TODO: Clean up created project/thread if initiation fails mid-way
        raise HTTPException(status_code=500, detail=f"Failed to initiate agent session: {str(e)}")

