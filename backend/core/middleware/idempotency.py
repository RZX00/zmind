from __future__ import annotations

import base64
import json
from typing import Optional, Dict, Any

from fastapi import Request
from fastapi.responses import JSONResponse, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import StreamingResponse

from core.services import redis
from core.utils.idempotency import get_idempotency_key
from core.utils.logger import logger


_WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
_HOP_BY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
}


def _build_cache_key(request: Request, idempotency_key: str) -> str:
    method = (request.method or "POST").upper()
    path = request.url.path or "/"
    return f"idem:{method}:{path}:{idempotency_key}"


def _filter_headers(headers: Dict[str, str]) -> Dict[str, str]:
    filtered: Dict[str, str] = {}
    for key, value in headers.items():
        if key.lower() in _HOP_BY_HOP_HEADERS:
            continue
        filtered[key] = value
    return filtered


class IdempotencyMiddleware(BaseHTTPMiddleware):
    def __init__(
        self,
        app,
        *,
        ttl_seconds: int = 3600,
        lock_ttl_seconds: int = 30,
        max_body_bytes: int = 64 * 1024,
    ) -> None:
        super().__init__(app)
        self._ttl_seconds = ttl_seconds
        self._lock_ttl_seconds = lock_ttl_seconds
        self._max_body_bytes = max_body_bytes

    async def dispatch(self, request: Request, call_next):
        if request.method.upper() not in _WRITE_METHODS:
            return await call_next(request)

        idempotency_key = get_idempotency_key(request)
        if not idempotency_key:
            return await call_next(request)

        request.state.idempotency_key = idempotency_key
        cache_key = _build_cache_key(request, idempotency_key)
        try:
            cached = await redis.get(cache_key)
            if cached:
                cached_payload = self._decode_cache(cached)
                if cached_payload:
                    return self._build_cached_response(cached_payload)
        except Exception as exc:
            logger.warning(
                "idempotency.cache_read_failed",
                cache_key=cache_key,
                error=str(exc),
            )

        lock_key = f"{cache_key}:lock"
        lock_acquired = False
        lock_failed = False
        try:
            lock_acquired = bool(
                await redis.set(lock_key, "1", ex=self._lock_ttl_seconds, nx=True)
            )
        except Exception as exc:
            lock_failed = True
            logger.warning(
                "idempotency.lock_failed",
                cache_key=cache_key,
                error=str(exc),
            )

        if not lock_acquired and not lock_failed:
            return JSONResponse(
                status_code=409,
                content={
                    "message": "Request already in progress for this idempotency key",
                    "retryable": True,
                },
            )
        if lock_failed:
            # Best-effort fallback: proceed without idempotency to avoid blocking writes.
            return await call_next(request)

        try:
            response = await call_next(request)
            response, body = await self._capture_response(response)
            if body is not None and 200 <= response.status_code < 300:
                await self._store_cache(cache_key, response, body)
            return response
        finally:
            try:
                await redis.delete(lock_key)
            except Exception as exc:
                logger.warning(
                    "idempotency.lock_release_failed",
                    cache_key=cache_key,
                    error=str(exc),
                )

    async def _capture_response(
        self, response: Response
    ) -> tuple[Response, Optional[bytes]]:
        if isinstance(response, StreamingResponse):
            body = b""
            too_large = False
            async for chunk in response.body_iterator:
                if chunk:
                    body += chunk
                    if len(body) > self._max_body_bytes:
                        too_large = True
                        break
            if too_large:
                return response, None
            new_response = Response(
                content=body,
                status_code=response.status_code,
                headers=dict(response.headers),
                media_type=response.media_type,
            )
            return new_response, body

        body = getattr(response, "body", None)
        if body is None:
            return response, None
        if isinstance(body, str):
            body = body.encode("utf-8")
        if len(body) > self._max_body_bytes:
            return response, None
        return response, body

    async def _store_cache(self, cache_key: str, response: Response, body: bytes) -> None:
        payload = {
            "status": response.status_code,
            "headers": _filter_headers(dict(response.headers)),
            "media_type": response.media_type,
            "body": base64.b64encode(body).decode("utf-8"),
        }
        try:
            await redis.set(cache_key, json.dumps(payload), ex=self._ttl_seconds)
        except Exception as exc:
            logger.warning(
                "idempotency.cache_write_failed",
                cache_key=cache_key,
                error=str(exc),
            )

    @staticmethod
    def _decode_cache(raw: str) -> Optional[Dict[str, Any]]:
        try:
            return json.loads(raw)
        except Exception:
            return None

    @staticmethod
    def _build_cached_response(payload: Dict[str, Any]) -> Response:
        status = int(payload.get("status") or 200)
        media_type = payload.get("media_type") or "application/json"
        headers = payload.get("headers") or {}
        body_b64 = payload.get("body") or ""
        try:
            body = base64.b64decode(body_b64.encode("utf-8"))
        except Exception:
            body = b""
        return Response(content=body, status_code=status, headers=headers, media_type=media_type)
