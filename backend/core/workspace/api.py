from __future__ import annotations

from typing import Any, Dict, Optional
from fastapi import APIRouter, Depends, Header, Request, WebSocket, WebSocketDisconnect, Query, HTTPException
from fastapi.responses import JSONResponse, Response
import asyncio
import orjson

from core.utils.logger import logger
from core.services import redis as redis_service
from core.utils.auth_utils import resolve_user_and_workspace, ensure_workspace_membership, WORKSPACE_HEADER, _decode_jwt_safely
from .service import get_workspace_cached, get_workspace_meta_cached, bump_workspace_version_and_broadcast, WORKSPACE_UPDATES_CHANNEL, _get_version

router = APIRouter(prefix="/workspace", tags=["workspace"])


@router.get("")
async def get_workspace(
    request: Request,
    if_none_match: Optional[str] = Header(default=None, alias="If-None-Match"),
) -> Response:
    """
    Aggregated workspace data with ETag/304 and Redis-backed cache.
    Does not include expandedIds; expansion is client-local.
    """
    _, workspace_id = await resolve_user_and_workspace(request)

    payload = await get_workspace_cached(workspace_id)
    version = payload.get('version') or await _get_version(workspace_id)
    etag = f'W/"v{version}"'

    # Conditional GET handling
    if if_none_match and if_none_match.strip() == etag:
        return Response(status_code=304, headers={ 'ETag': etag })

    return JSONResponse(content=payload, headers={ 'ETag': etag, 'Cache-Control': 'no-cache' })


@router.get("/meta")
async def get_workspace_meta(
    request: Request,
    if_none_match: Optional[str] = Header(default=None, alias="If-None-Match"),
) -> Response:
    """
    Lightweight workspace data with ETag/304 and Redis-backed cache.
    """
    _, workspace_id = await resolve_user_and_workspace(request)

    payload = await get_workspace_meta_cached(workspace_id)
    version = payload.get('version') or await _get_version(workspace_id)
    etag = f'W/"v{version}"'

    if if_none_match and if_none_match.strip() == etag:
        return Response(status_code=304, headers={ 'ETag': etag })

    return JSONResponse(content=payload, headers={ 'ETag': etag, 'Cache-Control': 'no-cache' })


@router.websocket("/ws")
async def workspace_ws(
    websocket: WebSocket,
    token: Optional[str] = Query(default=None),
    workspace_id: Optional[str] = Query(default=None, alias="workspaceId")
):
    """
    WebSocket channel for workspace update notifications.
    Sends messages like: { type: 'workspace_updated', version: number }
    """
    # Simple auth via token param using same verifier as HTTP
    try:
        # Decode JWT from token param (SSE/WS friendly)
        if not token:
            raise RuntimeError('Missing token')
        payload = _decode_jwt_safely(token)
        user_id = payload.get('sub')
        if not user_id:
            raise RuntimeError('Invalid token payload')
    except Exception as e:
        logger.error(f"WS auth failed: {e}")
        await websocket.close(code=4401)
        return

    # Determine workspace (defaults to personal)
    workspace = (workspace_id or user_id).strip()
    try:
        await ensure_workspace_membership(user_id, workspace)
    except HTTPException as exc:
        await websocket.close(code=4403, reason=exc.detail)
        return

    await websocket.accept()
    logger.info(f"WS connected user={user_id} workspace={workspace}")

    # Subscribe to Redis pub/sub for this user
    channel_name = WORKSPACE_UPDATES_CHANNEL.format(workspace_id=workspace)
    pubsub = await redis_service.create_pubsub()
    await pubsub.subscribe(channel_name)

    stop_event = asyncio.Event()

    async def _recv_loop() -> None:
        """
        Background receive loop to detect client disconnects.

        The workspace WS is server-push only, but Starlette only surfaces
        WebSocketDisconnect when we call a receive/send method. Without this
        loop, idle connections might never notice the client has gone away,
        leaking Redis pubsub connections.
        """
        try:
            while not stop_event.is_set():
                # We don't care about incoming messages; just block until disconnect.
                await websocket.receive_text()
        except WebSocketDisconnect:
            logger.info(f"WS disconnect detected (recv loop) user={user_id} workspace={workspace}")
        except Exception as e:
            logger.warning(f"WS recv loop error user={user_id} workspace={workspace}: {e}")
        finally:
            stop_event.set()

    recv_task = asyncio.create_task(_recv_loop())

    try:
        while not stop_event.is_set():
            message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=5.0)
            if message and message.get('type') == 'message':
                data = message.get('data')
                try:
                    # data already json string
                    await websocket.send_text(data)
                except Exception as e:
                    logger.warning(f"WS send failed user={user_id}: {e}")
            # Keep alive ping
            await asyncio.sleep(0.1)
    except WebSocketDisconnect:
        logger.info(f"WS disconnected for user={user_id}")
    finally:
        stop_event.set()
        try:
            recv_task.cancel()
            try:
                await recv_task
            except asyncio.CancelledError:
                pass
            except Exception as e:
                logger.warning(f"WS recv_task cleanup error user={user_id} workspace={workspace}: {e}")
        except Exception:
            pass
        try:
            await pubsub.unsubscribe(channel_name)
            await pubsub.close()
        except Exception:
            pass
