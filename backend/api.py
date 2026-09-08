from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, Request, HTTPException, Depends, APIRouter
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from core.services import redis
import sentry

# Initialize observability services
from core.services import langsmith  # noqa: F401 - Import to initialize LangSmith tracing
from contextlib import asynccontextmanager
from core.services.supabase import DBConnection
from datetime import datetime, timezone
from core.utils.config import config, EnvMode
import asyncio
from core.utils.logger import logger, structlog
import time
from collections import OrderedDict
import os
import re
from urllib.parse import parse_qsl, unquote_plus, urlencode

from pydantic import BaseModel
import uuid

from core import api as core_api
from core import projects_api  # projects / me-roles / public-canvases：前端去 supabase-js 直连后新增

# Removed sandbox API import as part of Daytona removal
from core.billing.api import router as billing_router
from core.billing.admin import router as billing_admin_router
from core.admin.users_admin import router as users_admin_router
from core.admin.audit_admin import router as audit_admin_router
from core.services import transcription as transcription_api
import sys
from core.services import email_api
# Idempotency middleware
from core.middleware.idempotency import IdempotencyMiddleware
from core.triggers import api as triggers_api

# Import API modules needed in lifespan function
from core.mcp_module import api as mcp_api
from core.agent_reaper import run_agent_reaper
from core.assets import api as assets_api
from core.credentials import api as credentials_api
from core.pipedream import api as pipedream_api
from core.composio_integration import api as composio_api
from core.automation import api as automation_api
from core.langgraph_engine.tools.catalog import build_registry
from core.services.dramatiq_broker import configure_dramatiq


if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

db = DBConnection()
instance_id = os.getenv("INSTANCE_ID") or str(uuid.uuid4())[:8]

# Rate limiter state
ip_tracker = OrderedDict()
MAX_CONCURRENT_IPS = 25

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.debug(f"Starting up FastAPI application with instance ID: {instance_id} in {config.ENV_MODE.value} mode")
    reaper_task = None
    try:
        await db.initialize()
        
        core_api.initialize(
            db,
            instance_id
        )
        
        
        # Removed sandbox API initialization as part of Daytona removal
        
        # Initialize Redis connection
        from core.services import redis
        try:
            await redis.initialize_async()
            logger.debug("Redis connection initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize Redis connection: {e}")
            # Continue without Redis - the application will handle Redis failures gracefully

        try:
            configure_dramatiq()
            logger.debug("Dramatiq broker configured")
        except Exception as e:
            logger.error(f"Failed to configure Dramatiq broker: {e}")
        
        # Start background tasks
        # asyncio.create_task(core_api.restore_running_agent_runs())
        reaper_task = asyncio.create_task(run_agent_reaper(db))
        
        triggers_api.initialize(db)
        pipedream_api.initialize(db)
        credentials_api.initialize(db)
        composio_api.initialize(db)
        automation_api.initialize(db)
        
        yield
        
        logger.debug("Cleaning up agent resources")
        if reaper_task:
            reaper_task.cancel()
            try:
                await reaper_task
            except asyncio.CancelledError:
                pass
        await core_api.cleanup()
        
        try:
            logger.debug("Closing Redis connection")
            await redis.close()
            logger.debug("Redis connection closed successfully")
        except Exception as e:
            logger.error(f"Error closing Redis connection: {e}")

        logger.debug("Disconnecting from database")
        await db.disconnect()
    except Exception as e:
        logger.error(f"Error during application startup: {e}")
        raise

app = FastAPI(lifespan=lifespan)


_CANVAS_SINGLE_SEGMENT_RESERVED = {
    "meta",
    "trash",
    "share",
    "purge",
    "restore-batch",
    "purge-by-ids",
    "versions",
}


def _normalize_canvas_path(path: str) -> str:
    normalized = path or ""
    if normalized.startswith("/api/"):
        normalized = normalized[4:]
    return normalized


def _resolve_canvas_metric_name(method: str, path: str) -> str | None:
    normalized = _normalize_canvas_path(path)
    parts = [segment for segment in normalized.split("/") if segment]
    if not parts or parts[0] != "canvases":
        return None

    if method == "GET" and len(parts) == 2 and parts[1] not in _CANVAS_SINGLE_SEGMENT_RESERVED:
        return "openCanvas"
    if method == "POST" and len(parts) == 3 and parts[2] == "apply":
        return "applyOps"
    if method == "PUT" and len(parts) == 2 and parts[1] not in _CANVAS_SINGLE_SEGMENT_RESERVED:
        return "importSnapshot"
    if method == "GET" and len(parts) == 3 and parts[2] == "snapshot":
        return "getSnapshot"

    return None


_REDACTED_QUERY_VALUE = "[REDACTED]"
_SENSITIVE_QUERY_KEY_TOKENS = (
    "token",
    "auth",
    "authorization",
    "jwt",
    "apikey",
    "api_key",
    "accesskey",
    "access_key",
    "refresh",
    "signature",
    "sig",
    "session",
    "secret",
)


def _is_sensitive_query_key(key: str) -> bool:
    normalized = re.sub(r"[^a-z0-9]", "", str(key or "").lower())
    if not normalized:
        return False
    return any(token in normalized for token in _SENSITIVE_QUERY_KEY_TOKENS)


def _sanitize_query_string(raw_query: str) -> str:
    query = str(raw_query or "")
    if not query:
        return ""

    try:
        pairs = parse_qsl(query, keep_blank_values=True, strict_parsing=False)
        if pairs:
            sanitized_pairs = [
                (key, _REDACTED_QUERY_VALUE if _is_sensitive_query_key(key) else value)
                for key, value in pairs
            ]
            return urlencode(sanitized_pairs, doseq=True)
    except Exception:
        pass

    # Fallback parser for malformed query strings.
    sanitized_chunks: list[str] = []
    for chunk in query.split("&"):
        key_part, sep, _ = chunk.partition("=")
        decoded_key = unquote_plus(key_part)
        if _is_sensitive_query_key(decoded_key):
            if sep:
                sanitized_chunks.append(f"{key_part}={_REDACTED_QUERY_VALUE}")
            else:
                sanitized_chunks.append(f"{key_part}={_REDACTED_QUERY_VALUE}")
        else:
            sanitized_chunks.append(chunk)
    return "&".join(sanitized_chunks)

@app.middleware("http")
async def log_requests_middleware(request: Request, call_next):
    structlog.contextvars.clear_contextvars()

    request_id = str(uuid.uuid4())
    start_time = time.time()
    client_ip = request.client.host if request.client else "unknown"
    method = request.method
    path = request.url.path
    query_params = _sanitize_query_string(str(request.query_params))
    client_request_id = request.headers.get("x-client-request-id") or request.headers.get("idempotency-key")
    client_session_id = request.headers.get("x-client-session-id") or request.headers.get("x-canvas-session-id")
    workspace_id = request.headers.get("x-workspace-id")
    if_match = request.headers.get("if-match")

    structlog.contextvars.bind_contextvars(
        request_id=request_id,
        client_ip=client_ip,
        method=method,
        path=path,
        query_params=query_params
    )

    # Log the incoming request
    logger.debug(f"Request started: {method} {path} from {client_ip} | Query: {query_params}")
    
    try:
        response = await call_next(request)
        process_time = time.time() - start_time
        logger.debug(f"Request completed: {method} {path} | Status: {response.status_code} | Time: {process_time:.2f}s")
        metric_name = _resolve_canvas_metric_name(method, path)
        if metric_name:
            status = int(response.status_code)
            logger.info(
                "canvas_http_metric",
                metric_name=metric_name,
                method=method,
                path=path,
                status_code=status,
                success=status < 400,
                conflict=status == 409,
                latency_ms=int(process_time * 1000),
                client_request_id=client_request_id,
                client_session_id=client_session_id,
                workspace_id=workspace_id,
                if_match=if_match,
            )
        return response
    except Exception as e:
        process_time = time.time() - start_time
        logger.error(f"Request failed: {method} {path} | Error: {str(e)} | Time: {process_time:.2f}s")
        metric_name = _resolve_canvas_metric_name(method, path)
        if metric_name:
            logger.info(
                "canvas_http_metric",
                metric_name=metric_name,
                method=method,
                path=path,
                status_code=500,
                success=False,
                conflict=False,
                latency_ms=int(process_time * 1000),
                client_request_id=client_request_id,
                client_session_id=client_session_id,
                workspace_id=workspace_id,
                if_match=if_match,
            )
        raise

"""CORS configuration.
In LOCAL/STAGING we allow common dev origins explicitly and via regex.
In PRODUCTION we restrict to public domains, but allow extra origins/regex via env.
"""
allowed_origins = []
allow_origin_regex = None

# Always-available local origins toggle (default on for developer convenience)
COMMON_LOCAL_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://0.0.0.0:3000",
]
ALLOW_LOCAL_ORIGINS = os.getenv("ALLOW_LOCAL_ORIGINS", "true").lower() in ("1", "true", "yes")

if config.ENV_MODE == EnvMode.LOCAL:
    # Common local dev origins + regex for other ports
    allowed_origins += COMMON_LOCAL_ORIGINS
    allow_origin_regex = r"^http://(localhost|127\.0\.0\.1)(:\d+)?$"

if config.ENV_MODE == EnvMode.STAGING:
    allowed_origins += [
        "https://staging.zmind.so",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]
    allow_origin_regex = r"https://zmind-.*-vercel\.app"

# Production: allow official Zmind domains
if config.ENV_MODE == EnvMode.PRODUCTION:
    allowed_origins += [
        "https://zmind.so",
        "https://www.zmind.so",
    ]
    # Allow any subdomain of our primary domain (e.g., app.zmind.so)
    if allow_origin_regex is None and getattr(config, "PRIMARY_DOMAIN", None):
        primary_domain = re.escape(str(config.PRIMARY_DOMAIN).strip())
        if primary_domain:
            allow_origin_regex = rf"^https://([a-z0-9-]+\.)*{primary_domain}$"
    if ALLOW_LOCAL_ORIGINS:
        for origin in COMMON_LOCAL_ORIGINS:
            if origin not in allowed_origins:
                allowed_origins.append(origin)

# Allow adding extra origins/regex via environment variables for all modes
# Useful for custom domains (e.g., Vercel frontends) in production
extra_origins = os.getenv("CORS_EXTRA_ORIGINS", "")
if extra_origins:
    for origin in [o.strip() for o in extra_origins.split(",") if o.strip()]:
        if origin not in allowed_origins:
            allowed_origins.append(origin)

regex_from_env = os.getenv("CORS_ALLOW_ORIGIN_REGEX", "")
if regex_from_env:
    allow_origin_regex = regex_from_env

# If FRONTEND_URL is set, allow it explicitly
frontend_url = os.getenv("FRONTEND_URL", "").strip()
if frontend_url.startswith("http") and frontend_url not in allowed_origins:
    allowed_origins.append(frontend_url)

# Always allow local origins when enabled, even if env mode is misconfigured.
if ALLOW_LOCAL_ORIGINS:
    for origin in COMMON_LOCAL_ORIGINS:
        if origin not in allowed_origins:
            allowed_origins.append(origin)
    local_regex = r"^http://(localhost|127\.0\.0\.1)(:\d+)?$"
    if allow_origin_regex:
        if local_regex not in allow_origin_regex:
            allow_origin_regex = f"{allow_origin_regex}|{local_regex}"
    else:
        allow_origin_regex = local_regex

# 🔍 调试CORS配置 - 记录实际生效的配置
logger.info(f"🔍 CORS Debug - ENV_MODE: {config.ENV_MODE}")
logger.info(f"🔍 CORS Debug - allowed_origins: {allowed_origins}")
logger.info(f"🔍 CORS Debug - allow_origin_regex: {allow_origin_regex}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=allow_origin_regex,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[
        "Content-Type",
        "Authorization",
        "X-Project-Id",
        "X-MCP-URL",
        "X-MCP-Type",
        "X-MCP-Headers",
        "X-Refresh-Token",
        "If-Match",
        "X-Workspace-Id",
        "X-Client-Request-Id",
    ],
)

# Idempotency cache (guard duplicate writes). Configurable via env.
try:
    idemp_ttl = int(os.getenv("IDEMPOTENCY_TTL_SEC", "3600"))
    idemp_lock_ttl = int(os.getenv("IDEMPOTENCY_LOCK_TTL_SEC", "30"))
    idemp_max_body = int(os.getenv("IDEMPOTENCY_MAX_BODY_BYTES", str(64 * 1024)))
except Exception:
    idemp_ttl = 3600
    idemp_lock_ttl = 30
    idemp_max_body = 64 * 1024

app.add_middleware(
    IdempotencyMiddleware,
    ttl_seconds=idemp_ttl,
    lock_ttl_seconds=idemp_lock_ttl,
    max_body_bytes=idemp_max_body,
)

# Create a main API router
api_router = APIRouter()

# Include all API routers without individual prefixes
api_router.include_router(core_api.router)
api_router.include_router(projects_api.router)
# Removed sandbox API router as part of Daytona removal
api_router.include_router(billing_router)
api_router.include_router(billing_admin_router)
api_router.include_router(users_admin_router)
api_router.include_router(audit_admin_router)

api_router.include_router(mcp_api.router)
api_router.include_router(credentials_api.router, prefix="/secure-mcp")

api_router.include_router(transcription_api.router)
api_router.include_router(email_api.router)

# Use new knowledge base API (user-level KB with folders/entries)
from knowledge_base import api as knowledge_base_api
api_router.include_router(knowledge_base_api.router)
api_router.include_router(assets_api.router)

api_router.include_router(triggers_api.router)

api_router.include_router(pipedream_api.router)

from core.admin import api as admin_api
api_router.include_router(admin_api.router)

api_router.include_router(composio_api.router)
api_router.include_router(automation_api.router)

from core.google.google_slides_api import router as google_slides_router
api_router.include_router(google_slides_router)

# Folders API
try:
    from core.folders import api as folders_api
    api_router.include_router(folders_api.router)
    logger.debug("Folders API router registered")
except Exception as e:
    logger.error(f"Failed to register Folders API router: {e}")

from core.google.google_docs_api import router as google_docs_router
api_router.include_router(google_docs_router)

@api_router.get("/health")
async def health_check():
    logger.debug("Health check endpoint called")
    return {
        "status": "ok", 
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "instance_id": instance_id
    }

@api_router.get("/health-docker")
async def health_check():
    logger.debug("Health docker check endpoint called")
    try:
        client = await redis.get_client()
        await client.ping()
        db = DBConnection()
        await db.initialize()
        db_client = await db.client
        await db_client.table("threads").select("thread_id").limit(1).execute()
        logger.debug("Health docker check complete")
        return {
            "status": "ok", 
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "instance_id": instance_id
        }
    except Exception as e:
        logger.error(f"Failed health docker check: {e}")
        raise HTTPException(status_code=500, detail="Health check failed")


app.include_router(api_router, prefix="/api")


# Debug: list registered tool names as seen after a fresh registration cycle
@app.get("/api/debug/tools")
async def list_registered_tools():
    try:
        # Only allow in non-production
        if config.ENV_MODE == EnvMode.PRODUCTION:
            raise HTTPException(status_code=403, detail="Not available in production")

        registry = build_registry()
        tool_list = []
        for tool in registry.list_tools():
            handler = tool.handler
            handler_ref = f"{getattr(handler, '__module__', 'unknown')}.{getattr(handler, '__name__', 'unknown')}"
            tool_list.append({"name": tool.name, "handler": handler_ref})

        return JSONResponse({
            "count": len(tool_list),
            "kb": [t["name"] for t in tool_list if isinstance(t.get("name"), str) and t["name"].startswith("kb_")],
            "tools": tool_list,
        })
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"/api/debug/tools failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to collect tool registry state")


if __name__ == "__main__":
    import uvicorn
    
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    
    # Use single worker to avoid Redis connection issues in multi-process setup
    workers = 1

    port = int(os.getenv("PORT", 8013))
    logger.debug(f"Starting server on 0.0.0.0:{port} with {workers} worker")
    uvicorn.run(
        "api:app",
        host="0.0.0.0",
        port=port,
        workers=workers,
        loop="asyncio"
    )
