import asyncio
from fastapi import APIRouter, HTTPException, Request, Query
from fastapi.responses import RedirectResponse, StreamingResponse
from typing import Optional
from core.utils.auth_utils import get_user_id_from_stream_auth
from core.services.supabase import DBConnection
from core.services.r2_storage import create_presigned_get_url, get_object_bytes, get_r2_bucket
from core.utils.logger import logger
from core.utils.errors import raise_file_removed
from urllib.parse import urlparse, unquote

router = APIRouter(prefix="/media", tags=["media"])


def _extract_storage_path_from_url(url: Optional[str]) -> Optional[str]:
    if not isinstance(url, str) or not url:
        return None
    try:
        parsed = urlparse(url)
    except Exception:
        return None
    path = parsed.path or ""
    marker = "/media/file-uploads/"
    idx = path.find(marker)
    if idx != -1:
        candidate = path[idx + len(marker):]
        if candidate:
            return unquote(candidate.lstrip("/"))
    parts = path.split("/")
    if "object" in parts and len(parts) >= parts.index("object") + 4:
        bucket = parts[parts.index("object") + 2]
        if bucket == "file-uploads":
            obj = "/".join(parts[parts.index("object") + 3:])
            if obj:
                return unquote(obj)
    bucket = None
    try:
        bucket = get_r2_bucket()
    except Exception:
        bucket = None
    if bucket:
        prefix = f"/{bucket}/"
        if path.startswith(prefix):
            obj = path[len(prefix):]
            if obj:
                return unquote(obj)
        host = parsed.hostname or ""
        if host.startswith(f"{bucket}."):
            obj = path.lstrip("/")
            if obj:
                return unquote(obj)
    return None


async def _get_file_record(client, full_path: str) -> Optional[dict]:
    try:
        fres = await client.table('file_uploads') \
            .select('id, account_id, storage_provider, storage_bucket, storage_path, original_filename, content_type') \
            .eq('storage_path', full_path) \
            .limit(1) \
            .execute()
        if fres.data:
            return fres.data[0]
    except Exception as e:
        logger.warning(f"[media proxy] file_uploads lookup failed: {e}")
    return None


async def _is_account_member(client, user_id: str, account_id: str) -> bool:
    if account_id == user_id:
        return True
    try:
        am = await client.schema('basejump').table('account_user') \
            .select('account_role') \
            .eq('user_id', user_id) \
            .eq('account_id', account_id) \
            .limit(1) \
            .execute()
        return bool(am.data)
    except Exception as e:
        logger.warning(f"[media proxy] account membership check failed: {e}")
        return False


async def _file_linked_to_thread(client, file_id: str, thread_id: str) -> bool:
    try:
        links_resp = await client.table('file_links') \
            .select('entity_id') \
            .eq('file_id', file_id) \
            .eq('entity_type', 'message') \
            .execute()
        message_ids = [row.get('entity_id') for row in (links_resp.data or []) if row.get('entity_id')]
        if not message_ids:
            return False
        # Chunk to avoid oversized IN filters
        chunk_size = 100
        for idx in range(0, len(message_ids), chunk_size):
            chunk = message_ids[idx:idx + chunk_size]
            mres = await client.table('messages') \
                .select('message_id') \
                .eq('thread_id', thread_id) \
                .in_('message_id', chunk) \
                .limit(1) \
                .execute()
            if mres.data:
                return True
    except Exception as e:
        logger.warning(f"[media proxy] thread link check failed: {e}")
    return False


async def _file_linked_to_doc(client, file_id: str, doc_item_id: str) -> bool:
    try:
        links_resp = (
            await client.table("file_links")
            .select("entity_id")
            .eq("file_id", file_id)
            .eq("entity_type", "doc")
            .eq("entity_id", doc_item_id)
            .limit(1)
            .execute()
        )
        return bool(links_resp.data)
    except Exception as e:
        logger.warning(f"[media proxy] doc link check failed: {e}")
    return False


@router.get("/file-uploads/{path:path}")
async def proxy_file_uploads(
    path: str,
    request: Request,
    download: Optional[str] = Query(default=None),
    ttl: int = Query(default=600, ge=60, le=604800),  # 1min ~ 7days
    token: Optional[str] = Query(default=None),
    canvas_id: Optional[str] = Query(default=None),
    thread_id: Optional[str] = Query(default=None),
    doc_item_id: Optional[str] = Query(default=None),
    sig: Optional[str] = Query(default=None),
    ts: Optional[int] = Query(default=None),
):
    """
    Stable media URL endpoint.
    - Validates ownership of the storage path
    - Issues a short-lived signed URL and 307-redirects to it, or streams the file as fallback
    """
    # Accept auth via Authorization header or explicit token query param
    user_id: Optional[str] = None
    try:
        user_id = await get_user_id_from_stream_auth(request, token)
    except HTTPException as e:
        # Allow anonymous path for public canvases; continue without user
        if e.status_code != 401:
            raise

    # Signature-based auth bypass for presentation image embedding
    allowed = False
    full_path = path

    client = await DBConnection().client
    file_record = await _get_file_record(client, full_path)
    file_account_id = (file_record or {}).get('account_id')
    file_id = (file_record or {}).get('id')

    if not allowed and sig and ts and canvas_id:
        from core.media.signature_utils import verify_media_signature
        if verify_media_signature(full_path, canvas_id, sig, ts, ttl):
            allowed = True

    if not allowed and sig and ts and doc_item_id and file_id:
        from core.media.signature_utils import verify_doc_media_signature

        if verify_doc_media_signature(full_path, doc_item_id, sig, ts, ttl):
            if await _file_linked_to_doc(client, str(file_id), doc_item_id):
                allowed = True

    def _path_matches_account(account_id: Optional[str]) -> bool:
        return bool(account_id and full_path.startswith(f"{account_id}/"))

    # 1) Public canvas reference
    if not allowed and canvas_id:
        # Anonymous viewer: allow when the canvas is public and references this storage path
        try:
            cres = await client.table('canvases').select('id,account_id,is_public,doc').eq('id', canvas_id).limit(1).execute()
            row = cres.data[0] if cres.data else None
            if row:
                is_public = bool(row.get('is_public'))
                account_id = row.get('account_id')
                allow_by_scope = is_public
                # Allow private canvas for workspace members
                if not allow_by_scope and user_id and account_id:
                    allow_by_scope = await _is_account_member(client, user_id, account_id)
                if allow_by_scope:
                    account_matches = (
                        (file_account_id and account_id and str(file_account_id) == str(account_id))
                        or _path_matches_account(account_id)
                    )
                    if not account_matches:
                        allow_by_scope = False
                    doc = row.get('doc') or {}
                    nodes = doc.get('nodes') or []
                    # Helper: derive storage path from legacy fileUrl
                    def _path_from_fileurl(u: Optional[str]) -> Optional[str]:
                        return _extract_storage_path_from_url(u)
                    ref_match = False
                    for n in nodes:
                        if not isinstance(n, dict):
                            continue
                        if n.get('type') != 'media':
                            continue
                        sp = n.get('storagePath') or _path_from_fileurl(n.get('fileUrl'))
                        if isinstance(sp, str) and sp == full_path:
                            ref_match = True
                            break
                    if ref_match and allow_by_scope:
                        allowed = True
                    elif user_id and account_id and allow_by_scope:
                        # Authenticated members can access account-owned files even if doc lacks link
                        allowed = True
        except Exception as e:
            logger.warning(f"[media proxy] public canvas reference check failed: {e}")

    # 2) Public thread reference
    if not allowed and thread_id:
        try:
            tres = await client.table('threads').select('thread_id,account_id,is_public').eq('thread_id', thread_id).limit(1).execute()
            trow = tres.data[0] if tres.data else None
            if trow:
                is_public = bool(trow.get('is_public'))
                account_id = trow.get('account_id')
                allow_by_scope = is_public
                if not allow_by_scope and user_id and account_id:
                    allow_by_scope = await _is_account_member(client, user_id, account_id)
                if allow_by_scope:
                    account_matches = (
                        (file_account_id and account_id and str(file_account_id) == str(account_id))
                        or _path_matches_account(account_id)
                    )
                    if not account_matches:
                        allow_by_scope = False
                    linked_to_thread = False
                    if file_id:
                        linked_to_thread = await _file_linked_to_thread(client, str(file_id), thread_id)
                    if not linked_to_thread:
                        # Fallback for legacy messages that embed the path
                        from urllib.parse import quote
                        enc = quote(full_path, safe='')
                        ref1 = full_path
                        ref2 = f"/media/file-uploads/{enc}"
                        mres = await client.table('messages').select('message_id').eq('thread_id', thread_id).or_(f"content.ilike.%{ref1}%,content.ilike.%{ref2}%").limit(1).execute()
                        linked_to_thread = bool(mres.data)
                    if linked_to_thread and allow_by_scope:
                        allowed = True
                    elif user_id and account_id and allow_by_scope:
                        allowed = True
        except Exception as e:
            logger.warning(f"[media proxy] public thread reference check failed: {e}")

    # 3) User-scoped ownership checks (only if user context exists)
    if not allowed and user_id:
        if file_account_id and await _is_account_member(client, user_id, str(file_account_id)):
            allowed = True
        elif full_path.startswith(f"{user_id}/canvas-media/"):
            allowed = True
        elif full_path.startswith("knowledge-base/"):
            try:
                res = await client.table('knowledge_base_entries') \
                    .select('entry_id, account_id') \
                    .eq('file_path', full_path) \
                    .limit(1) \
                    .execute()
                if res.data:
                    kb_account_id = res.data[0].get('account_id')
                    if kb_account_id and await _is_account_member(client, user_id, str(kb_account_id)):
                        allowed = True
            except Exception as e:
                logger.error(f"[media proxy] KB ownership check failed: {e}")
                raise HTTPException(status_code=500, detail="Failed to validate ownership")

    if not allowed:
        raise HTTPException(status_code=403, detail="Not authorized to access this file")

    provider = (file_record or {}).get('storage_provider') or 'supabase'
    content_type = (file_record or {}).get('content_type') or 'application/octet-stream'
    filename = download or (file_record or {}).get('original_filename')

    if provider == 'r2':
        try:
            signed_url = create_presigned_get_url(
                key=full_path,
                expires_in=ttl,
                download_filename=filename if download else None,
            )
            return RedirectResponse(
                url=signed_url,
                status_code=307,
                headers={
                    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
                    "Pragma": "no-cache",
                    "Expires": "0",
                    "Referrer-Policy": "no-referrer",
                },
            )
        except Exception as e:
            logger.warning(f"[media proxy] r2 signed url failed, will attempt streaming: {e}")

        try:
            data = await asyncio.to_thread(get_object_bytes, full_path)
            if not data:
                raise RuntimeError('Empty R2 response')
            headers = {"Referrer-Policy": "no-referrer"}
            if download:
                headers['Content-Disposition'] = f'attachment; filename="{download}"'
            return StreamingResponse(iter([data]), media_type=content_type, headers=headers)
        except Exception as e:
            logger.error(f"[media proxy] r2 streaming fallback failed: {e}")
            raise HTTPException(status_code=500, detail="Failed to fetch file")

    raise_file_removed("FILE_REMOVED")

