from __future__ import annotations

import asyncio
from time import perf_counter
from typing import Any, Awaitable, Callable, Dict, List, Optional
import orjson
from datetime import datetime, timezone

from core.services import metrics
from core.services.supabase import DBConnection
from core.services.cache_service import cache_service
from core.services import redis as redis_service
from core.utils.logger import logger
from core.utils.config import config
from core.utils.feature_flags import is_workspace_feature_enabled


WORKSPACE_AGG_KEY = "workspace:agg:{workspace_id}"
WORKSPACE_META_KEY = "workspace:agg_meta:{workspace_id}"
WORKSPACE_VER_KEY = "workspace:version:{workspace_id}"
WORKSPACE_UPDATES_CHANNEL = "workspace:updates:{workspace_id}"


_CACHE_SINGLEFLIGHT_LOCK = asyncio.Lock()
_CACHE_SINGLEFLIGHT: Dict[str, asyncio.Future] = {}


def _now_ms() -> int:
    return int(datetime.now(timezone.utc).timestamp() * 1000)


def _to_ms(v) -> int:
    if not v:
        return _now_ms()
    try:
        if isinstance(v, (int, float)):
            return int(v)
        s = str(v)
        if s.endswith('Z'):
            s = s.replace('Z', '+00:00')
        return int(datetime.fromisoformat(s).timestamp() * 1000)
    except Exception:
        return _now_ms()


def _is_relation_missing_error(exc: Exception) -> bool:
    text = str(exc).lower()
    return "does not exist" in text and "relation" in text


def _is_feature_enabled(
    *,
    workspace_id: str,
    global_attr: str,
    allowlist_attr: str,
) -> bool:
    return is_workspace_feature_enabled(
        enabled_globally=bool(getattr(config, global_attr, False)),
        workspace_id=workspace_id,
        allowlist=getattr(config, allowlist_attr, None),
    )


async def _load_items_meta(client, workspace_id: str) -> list[Dict[str, Any]]:
    if not _is_feature_enabled(
        workspace_id=workspace_id,
        global_attr="FEATURE_ITEM_MODEL_ON",
        allowlist_attr="FEATURE_ITEM_MODEL_WORKSPACES",
    ):
        return []
    try:
        result = (
            await client.table('items')
            .select('id,type,title,folder_id,parent_item_id,source_id,is_deleted,created_at,updated_at')
            .eq('account_id', workspace_id)
            .eq('is_deleted', False)
            .execute()
        )
    except Exception as exc:
        if _is_relation_missing_error(exc):
            return []
        raise
    rows = result.data or []
    return [
        {
            'id': row.get('id'),
            'type': row.get('type'),
            'title': row.get('title') or 'Untitled',
            'folderId': row.get('folder_id'),
            'parentItemId': row.get('parent_item_id'),
            'sourceId': row.get('source_id'),
            'isDeleted': bool(row.get('is_deleted', False)),
            'createdAt': _to_ms(row.get('created_at')),
            'updatedAt': _to_ms(row.get('updated_at')),
        }
        for row in rows
    ]


async def _load_docs_meta(client, workspace_id: str) -> list[Dict[str, Any]]:
    if not _is_feature_enabled(
        workspace_id=workspace_id,
        global_attr="FEATURE_DOCS_ON",
        allowlist_attr="FEATURE_DOCS_WORKSPACES",
    ):
        return []
    try:
        items_res = (
            await client.table('items')
            .select('id,title,updated_at')
            .eq('account_id', workspace_id)
            .eq('type', 'doc')
            .eq('is_deleted', False)
            .execute()
        )
    except Exception as exc:
        if _is_relation_missing_error(exc):
            return []
        raise
    item_rows = items_res.data or []
    if not item_rows:
        return []
    item_ids = [row.get('id') for row in item_rows if row.get('id')]
    try:
        docs_res = await client.table('docs').select('item_id,version,updated_at').in_('item_id', item_ids).execute()
    except Exception as exc:
        if _is_relation_missing_error(exc):
            docs_res = type("Obj", (), {"data": []})()
        else:
            raise
    docs_by_item = {row.get('item_id'): row for row in (docs_res.data or [])}
    out: list[Dict[str, Any]] = []
    for item in item_rows:
        item_id = item.get('id')
        if not item_id:
            continue
        doc_row = docs_by_item.get(item_id) or {}
        out.append(
            {
                'itemId': item_id,
                'title': item.get('title') or 'Untitled',
                'version': int(doc_row.get('version') or 1),
                'updatedAt': _to_ms(doc_row.get('updated_at') or item.get('updated_at')),
            }
        )
    return out


async def _load_refs_summary(client, workspace_id: str) -> Dict[str, Any]:
    if not _is_feature_enabled(
        workspace_id=workspace_id,
        global_attr="FEATURE_REFERENCES_ON",
        allowlist_attr="FEATURE_REFERENCES_WORKSPACES",
    ):
        return {'inboundCountByItem': {}, 'outboundCountByItem': {}}
    try:
        refs_res = (
            await client.table('references')
            .select('source_item_id,target_item_id')
            .eq('account_id', workspace_id)
            .eq('is_deleted', False)
            .execute()
        )
    except Exception as exc:
        if _is_relation_missing_error(exc):
            return {'inboundCountByItem': {}, 'outboundCountByItem': {}}
        raise
    inbound: Dict[str, int] = {}
    outbound: Dict[str, int] = {}
    for row in (refs_res.data or []):
        source_item_id = row.get('source_item_id')
        target_item_id = row.get('target_item_id')
        if source_item_id:
            outbound[source_item_id] = outbound.get(source_item_id, 0) + 1
        if target_item_id:
            inbound[target_item_id] = inbound.get(target_item_id, 0) + 1
    return {'inboundCountByItem': inbound, 'outboundCountByItem': outbound}


async def _get_version(workspace_id: str) -> int:
    client = await redis_service.get_client()
    v = await client.get(WORKSPACE_VER_KEY.format(workspace_id=workspace_id))
    if v is None:
        # Initialize version at 1
        await client.set(WORKSPACE_VER_KEY.format(workspace_id=workspace_id), "1")
        return 1
    try:
        return int(v)
    except Exception:
        return 1


async def _incr_version(workspace_id: str) -> int:
    client = await redis_service.get_client()
    v = await client.incr(WORKSPACE_VER_KEY.format(workspace_id=workspace_id))
    return int(v)


async def build_workspace_payload(workspace_id: str) -> Dict[str, Any]:
    """Build the workspace aggregate payload from DB.

    Returns minimal folder and canvas lists required by workspace view.
    """
    db = DBConnection()
    client = await db.client

    # Fetch folders (not deleted)
    folders_res = await client.table('folders').select('*').eq('account_id', workspace_id).eq('is_deleted', False).execute()
    folders_rows = folders_res.data or []

    # Fetch canvases (not deleted)
    canvases_res = await client.table('canvases').select('*').eq('account_id', workspace_id).eq('is_deleted', False).execute()
    canvas_rows = canvases_res.data or []

    # Compose Canvas docs (mirror compose logic from core.canvas.api)
    def compose_canvas(row: dict) -> Dict[str, Any]:
        doc = row.get('doc') or {}
        if 'id' not in doc and 'id' in row:
            doc['id'] = row['id']
        if 'title' not in doc and 'title' in row:
            doc['title'] = row['title']
        if 'version' not in doc and 'version' in row:
            doc['version'] = row['version']
        if 'createdAt' not in doc and 'created_at' in row:
            try:
                doc['createdAt'] = int(datetime.fromisoformat(row['created_at'].replace('Z','+00:00')).timestamp() * 1000)
            except Exception:
                doc['createdAt'] = _now_ms()
        if 'updatedAt' not in doc and 'updated_at' in row:
            try:
                doc['updatedAt'] = int(datetime.fromisoformat(row['updated_at'].replace('Z','+00:00')).timestamp() * 1000)
            except Exception:
                doc['updatedAt'] = _now_ms()
        # Defaults
        doc.setdefault('nodes', [])
        doc.setdefault('connections', [])
        return {
            'id': doc.get('id'),
            'title': doc.get('title'),
            'nodes': doc.get('nodes'),
            'connections': doc.get('connections'),
            'createdAt': doc.get('createdAt'),
            'updatedAt': doc.get('updatedAt'),
            'version': doc.get('version'),
        }

    canvases = [compose_canvas(r) for r in canvas_rows]

    # Build folder models; collect childFolderIds and canvasIds
    folders_by_id: Dict[str, dict] = {r['id']: r for r in folders_rows}
    child_map: Dict[str, List[str]] = {}
    for r in folders_rows:
        pid = r.get('parent_id')
        if pid:
            child_map.setdefault(pid, []).append(r['id'])

    # Map canvases by folderId from doc JSON
    canvas_ids_by_folder: Dict[str, List[str]] = {}
    for r in canvas_rows:
        doc = r.get('doc') or {}
        try:
            fid = doc.get('folderId')
        except Exception:
            fid = None
        if fid:
            canvas_ids_by_folder.setdefault(fid, []).append(r['id'])

    def calc_level(fid: Optional[str]) -> int:
        level = 0
        cur = fid
        while cur:
            parent_row = folders_by_id.get(cur)
            if not parent_row:
                break
            cur = parent_row.get('parent_id')
            if cur:
                level += 1
        return level

    def to_folder_model(row: dict) -> Dict[str, Any]:
        fid = row['id']
        # robust timestamp to ms
        def to_ms(v):
            if not v:
                return _now_ms()
            try:
                if isinstance(v, (int, float)):
                    return int(v)
                s = str(v)
                if s.endswith('Z'):
                    s = s.replace('Z', '+00:00')
                return int(datetime.fromisoformat(s).timestamp() * 1000)
            except Exception:
                return _now_ms()
        return {
            'id': fid,
            'name': row.get('name') or '新建文件夹',
            'parentId': row.get('parent_id'),
            'canvasIds': canvas_ids_by_folder.get(fid, []),
            'childFolderIds': child_map.get(fid, []),
            'level': calc_level(row.get('parent_id')),
            # isExpanded will be handled client-side; keep DB value for compatibility
            'isExpanded': bool(row.get('is_expanded', False)),
            'sortOrder': int(row.get('sort_order') or 0),
            'createdAt': to_ms(row.get('created_at')),
            'updatedAt': to_ms(row.get('updated_at')),
        }

    folders = [to_folder_model(r) for r in folders_rows]

    items_meta = await _load_items_meta(client, workspace_id)
    docs_meta = await _load_docs_meta(client, workspace_id)
    refs_summary = await _load_refs_summary(client, workspace_id)
    version = await _get_version(workspace_id)
    payload = {
        'folders': folders,
        'canvases': canvases,
        'items': items_meta,
        'docsMeta': docs_meta,
        'refsSummary': refs_summary,
        'version': version,
        'generatedAt': _now_ms(),
    }
    return payload


async def build_workspace_payload_meta(workspace_id: str) -> Dict[str, Any]:
    """Build a lightweight workspace payload (meta only)."""
    db = DBConnection()
    client = await db.client

    folders_res = await client.table('folders').select('*').eq('account_id', workspace_id).eq('is_deleted', False).execute()
    folders_rows = folders_res.data or []

    canvases_res = await client.table('canvases').select('id,title,version,created_at,updated_at,doc').eq('account_id', workspace_id).eq('is_deleted', False).execute()
    canvas_rows = canvases_res.data or []

    def to_ms(v):
        if not v:
            return _now_ms()
        try:
            if isinstance(v, (int, float)):
                return int(v)
            s = str(v)
            if s.endswith('Z'):
                s = s.replace('Z', '+00:00')
            return int(datetime.fromisoformat(s).timestamp() * 1000)
        except Exception:
            return _now_ms()

    def compose_canvas_meta(row: dict) -> Dict[str, Any]:
        doc = row.get('doc') or {}
        nodes = doc.get('nodes') or []
        node_count = len(nodes) if isinstance(nodes, list) else 0
        return {
            'id': row.get('id') or doc.get('id'),
            'title': row.get('title') or doc.get('title'),
            'createdAt': to_ms(row.get('created_at')),
            'updatedAt': to_ms(row.get('updated_at')),
            'version': row.get('version') or doc.get('version'),
            'nodeCount': node_count,
        }

    canvases = [compose_canvas_meta(r) for r in canvas_rows]

    folders_by_id: Dict[str, dict] = {r['id']: r for r in folders_rows}
    child_map: Dict[str, List[str]] = {}
    for r in folders_rows:
        pid = r.get('parent_id')
        if pid:
            child_map.setdefault(pid, []).append(r['id'])

    canvas_ids_by_folder: Dict[str, List[str]] = {}
    for r in canvas_rows:
        doc = r.get('doc') or {}
        try:
            fid = doc.get('folderId')
        except Exception:
            fid = None
        if fid:
            canvas_ids_by_folder.setdefault(fid, []).append(r['id'])

    def calc_level(fid: Optional[str]) -> int:
        level = 0
        cur = fid
        while cur:
            parent_row = folders_by_id.get(cur)
            if not parent_row:
                break
            cur = parent_row.get('parent_id')
            if cur:
                level += 1
        return level

    def to_folder_model(row: dict) -> Dict[str, Any]:
        fid = row['id']
        return {
            'id': fid,
            'name': row.get('name') or '新建文件夹',
            'parentId': row.get('parent_id'),
            'canvasIds': canvas_ids_by_folder.get(fid, []),
            'childFolderIds': child_map.get(fid, []),
            'level': calc_level(row.get('parent_id')),
            'isExpanded': bool(row.get('is_expanded', False)),
            'sortOrder': int(row.get('sort_order') or 0),
            'createdAt': to_ms(row.get('created_at')),
            'updatedAt': to_ms(row.get('updated_at')),
        }

    folders = [to_folder_model(r) for r in folders_rows]

    items_meta = await _load_items_meta(client, workspace_id)
    docs_meta = await _load_docs_meta(client, workspace_id)
    refs_summary = await _load_refs_summary(client, workspace_id)
    version = await _get_version(workspace_id)
    payload = {
        'folders': folders,
        'canvases': canvases,
        'items': items_meta,
        'docsMeta': docs_meta,
        'refsSummary': refs_summary,
        'version': version,
        'generatedAt': _now_ms(),
    }
    return payload


async def get_workspace_cached(workspace_id: str) -> Dict[str, Any]:
    key = WORKSPACE_AGG_KEY.format(workspace_id=workspace_id)
    return await _get_cached_with_singleflight(
        key=key,
        build_payload=lambda: build_workspace_payload(workspace_id),
        ttl=600,
        metric_prefix="workspace",
    )


async def get_workspace_meta_cached(workspace_id: str) -> Dict[str, Any]:
    key = WORKSPACE_META_KEY.format(workspace_id=workspace_id)
    return await _get_cached_with_singleflight(
        key=key,
        build_payload=lambda: build_workspace_payload_meta(workspace_id),
        ttl=600,
        metric_prefix="workspace_meta",
    )


async def _get_cached_with_singleflight(
    *,
    key: str,
    build_payload: Callable[[], Awaitable[Dict[str, Any]]],
    ttl: int,
    metric_prefix: str,
) -> Dict[str, Any]:
    cached = await cache_service.get(key)
    if cached:
        return cached

    loop = asyncio.get_running_loop()
    owner = False
    async with _CACHE_SINGLEFLIGHT_LOCK:
        in_flight = _CACHE_SINGLEFLIGHT.get(key)
        if in_flight is None:
            in_flight = loop.create_future()
            _CACHE_SINGLEFLIGHT[key] = in_flight
            owner = True
        else:
            metrics.incr(f"{metric_prefix}.singleflight_hits")

    if not owner:
        wait_started = perf_counter()
        payload = await in_flight
        metrics.incr(f"{metric_prefix}.cache_miss_deduped")
        metrics.timing(
            f"{metric_prefix}.singleflight_wait_ms",
            (perf_counter() - wait_started) * 1000.0,
        )
        return payload

    started = perf_counter()
    try:
        payload = await build_payload()
        await cache_service.set(key, payload, ttl=ttl)
        if not in_flight.done():
            in_flight.set_result(payload)
        metrics.timing(f"{metric_prefix}.compute_ms", (perf_counter() - started) * 1000.0)
        return payload
    except Exception as exc:
        if not in_flight.done():
            in_flight.set_exception(exc)
        raise
    finally:
        async with _CACHE_SINGLEFLIGHT_LOCK:
            current = _CACHE_SINGLEFLIGHT.get(key)
            if current is in_flight:
                _CACHE_SINGLEFLIGHT.pop(key, None)


async def invalidate_workspace_cache(workspace_id: str) -> None:
    agg_key = WORKSPACE_AGG_KEY.format(workspace_id=workspace_id)
    meta_key = WORKSPACE_META_KEY.format(workspace_id=workspace_id)
    await cache_service.delete(agg_key)
    await cache_service.delete(meta_key)


async def bump_workspace_version_and_broadcast(
    workspace_id: str,
    changes: Optional[List[Dict[str, Any]]] = None,
    actor_id: Optional[str] = None,
    request_id: Optional[str] = None,
) -> int:
    version = await _incr_version(workspace_id)
    await invalidate_workspace_cache(workspace_id)
    channel = WORKSPACE_UPDATES_CHANNEL.format(workspace_id=workspace_id)

    update_event = {
        'type': 'workspace_updated',
        'workspaceId': workspace_id,
        'version': version,
    }
    if request_id:
        update_event['requestId'] = request_id
    if actor_id:
        update_event['actorId'] = actor_id

    message = orjson.dumps(update_event).decode('utf-8')
    try:
        await redis_service.publish(channel, message)
    except Exception as e:
        logger.warning(f"Failed to publish workspace update for workspace={workspace_id}: {e}")

    if changes:
        patch = {
            'type': 'workspace_patch',
            'workspaceId': workspace_id,
            'version': version,
            'ts': _now_ms(),
            'changes': changes,
        }
        if actor_id:
            patch['actorId'] = actor_id
        if request_id:
            patch['requestId'] = request_id
        try:
            await redis_service.publish(channel, orjson.dumps(patch).decode('utf-8'))
        except Exception as e:
            logger.warning(f"Failed to publish workspace patch for workspace={workspace_id}: {e}")
    return version
