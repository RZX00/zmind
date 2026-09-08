import json
import traceback
import uuid
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, Form, Query, Body

from core.utils.auth_utils import (
    verify_and_get_user_id_from_jwt,
    verify_and_authorize_thread_access,
    require_thread_access,
    AuthorizedThreadAccess,
    resolve_user_and_workspace,
)
from core.utils.logger import logger
from core.services.r2_storage import get_r2_client, get_r2_bucket
from core.canvas.workspace_context import (
    build_workspace_scope_metadata,
    resolve_target_canvas_from_message,
)
from core.canvas.agent_context import normalize_selection_context_payload
from core.docs.agent_context import normalize_doc_context_payload
# Removed sandbox imports as part of Daytona removal

from .api_models import CreateThreadResponse, MessageCreateRequest
from . import core_utils as utils

router = APIRouter()


def _coalesce_str(payload: dict, keys: tuple[str, ...]) -> Optional[str]:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, str):
            value = value.strip()
            if value:
                return value
    return None


def _coalesce_int(payload: dict, keys: tuple[str, ...]) -> Optional[int]:
    for key in keys:
        value = payload.get(key)
        if value is None:
            continue
        try:
            return int(value)
        except Exception:
            continue
    return None


async def _fetch_workspace_canvases_for_resolution(client, account_id: str) -> list[dict]:
    """Fetch all non-deleted canvases for title-based target resolution."""
    rows: list[dict] = []
    page_size = 500
    offset = 0
    while True:
        resp = (
            await client.table("canvases")
            .select("id,title,is_deleted,updated_at")
            .eq("account_id", account_id)
            .eq("is_deleted", False)
            .order("updated_at", desc=True)
            .range(offset, offset + page_size - 1)
            .execute()
        )
        batch = resp.data or []
        for row in batch:
            canvas_id = row.get("id")
            if not canvas_id:
                continue
            rows.append(
                {
                    "id": str(canvas_id),
                    "title": str(row.get("title") or ""),
                }
            )
        if len(batch) < page_size:
            break
        offset += page_size
    return rows


async def _load_thread_message_context(client, thread_id: str, fallback_user_id: str) -> tuple[str, int, Optional[str]]:
    """Load thread-level context for message insert with graceful legacy-schema fallback."""
    account_id = fallback_user_id
    session_index = 0
    current_canvas_id: Optional[str] = None

    row = None
    try:
        result = (
            await client.table('threads')
            .select('account_id,metadata,canvas_id')
            .eq('thread_id', thread_id)
            .limit(1)
            .execute()
        )
        if result.data:
            row = result.data[0]
    except Exception:
        # Backward compatibility: some environments may not have canvas_id on threads.
        try:
            result = (
                await client.table('threads')
                .select('account_id,metadata')
                .eq('thread_id', thread_id)
                .limit(1)
                .execute()
            )
            if result.data:
                row = result.data[0]
        except Exception:
            row = None

    if not isinstance(row, dict):
        return account_id, session_index, current_canvas_id

    raw_account_id = row.get('account_id')
    if isinstance(raw_account_id, str) and raw_account_id.strip():
        account_id = raw_account_id.strip()

    raw_metadata = row.get('metadata') or {}
    if isinstance(raw_metadata, str):
        try:
            raw_metadata = json.loads(raw_metadata)
        except Exception:
            raw_metadata = {}
    if isinstance(raw_metadata, dict):
        try:
            session_index = int(raw_metadata.get('current_session_index', 0) or 0)
        except Exception:
            session_index = 0

    raw_canvas_id = row.get('canvas_id')
    if isinstance(raw_canvas_id, str):
        raw_canvas_id = raw_canvas_id.strip()
        if raw_canvas_id:
            current_canvas_id = raw_canvas_id

    return account_id, session_index, current_canvas_id


async def _maybe_cleanup_file_upload(client, file_id: str) -> None:
    try:
        remaining = await client.table("file_links") \
            .select("id") \
            .eq("file_id", file_id) \
            .limit(1) \
            .execute()
        if remaining.data:
            return
        record_resp = await client.table("file_uploads") \
            .select("storage_provider, storage_bucket, storage_path") \
            .eq("id", file_id) \
            .limit(1) \
            .execute()
        if not record_resp.data:
            return
        record = record_resp.data[0]
    except Exception:
        return

    provider = record.get("storage_provider") or "supabase"
    key = record.get("storage_path")
    if not key:
        return
    try:
        if provider == "r2":
            r2 = get_r2_client()
            r2.delete_object(Bucket=get_r2_bucket(), Key=key)
        else:
            await client.table("file_uploads").update({
                "deleted_at": datetime.now(timezone.utc).isoformat(),
                "status": "deleted",
            }).eq("id", file_id).execute()
            return
        await client.table("file_uploads").update({
            "deleted_at": datetime.now(timezone.utc).isoformat(),
            "status": "deleted",
        }).eq("id", file_id).execute()
    except Exception as e:
        logger.warning(f"[threads] file cleanup failed for {file_id}: {e}")

@router.get("/threads")
async def get_user_threads(
    user_workspace: tuple[str, str] = Depends(resolve_user_and_workspace),
    page: Optional[int] = Query(1, ge=1, description="Page number (1-based)"),
    limit: Optional[int] = Query(1000, ge=1, le=1000, description="Number of items per page (max 1000)")
):
    """Get all threads for the current user with associated project data."""
    user_id, workspace_id = user_workspace
    logger.debug(
        f"Fetching threads with project data for workspace: {workspace_id} (user={user_id}, page={page}, limit={limit})"
    )
    client = await utils.db.client
    try:
        offset = (page - 1) * limit
        
        # First, get threads for the user
        threads_result = await client.table('threads').select('*').eq('account_id', workspace_id).order('created_at', desc=True).execute()
        
        if not threads_result.data:
            logger.debug(f"No threads found for workspace: {workspace_id}")
            return {
                "threads": [],
                "pagination": {
                    "page": page,
                    "limit": limit,
                    "total": 0,
                    "pages": 0
                }
            }
        
        total_count = len(threads_result.data)
        
        # Apply pagination to threads
        paginated_threads = threads_result.data[offset:offset + limit]
        
        # Extract unique project IDs from threads that have them
        project_ids = [
            thread['project_id'] for thread in paginated_threads 
            if thread.get('project_id')
        ]
        unique_project_ids = list(set(project_ids)) if project_ids else []
        
        # Fetch projects if we have project IDs
        projects_by_id = {}
        if unique_project_ids:
            from core.utils.query_utils import batch_query_in
            
            projects_data = await batch_query_in(
                client=client,
                table_name='projects',
                select_fields='*',
                in_field='project_id',
                in_values=unique_project_ids
            )
            
            logger.debug(f"[API] Retrieved {len(projects_data)} projects")
            # Create a lookup map of projects by ID
            projects_by_id = {
                project['project_id']: project 
                for project in projects_data
            }
        
        # Map threads with their associated projects
        mapped_threads = []
        for thread in paginated_threads:
            project_data = None
            if thread.get('project_id') and thread['project_id'] in projects_by_id:
                project = projects_by_id[thread['project_id']]
                project_data = {
                    "project_id": project['project_id'],
                    "name": project.get('name', ''),
                    "description": project.get('description', ''),
                    # Removed sandbox field as part of Daytona removal
                    "is_public": project.get('is_public', False),
                    "created_at": project['created_at'],
                    "updated_at": project['updated_at']
                }
            
            mapped_thread = {
                "thread_id": thread['thread_id'],
                "project_id": thread.get('project_id'),
                "metadata": thread.get('metadata', {}),
                "is_public": thread.get('is_public', False),
                "created_at": thread['created_at'],
                "updated_at": thread['updated_at'],
                "project": project_data
            }
            mapped_threads.append(mapped_thread)
        
        total_pages = (total_count + limit - 1) // limit if total_count else 0
        
        logger.debug(f"[API] Mapped threads for frontend: {len(mapped_threads)} threads, {len(projects_by_id)} unique projects")
        
        return {
            "threads": mapped_threads,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total_count,
                "pages": total_pages
            }
        }
        
    except Exception as e:
        logger.error(f"Error fetching threads for workspace {workspace_id} (user={user_id}): {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch threads: {str(e)}")

@router.get("/threads/{thread_id}")
async def get_thread(
    thread_id: str,
    auth: AuthorizedThreadAccess = Depends(require_thread_access)
):
    """Get a specific thread by ID with complete related data."""
    logger.debug(f"Fetching thread: {thread_id}")
    client = await utils.db.client
    user_id = auth.user_id  # Already authenticated and authorized!
    
    try:
        # No need for manual authorization - it's already done in the dependency!
        
        # Get the thread data
        thread_result = await client.table('threads').select('*').eq('thread_id', thread_id).execute()
        
        if not thread_result.data:
            raise HTTPException(status_code=404, detail="Thread not found")
        
        thread = thread_result.data[0]
        
        # Get associated project if thread has a project_id
        project_data = None
        if thread.get('project_id'):
            project_result = await client.table('projects').select('*').eq('project_id', thread['project_id']).execute()
            
            if project_result.data:
                project = project_result.data[0]
                logger.debug(f"[API] Raw project from DB for thread {thread_id}")
                project_data = {
                    "project_id": project['project_id'],
                    "name": project.get('name', ''),
                    "description": project.get('description', ''),
                    # Removed sandbox field as part of Daytona removal
                    "is_public": project.get('is_public', False),
                    "created_at": project['created_at'],
                    "updated_at": project['updated_at']
                }
        
        # Get message count for the thread
        message_count_result = await client.table('messages').select('message_id', count='exact').eq('thread_id', thread_id).execute()
        message_count = message_count_result.count if message_count_result.count is not None else 0
        
        # Get recent agent runs for the thread
        agent_runs_result = await client.table('agent_runs').select('*').eq('thread_id', thread_id).order('created_at', desc=True).execute()
        agent_runs_data = []
        if agent_runs_result.data:
            agent_runs_data = [{
                "id": run['id'],
                "status": run.get('status', ''),
                "started_at": run.get('started_at'),
                "completed_at": run.get('completed_at'),
                "error": run.get('error'),
                "agent_id": run.get('agent_id'),
                "agent_version_id": run.get('agent_version_id'),
                "created_at": run['created_at']
            } for run in agent_runs_result.data]
        
        # Map thread data for frontend (matching actual DB structure)
        mapped_thread = {
            "thread_id": thread['thread_id'],
            "project_id": thread.get('project_id'),
            "metadata": thread.get('metadata', {}),
            "is_public": thread.get('is_public', False),
            "created_at": thread['created_at'],
            "updated_at": thread['updated_at'],
            "project": project_data,
            "message_count": message_count,
            "recent_agent_runs": agent_runs_data
        }
        
        logger.debug(f"[API] Mapped thread for frontend: {thread_id} with {message_count} messages and {len(agent_runs_data)} recent runs")
        return mapped_thread
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching thread {thread_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch thread: {str(e)}")

@router.post("/threads", response_model=CreateThreadResponse)
async def create_thread(
    name: Optional[str] = Form(None),
    user_workspace: tuple[str, str] = Depends(resolve_user_and_workspace),
):
    """
    Create a new thread without starting an agent run.

    [WARNING] Keep in sync with initiate endpoint.
    """
    if not name:
        name = "New Project"
    user_id, workspace_id = user_workspace
    logger.debug(f"Creating new thread with name: {name}")
    client = await utils.db.client
    account_id = workspace_id
    
    try:
        # 1. Create Project
        project_name = name or "New Project"
        project = await client.table('projects').insert({
            "project_id": str(uuid.uuid4()), 
            "account_id": account_id, 
            "name": project_name,
            "created_at": datetime.now(timezone.utc).isoformat()
        }).execute()
        project_id = project.data[0]['project_id']
        logger.debug(f"Created new project: {project_id}")

        # Cloud-based project - no sandbox creation needed
        # Projects now run entirely in cloud mode without sandbox requirements
        logger.debug(f"Project {project_id} created in cloud mode")

        # 3. Create Thread
        thread_data = {
            "thread_id": str(uuid.uuid4()), 
            "project_id": project_id, 
            "account_id": account_id,
            "created_at": datetime.now(timezone.utc).isoformat()
        }

        from core.utils.logger import structlog
        structlog.contextvars.bind_contextvars(
            thread_id=thread_data["thread_id"],
            project_id=project_id,
            account_id=account_id,
        )
        
        thread = await client.table('threads').insert(thread_data).execute()
        thread_id = thread.data[0]['thread_id']
        logger.debug(f"Created new thread: {thread_id}")

        logger.debug(f"Successfully created thread {thread_id} with project {project_id}")
        return {"thread_id": thread_id, "project_id": project_id}

    except Exception as e:
        logger.error(f"Error creating thread: {str(e)}\n{traceback.format_exc()}")
        # TODO: Clean up created project/thread if creation fails mid-way
        raise HTTPException(status_code=500, detail=f"Failed to create thread: {str(e)}")

@router.get("/threads/{thread_id}/messages")
async def get_thread_messages(
    thread_id: str,
    user_id: str = Depends(verify_and_get_user_id_from_jwt),
    order: str = Query("desc", description="Order by created_at: 'asc' or 'desc'")
):
    """Get all messages for a thread, fetching in batches of 1000 from the DB to avoid large queries."""
    logger.debug(f"Fetching all messages for thread: {thread_id}, order={order}")
    client = await utils.db.client
    await verify_and_authorize_thread_access(client, thread_id, user_id)
    try:
        batch_size = 1000
        offset = 0
        all_messages = []
        while True:
            query = client.table('messages').select('*').eq('thread_id', thread_id)
            query = query.order('created_at', desc=(order == "desc"))
            query = query.range(offset, offset + batch_size - 1)
            messages_result = await query.execute()
            batch = messages_result.data or []
            all_messages.extend(batch)
            logger.debug(f"Fetched batch of {len(batch)} messages (offset {offset})")
            if len(batch) < batch_size:
                break
            offset += batch_size
        return {"messages": all_messages}
    except Exception as e:
        logger.error(f"Error fetching messages for thread {thread_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch messages: {str(e)}")

@router.get("/agent-runs/{agent_run_id}")
async def get_agent_run(
    agent_run_id: str,
    user_id: str = Depends(verify_and_get_user_id_from_jwt),
):
    """
    [DEPRECATED] Get an agent run by ID.

    This endpoint is deprecated and may be removed in future versions.
    """
    logger.warning(f"[DEPRECATED] Fetching agent run: {agent_run_id}")
    client = await utils.db.client
    try:
        agent_run_result = await client.table('agent_runs').select('*').eq('agent_run_id', agent_run_id).eq('account_id', user_id).execute()
        if not agent_run_result.data:
            raise HTTPException(status_code=404, detail="Agent run not found")
        return agent_run_result.data[0]
    except Exception as e:
        logger.error(f"Error fetching agent run {agent_run_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch agent run: {str(e)}")

@router.post("/threads/{thread_id}/messages/add")
async def add_message_to_thread(
    thread_id: str,
    payload: dict = Body(...),
    user_id: str = Depends(verify_and_get_user_id_from_jwt),
):
    """Add a user message to a thread with session tagging."""
    logger.debug(f"Adding message to thread: {thread_id}")
    client = await utils.db.client
    try:
        await verify_and_authorize_thread_access(client, thread_id, user_id)
        (
            account_id,
            current_session_index,
            current_thread_canvas_id,
        ) = await _load_thread_message_context(client, thread_id, user_id)

        message_text = payload.get('message') if isinstance(payload, dict) else None
        if not isinstance(message_text, str):
            raise HTTPException(status_code=400, detail="Invalid message payload")
        message_text = message_text or ""
        workspace_scope = build_workspace_scope_metadata(message_text)

        # Optional structured contexts.
        selection_context = None
        selection_context_warnings: list[str] = []
        doc_context = None
        doc_context_warnings: list[str] = []
        try:
            if isinstance(payload, dict):
                raw_context = payload.get('context') if 'context' in payload else None
                raw_doc_context = payload.get('doc_context') or payload.get('docContext')

                if raw_doc_context is not None:
                    doc_context, doc_context_warnings = normalize_doc_context_payload(
                        raw_doc_context,
                    )

                if raw_context is not None:
                    inferred_doc_context, inferred_doc_warnings = normalize_doc_context_payload(
                        raw_context,
                    )
                    if inferred_doc_context and doc_context is None:
                        doc_context = inferred_doc_context
                        doc_context_warnings = inferred_doc_warnings
                    else:
                        selection_context, selection_context_warnings = normalize_selection_context_payload(
                            raw_context,
                        )
        except Exception:
            selection_context = None
            selection_context_warnings = []
            doc_context = None
            doc_context_warnings = []

        cta_action = None
        cta_payload = None
        cta_label = None
        try:
            if isinstance(payload, dict):
                cta_action = payload.get('cta_action') or payload.get('ctaAction')
                cta_payload = payload.get('cta_payload') or payload.get('ctaPayload')
                cta_label = payload.get('cta_label') or payload.get('ctaLabel')
        except Exception:
            cta_action = None
            cta_payload = None
            cta_label = None

        workspace_target_canvas = None
        workspace_target_canvas_ambiguous: list[str] = []
        try:
            if isinstance(payload, dict):
                raw_target = payload.get('target_canvas') or payload.get('targetCanvas')
                if isinstance(raw_target, dict):
                    raw_canvas_id = (
                        raw_target.get('canvas_id')
                        or raw_target.get('canvasId')
                        or raw_target.get('id')
                    )
                    raw_canvas_title = raw_target.get('title') or raw_target.get('name')
                    if isinstance(raw_canvas_id, str):
                        canvas_id = raw_canvas_id.strip()
                        if canvas_id:
                            workspace_target_canvas = {"canvas_id": canvas_id[:128]}
                            if isinstance(raw_canvas_title, str):
                                canvas_title = raw_canvas_title.strip()
                                if canvas_title:
                                    workspace_target_canvas["title"] = canvas_title[:200]
        except Exception:
            workspace_target_canvas = None

        if not workspace_target_canvas:
            try:
                should_try_resolve = bool(
                    workspace_scope.get("write_intent")
                    or workspace_scope.get("has_canvas_reference")
                    or workspace_scope.get("explicit_global_read")
                )
                if should_try_resolve:
                    workspace_canvases = await _fetch_workspace_canvases_for_resolution(
                        client,
                        account_id,
                    )
                    resolved_target, ambiguous_titles = resolve_target_canvas_from_message(
                        message_text,
                        workspace_canvases,
                    )
                    if resolved_target:
                        workspace_target_canvas = resolved_target
                    elif ambiguous_titles:
                        workspace_target_canvas_ambiguous = ambiguous_titles
            except Exception as e:
                logger.debug(f"[threads] workspace target resolution skipped: {e}")

        workspace_write_policy = {
            "cross_canvas_write_requires_explicit_target": True,
            "cross_canvas_write_allowed": False,
        }
        if current_thread_canvas_id:
            workspace_write_policy["default_canvas_id"] = current_thread_canvas_id
        if workspace_target_canvas and isinstance(workspace_target_canvas, dict):
            target_canvas_id = workspace_target_canvas.get("canvas_id")
            if isinstance(target_canvas_id, str):
                target_canvas_id = target_canvas_id.strip()
                if target_canvas_id:
                    workspace_write_policy["target_canvas_id"] = target_canvas_id
                    if current_thread_canvas_id and target_canvas_id != current_thread_canvas_id:
                        workspace_write_policy["cross_canvas_write_allowed"] = True
        if workspace_target_canvas_ambiguous:
            workspace_write_policy["ambiguous_titles"] = workspace_target_canvas_ambiguous[:8]

        reference_images: list[dict] = []
        try:
            raw_refs = payload.get('reference_images') if isinstance(payload, dict) else None
            if isinstance(raw_refs, list):
                for item in raw_refs:
                    if not isinstance(item, dict):
                        continue
                    file_id = _coalesce_str(item, ("file_id", "fileId"))
                    storage_path = _coalesce_str(item, ("storage_path", "storagePath"))
                    node_id = _coalesce_str(item, ("node_id", "nodeId"))
                    label = _coalesce_str(item, ("label", "name"))
                    source = _coalesce_str(item, ("source",))
                    width = _coalesce_int(item, ("width",))
                    height = _coalesce_int(item, ("height",))
                    if not (file_id or storage_path or node_id):
                        continue
                    reference_images.append({
                        "file_id": file_id,
                        "storage_path": storage_path,
                        "node_id": node_id,
                        "label": label,
                        "width": width,
                        "height": height,
                        "source": source,
                    })
        except Exception:
            reference_images = []

        attachment_file_ids: list[str] = []
        attachment_name_map: dict[str, str] = {}
        attachments_meta: list[dict] = []
        try:
            raw_attachments = payload.get('attachments') if isinstance(payload, dict) else None
            if isinstance(raw_attachments, list):
                for item in raw_attachments:
                    candidate: Optional[str] = None
                    candidate_name: Optional[str] = None
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
        except Exception:
            attachment_file_ids = []
            attachment_name_map = {}

        if not message_text.strip() and not attachment_file_ids and not reference_images:
            raise HTTPException(status_code=400, detail="Invalid message payload")

        metadata = {'session_index': current_session_index}
        metadata['workspace_scope'] = workspace_scope
        metadata['workspace_write_policy'] = workspace_write_policy
        if selection_context:
            metadata['selection_context'] = selection_context
        if selection_context_warnings:
            metadata['selection_context_warnings'] = selection_context_warnings[:8]
        if doc_context:
            metadata['doc_context'] = doc_context
        if doc_context_warnings:
            metadata['doc_context_warnings'] = doc_context_warnings[:8]
        if cta_action:
            metadata['cta_action'] = cta_action
        if cta_payload is not None:
            metadata['cta_payload'] = cta_payload
        if cta_label:
            metadata['cta_label'] = cta_label
        if workspace_target_canvas:
            metadata['workspace_target_canvas'] = workspace_target_canvas
        if workspace_target_canvas_ambiguous:
            metadata['workspace_target_canvas_ambiguous'] = workspace_target_canvas_ambiguous[:8]
        if reference_images:
            metadata['reference_images'] = reference_images
        if attachment_file_ids:
            try:
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
                attachments_meta = []
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
                metadata['attachments'] = attachments_meta
            except HTTPException:
                raise
            except Exception as e:
                logger.error(f"Error validating attachments: {str(e)}")
                raise HTTPException(status_code=500, detail="Failed to validate attachments")

        message_result = await client.table('messages').insert({
            'thread_id': thread_id,
            'type': 'user',
            'is_llm_message': True,
            'content': {"role": "user", "content": message_text},
            'metadata': metadata
        }).execute()
        if attachments_meta and message_result.data:
            try:
                message_id = message_result.data[0].get('message_id')
                if message_id:
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
                logger.warning(f"Failed to link attachments to message {thread_id}: {e}")
        return message_result.data[0]
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error adding message to thread {thread_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to add message: {str(e)}")

@router.post("/threads/{thread_id}/messages")
async def create_message(
    thread_id: str,
    message_data: MessageCreateRequest,
    user_id: str = Depends(verify_and_get_user_id_from_jwt)
):
    """Create a new message in a thread."""
    logger.debug(f"Creating message in thread: {thread_id}")
    client = await utils.db.client
    
    try:
        await verify_and_authorize_thread_access(client, thread_id, user_id)
        
        message_payload = {
            "role": "user" if message_data.type == "user" else "assistant",
            "content": message_data.content
        }
        
        insert_data = {
            "message_id": str(uuid.uuid4()),
            "thread_id": thread_id,
            "type": message_data.type,
            "is_llm_message": message_data.is_llm_message,
            "content": message_payload,  # Store as JSONB object, not JSON string
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        
        message_result = await client.table('messages').insert(insert_data).execute()
        
        if not message_result.data:
            raise HTTPException(status_code=500, detail="Failed to create message")
        
        logger.debug(f"Created message: {message_result.data[0]['message_id']}")
        return message_result.data[0]
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating message in thread {thread_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to create message: {str(e)}")

@router.delete("/threads/{thread_id}/messages/{message_id}")
async def delete_message(
    thread_id: str,
    message_id: str,
    user_id: str = Depends(verify_and_get_user_id_from_jwt)
):
    """Delete a message from a thread."""
    logger.debug(f"Deleting message from thread: {thread_id}")
    client = await utils.db.client
    await verify_and_authorize_thread_access(client, thread_id, user_id)
    try:
        linked_file_ids: list[str] = []
        try:
            links_resp = await client.table('file_links') \
                .select('file_id') \
                .eq('entity_type', 'message') \
                .eq('entity_id', message_id) \
                .execute()
            linked_file_ids = [str(row.get('file_id')) for row in (links_resp.data or []) if row.get('file_id')]
        except Exception:
            linked_file_ids = []

        # Don't allow users to delete the "status" messages
        await client.table('messages') \
            .delete() \
            .eq('message_id', message_id) \
            .eq('is_llm_message', True) \
            .eq('thread_id', thread_id) \
            .execute()

        if linked_file_ids:
            try:
                await client.table('file_links') \
                    .delete() \
                    .eq('entity_type', 'message') \
                    .eq('entity_id', message_id) \
                    .execute()
            except Exception as e:
                logger.warning(f"[threads] failed to remove file links for message {message_id}: {e}")
            for fid in linked_file_ids:
                await _maybe_cleanup_file_upload(client, fid)

        return {"message": "Message deleted successfully"}
    except Exception as e:
        logger.error(f"Error deleting message {message_id} from thread {thread_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to delete message: {str(e)}")
@router.post("/threads/{thread_id}/reset")
async def reset_thread(
    thread_id: str,
    user_id: str = Depends(verify_and_get_user_id_from_jwt),
):
    # Start a new session within the thread (soft reset). Optionally stop running agent runs.
    client = await utils.db.client
    await verify_and_authorize_thread_access(client, thread_id, user_id)
    try:
        # Stop running agent runs for this thread
        try:
            runs = await client.table('agent_runs').select('id').eq('thread_id', thread_id).eq('status', 'running').execute()
            if runs.data:
                from .core_utils import stop_agent_run_with_helpers
                for r in runs.data:
                    try:
                        await stop_agent_run_with_helpers(r['id'])
                    except Exception:
                        pass
        except Exception:
            pass

        # Get thread metadata
        t = await client.table('threads').select('metadata').eq('thread_id', thread_id).limit(1).execute()
        tmeta = (t.data[0].get('metadata') if t.data else {}) or {}
        if isinstance(tmeta, str):
            try:
                import json as _json
                tmeta = _json.loads(tmeta)
            except Exception:
                tmeta = {}
        current = int(tmeta.get('current_session_index', 0) or 0)
        new_index = current + 1

        from datetime import datetime, timezone
        now_iso = datetime.now(timezone.utc).isoformat()

        # Update thread metadata
        deleted = tmeta.get('deleted_sessions') or []
        deleted_set = set()
        if isinstance(deleted, list):
            for val in deleted:
                try:
                    deleted_set.add(int(val))
                except Exception:
                    continue
        deleted_set.discard(int(new_index))
        new_meta = {
            **tmeta,
            'current_session_index': new_index,
            'last_reset_at': now_iso,
            'deleted_sessions': sorted(list(deleted_set)),
        }
        await client.table('threads').update({'metadata': new_meta}).eq('thread_id', thread_id).execute()

        # Insert reset marker message (system)
        await client.table('messages').insert({
            'thread_id': thread_id,
            'type': 'system',
            'is_llm_message': False,
            'content': {'role': 'system', 'content': 'Session reset'},
            'metadata': {'session_reset': True, 'session_index': new_index, 'reset_at': now_iso}
        }).execute()

        # Fire and forget: attempt to generate title for previous session
        try:
            from .core_utils import generate_session_title
            import asyncio as _asyncio
            _asyncio.create_task(generate_session_title(thread_id, current))
        except Exception:
            pass

        return {"current_session_index": new_index, "last_reset_at": now_iso}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error resetting thread {thread_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to reset thread: {str(e)}")

@router.post("/threads/{thread_id}/sessions/resume")
async def resume_session(
    thread_id: str,
    payload: dict = Body(...),
    user_id: str = Depends(verify_and_get_user_id_from_jwt),
):
    # Switch current session pointer to a previous session index.
    client = await utils.db.client
    await verify_and_authorize_thread_access(client, thread_id, user_id)
    try:
        target = payload.get('session_index') if isinstance(payload, dict) else None
        try:
            target = int(target)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid session_index")
        if target < 0:
            raise HTTPException(status_code=400, detail="session_index must be >= 0")
        # Update metadata
        t = await client.table('threads').select('metadata').eq('thread_id', thread_id).limit(1).execute()
        tmeta = (t.data[0].get('metadata') if t.data else {}) or {}
        if isinstance(tmeta, str):
            try:
                import json as _json
                tmeta = _json.loads(tmeta)
            except Exception:
                tmeta = {}
        deleted = tmeta.get('deleted_sessions') or []
        deleted_set = set()
        if isinstance(deleted, list):
            for val in deleted:
                try:
                    deleted_set.add(int(val))
                except Exception:
                    continue
        if target in deleted_set:
            raise HTTPException(status_code=400, detail="session_index has been deleted")
        new_meta = {**tmeta, 'current_session_index': target}
        await client.table('threads').update({'metadata': new_meta}).eq('thread_id', thread_id).execute()
        return {"current_session_index": target}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error resuming session for thread {thread_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to resume session: {str(e)}")

@router.get("/threads/{thread_id}/sessions")
async def list_sessions(
    thread_id: str,
    user_id: str = Depends(verify_and_get_user_id_from_jwt),
):
    # List sessions within the thread with basic metadata and titles.
    client = await utils.db.client
    await verify_and_authorize_thread_access(client, thread_id, user_id)
    try:
        # Load thread metadata for titles and current index
        t = await client.table('threads').select('metadata').eq('thread_id', thread_id).limit(1).execute()
        tmeta = (t.data[0].get('metadata') if t.data else {}) or {}
        if isinstance(tmeta, str):
            try:
                import json as _json
                tmeta = _json.loads(tmeta)
            except Exception:
                tmeta = {}
        current = int(tmeta.get('current_session_index', 0) or 0)
        titles = tmeta.get('session_titles') or {}
        deleted = tmeta.get('deleted_sessions') or []
        deleted_set = set()
        if isinstance(deleted, list):
            for val in deleted:
                try:
                    deleted_set.add(int(val))
                except Exception:
                    continue

        sessions = []
        try:
            res_all = await client.table('messages').select('created_at, type, metadata, content').eq('thread_id', thread_id).order('created_at', desc=False).limit(5000).execute()
            rows = res_all.data or []
        except Exception:
            rows = []

        def _sess_of(m):
            md = m.get('metadata') or {}
            if isinstance(md, str):
                try:
                    import json as _json
                    md = _json.loads(md)
                except Exception:
                    md = {}
            sv = md.get('session_index')
            if sv is None:
                sv = 0
            try:
                sv = int(sv)
            except Exception:
                sv = 0
            return sv

        session_rows = {}
        for row in rows:
            idx = _sess_of(row)
            session_rows.setdefault(idx, []).append(row)

        max_index = current
        if session_rows:
            try:
                max_index = max(max_index, max(session_rows.keys()))
            except Exception:
                pass

        # Build sessions [0..max_index], skipping deleted or empty
        for idx in range(0, max_index + 1):
            if idx in deleted_set:
                continue
            sess_rows = session_rows.get(idx, [])
            title = titles.get(str(idx)) if isinstance(titles, dict) else None
            if not sess_rows and not title:
                continue
            first_user = None
            started_at = None
            ended_at = None
            if sess_rows:
                started_at = sess_rows[0].get('created_at')
                ended_at = sess_rows[-1].get('created_at')
                for r in sess_rows:
                    if r.get('type') == 'user':
                        c = r.get('content')
                        if isinstance(c, dict):
                            first_user = c.get('content')
                        elif isinstance(c, str):
                            try:
                                import json as _json
                                first_user = (_json.loads(c) or {}).get('content')
                            except Exception:
                                first_user = None
                        if first_user:
                            break
            if not title and first_user:
                title = (first_user or '')[:30]
            sessions.append({
                'index': idx,
                'title': title or f'Session {idx}',
                'started_at': started_at,
                'ended_at': ended_at,
                'preview': (first_user or '')[:80]
            })
        return {"current_session_index": current, "sessions": sessions}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error listing sessions for thread {thread_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to list sessions: {str(e)}")


@router.delete("/threads/{thread_id}/sessions/{session_index}")
async def delete_session(
    thread_id: str,
    session_index: int,
    user_id: str = Depends(verify_and_get_user_id_from_jwt),
):
    client = await utils.db.client
    await verify_and_authorize_thread_access(client, thread_id, user_id)
    try:
        target = int(session_index)
        if target < 0:
            raise HTTPException(status_code=400, detail="session_index must be >= 0")

        t = await client.table('threads').select('metadata').eq('thread_id', thread_id).limit(1).execute()
        tmeta = (t.data[0].get('metadata') if t.data else {}) or {}
        if isinstance(tmeta, str):
            try:
                import json as _json
                tmeta = _json.loads(tmeta)
            except Exception:
                tmeta = {}

        current = int(tmeta.get('current_session_index', 0) or 0)
        titles = tmeta.get('session_titles') or {}
        deleted = tmeta.get('deleted_sessions') or []
        deleted_set = set()
        if isinstance(deleted, list):
            for val in deleted:
                try:
                    deleted_set.add(int(val))
                except Exception:
                    continue

        await client.table('messages') \
            .delete() \
            .eq('thread_id', thread_id) \
            .filter('metadata->>session_index', 'eq', str(target)) \
            .execute()

        if isinstance(titles, dict):
            titles.pop(str(target), None)
        deleted_set.add(target)

        remaining_indices = set()
        try:
            res_all = await client.table('messages').select('metadata, created_at').eq('thread_id', thread_id).order('created_at', desc=True).limit(5000).execute()
            rows = res_all.data or []
            for row in rows:
                md = row.get('metadata') or {}
                if isinstance(md, str):
                    try:
                        import json as _json
                        md = _json.loads(md)
                    except Exception:
                        md = {}
                sv = md.get('session_index')
                if sv is None:
                    sv = 0
                try:
                    sv = int(sv)
                except Exception:
                    sv = 0
                if sv in deleted_set:
                    continue
                remaining_indices.add(sv)
        except Exception:
            pass

        new_current = current
        if target == current:
            if remaining_indices:
                new_current = max(remaining_indices)
            else:
                new_current = 0
                deleted_set = set()

        deleted_set.discard(new_current)
        new_meta = {
            **tmeta,
            'current_session_index': new_current,
            'session_titles': titles,
            'deleted_sessions': sorted(list(deleted_set)),
        }
        await client.table('threads').update({'metadata': new_meta}).eq('thread_id', thread_id).execute()

        return {
            "current_session_index": new_current,
            "deleted_session_index": target,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting session {thread_id}#{session_index}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete session: {str(e)}")
