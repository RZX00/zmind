from __future__ import annotations

from typing import List, Optional, Dict, Any, Literal
from dataclasses import dataclass

from core.tools.base import Tool, ToolResult, openapi_schema, usage_example
from core.tools.constants import get_default_node_size
from core.services.supabase import DBConnection
from core.canvas.versioning import bump_canvas_server_version
from core.canvas.id_utils import generate_canvas_entity_id
from core.canvas.write_service import CanvasWriteService, CanvasRealtimeError
from core.canvas.ops_normalization import normalize_ops, compute_idempotency_key
from core.canvas.ops_contract import CANVAS_PATCH_KEYS_SET
from core.application.use_cases.canvas.update_canvas import UpdateCanvasUseCase
from core.infrastructure.canvas.supabase_canvas_repository import SupabaseCanvasRepository
from core.domains.canvas.model import Canvas
from core.application.use_cases.collaboration.append_operations import (
    AppendCollaborationOperationsUseCase,
)
from core.infrastructure.collaboration.supabase_collaboration_repository import (
    SupabaseCollaborationRepository,
)
from core.utils.logger import logger
from core.utils.config import config
import json
from datetime import datetime, timezone
from urllib.parse import urlparse


def _now_ms() -> int:
    return int(datetime.now(timezone.utc).timestamp() * 1000)


# Sizes are now centralized in core.tools.constants


@dataclass
class CanvasEditTool(Tool):
    """Minimal canvas edit tool: applies structured operations to a canvas doc.

    This tool is intentionally conservative: it validates structure and
    supports a core set of operations required for MVP.
    """
    thread_id: str
    canvas_id: Optional[str] = None
    db_connection: DBConnection | None = None
    thread_manager: object | None = None

    def __post_init__(self):  # dataclass post-init hook
        super().__init__()
        self.db = self.db_connection or DBConnection()
        self._write_service = CanvasWriteService()

    def _build_error_payload(
        self,
        msg: str,
        *,
        code: Optional[str] = None,
        hint: Optional[str] = None,
        field: Optional[str] = None,
    ) -> Dict[str, Any]:
        resolved_code = code or None
        resolved_hint = hint
        resolved_field = field
        mapped_code: Optional[str] = None
        mapped_hint: Optional[str] = None
        mapped_field: Optional[str] = None

        if "Version conflict" in msg:
            mapped_code = "version_conflict"
            mapped_hint = "Reload the canvas and retry with serverVersion."
        elif "expected_version must be a numeric serverVersion" in msg:
            mapped_code = "invalid_expected_version"
            mapped_field = "expected_version"
        elif "operations must be a non-empty array" in msg:
            mapped_code = "invalid_arguments"
            mapped_field = "operations"
        elif "No canvas is bound" in msg:
            mapped_code = "missing_canvas"
        elif "Canvas not found" in msg or "access denied" in msg:
            mapped_code = "not_found"
        elif "Unsupported operation" in msg:
            mapped_code = "unsupported_operation"
        elif "node not found" in msg:
            mapped_code = "node_not_found"
        elif "connection not found" in msg:
            mapped_code = "connection_not_found"
        elif "Realtime apply failed" in msg:
            mapped_code = "realtime_error"
        elif "Validation failed" in msg or "requires" in msg or "missing" in msg:
            mapped_code = "validation_error"

        if not resolved_code:
            resolved_code = mapped_code or "canvas_edit_error"
        if not resolved_hint and mapped_hint:
            resolved_hint = mapped_hint
        if not resolved_field and mapped_field:
            resolved_field = mapped_field

        error: Dict[str, Any] = {"code": resolved_code, "message": msg}
        if resolved_hint:
            error["hint"] = resolved_hint
        if resolved_field:
            error["field"] = resolved_field
        return {"error": error, "code": resolved_code, "message": msg}

    def fail_response(
        self,
        msg: str,
        *,
        code: Optional[str] = None,
        hint: Optional[str] = None,
        field: Optional[str] = None,
    ) -> ToolResult:
        payload = self._build_error_payload(msg, code=code, hint=hint, field=field)
        return ToolResult(success=False, output=json.dumps(payload, indent=2))

    async def _get_account_id(self) -> Optional[str]:
        try:
            client = await self.db.client
            res = await client.table('threads').select('account_id').eq('thread_id', self.thread_id).limit(1).execute()
            if res.data and len(res.data) > 0:
                return res.data[0].get('account_id')
        except Exception as e:
            logger.error(f"CanvasEditTool: failed to resolve account for thread {self.thread_id}: {e}")
        return None

    async def _get_thread_canvas_id(self) -> Optional[str]:
        if self.canvas_id:
            return self.canvas_id
        try:
            client = await self.db.client
            res = await client.table('threads').select('canvas_id, metadata').eq('thread_id', self.thread_id).limit(1).execute()
            if res.data and len(res.data) > 0:
                row = res.data[0]
                canvas_id = row.get('canvas_id') or None
                if canvas_id:
                    return canvas_id
                meta = row.get('metadata') or {}
                if isinstance(meta, str):
                    try:
                        import json as _json
                        meta = _json.loads(meta)
                    except Exception:
                        meta = {}
                if isinstance(meta, dict):
                    return meta.get('canvas_id') or meta.get('canvasId') or None
        except Exception as e:
            logger.error(f"CanvasEditTool: failed to resolve canvas for thread {self.thread_id}: {e}")
        return None

    async def _log_ai_timeline(
        self,
        *,
        account_id: str,
        canvas_id: str,
        operations: List[Dict[str, Any]],
        doc: Dict[str, Any],
        account_id_override: Optional[str],
        timeline_enabled: bool = True,
    ) -> None:
        if account_id_override is not None or not timeline_enabled:
            return
        try:
            try:
                client = await self.db.client
            except Exception:
                return
            assistant_message_id: Optional[str] = None
            thread_run_id: Optional[str] = None
            try:
                try:
                    ares = await client.table('messages') \
                        .select('message_id, metadata') \
                        .eq('thread_id', self.thread_id) \
                        .eq('type', 'assistant') \
                        .order('created_at', desc=True) \
                        .limit(1).execute()
                    if ares.data and len(ares.data) > 0:
                        assistant_message_id = ares.data[0].get('message_id')
                        try:
                            md = ares.data[0].get('metadata') or {}
                            if isinstance(md, str):
                                import json as _json
                                md = _json.loads(md or '{}')
                            tr = md.get('thread_run_id')
                            if tr:
                                thread_run_id = str(tr)
                        except Exception:
                            pass
                except Exception:
                    pass
                if not thread_run_id:
                    try:
                        sres = await client.table('messages') \
                            .select('metadata') \
                            .eq('thread_id', self.thread_id) \
                            .in_('type', ['tool', 'status']) \
                            .order('created_at', desc=True) \
                            .limit(1).execute()
                        if sres.data and len(sres.data) > 0:
                            md = sres.data[0].get('metadata') or {}
                            if isinstance(md, str):
                                import json as _json
                                md = _json.loads(md or '{}')
                            tr = md.get('thread_run_id') or md.get('run_id')
                            if tr:
                                thread_run_id = str(tr)
                    except Exception:
                        pass
            except Exception:
                pass

            try:
                await client.table('canvas_events').insert({
                    'canvas_id': canvas_id,
                    'account_id': account_id,
                    'user_id': None,
                    'batch_id': self.thread_id,
                    'seq': 0,
                    'op_type': 'ai_edit',
                    'op': {
                        'type': 'ai_edit',
                        'thread_id': self.thread_id,
                        'assistant_message_id': assistant_message_id,
                        'thread_run_id': thread_run_id,
                        'operations': operations,
                    },
                    'doc_after': doc,
                    'is_checkpoint': True,
                    'created_at': datetime.now(timezone.utc).isoformat(),
                }).execute()
            except Exception as inner:
                logger.debug(f"CanvasEditTool: canvas_events insert skipped: {inner}")
            try:
                await client.table('canvas_versions').insert({
                    'canvas_id': canvas_id,
                    'version_doc': doc,
                    'is_auto_save': True,
                    'description': 'AutoSave (AI Edit)',
                    'created_at': datetime.now(timezone.utc).isoformat(),
                }).execute()
            except Exception as inner2:
                logger.debug(f"CanvasEditTool: canvas_versions autosave skipped: {inner2}")
        except Exception as e:
            logger.debug(f"CanvasEditTool: timeline/autosave failed: {e}")

    async def _get_timeline_enabled(self, canvas_id: str, account_id: str) -> bool:
        try:
            client = await self.db.client
            res = await client.table('canvases') \
                .select('timeline_enabled') \
                .eq('id', canvas_id) \
                .eq('account_id', account_id) \
                .limit(1) \
                .execute()
            if res.data:
                return bool(res.data[0].get('timeline_enabled'))
        except Exception:
            return False
        return False

    async def edit(
        self,
        canvas_id: Optional[str],
        operations: List[Dict[str, Any]],
        expected_version: Optional[str] = None,
        account_id_override: Optional[str] = None,
        broadcast_canvas_ws: bool = False,
        force_legacy_write: bool = False,
        record_collaboration_ops: bool = True,
    ) -> ToolResult:
        try:
            if not operations or not isinstance(operations, list):
                return self.fail_response("operations must be a non-empty array")

            warnings: List[str] = []
            operations, norm_warnings = normalize_ops(operations)
            if norm_warnings:
                warnings.extend(norm_warnings)
            warning_set = set(warnings)

            def _warn(msg: str) -> None:
                if msg not in warning_set:
                    warning_set.add(msg)
                    warnings.append(msg)

            expected_server_version: Optional[int] = None
            if expected_version not in (None, ""):
                try:
                    expected_server_version = int(str(expected_version))
                except Exception:
                    return self.fail_response("expected_version must be a numeric serverVersion")

            account_id = account_id_override or await self._get_account_id()
            if not account_id:
                return self.fail_response("Unable to determine account context for this thread")

            target_canvas_id = canvas_id or await self._get_thread_canvas_id()
            if not target_canvas_id:
                return self.fail_response("No canvas is bound to this thread; please provide canvas_id explicitly")

            if config.CANVAS_REALTIME_WRITE_ENABLED and not force_legacy_write:
                try:
                    request_trace_id = f"canvas_edit:{self.thread_id}:{_now_ms()}"
                    # Deterministic idempotency key from the batch content: a retried
                    # timeout of the same logical batch dedups instead of double-applying.
                    idempotency_key = compute_idempotency_key(
                        target_canvas_id, operations, expected_server_version
                    )
                    rt_result = await self._write_service.apply_canvas_ops(
                        canvas_id=target_canvas_id,
                        workspace_id=account_id,
                        operations=operations,
                        expected_version=expected_server_version,
                        user_id=None,
                        idempotency_key=idempotency_key,
                        client_request_id=request_trace_id,
                        client_session_id=f"tool:{self.thread_id}",
                    )
                except CanvasRealtimeError as e:
                    logger.warning(f"CanvasEditTool: realtime apply failed: {e}")
                    code = e.code
                    hint = None
                    field = None
                    message = e.message or str(e)
                    detail = e.detail if isinstance(e.detail, dict) else None
                    if detail:
                        err = detail.get("error")
                        if isinstance(err, dict):
                            code = err.get("code") or code
                            hint = err.get("hint") or hint
                            field = err.get("field") or field
                            message = err.get("message") or detail.get("message") or message
                        else:
                            message = detail.get("message") or message
                    return self.fail_response(message, code=code, hint=hint, field=field)
                except Exception as e:
                    logger.warning(f"CanvasEditTool: realtime apply failed: {e}")
                    return self.fail_response(f"Realtime apply failed: {e}")

                rt_error = rt_result.get("error") if isinstance(rt_result, dict) else None
                if (
                    rt_error == "version_conflict"
                    or (isinstance(rt_error, dict) and rt_error.get("code") == "version_conflict")
                    or (isinstance(rt_result, dict) and rt_result.get("status_code") == 409)
                ):
                    return self.fail_response("Version conflict. Please reload the canvas.")

                canvas_doc = rt_result.get("canvas") if isinstance(rt_result, dict) else None
                if not isinstance(canvas_doc, dict):
                    canvas_doc = {}
                applied = rt_result.get("applied") if isinstance(rt_result, dict) else None
                id_map = None
                if isinstance(rt_result, dict):
                    id_map = rt_result.get("id_map") or rt_result.get("idMap")
                rt_warnings = rt_result.get("warnings") if isinstance(rt_result, dict) else None
                if isinstance(rt_warnings, list):
                    warnings.extend(rt_warnings)
                if warnings:
                    warnings = list(dict.fromkeys(warnings))
                sync_status = rt_result.get("sync_status") if isinstance(rt_result, dict) else None

                timeline_enabled = await self._get_timeline_enabled(target_canvas_id, account_id)
                await self._log_ai_timeline(
                    account_id=account_id,
                    canvas_id=target_canvas_id,
                    operations=operations,
                    doc=canvas_doc,
                    account_id_override=account_id_override,
                    timeline_enabled=timeline_enabled,
                )

                # 不再返回完整 canvas，依赖 Yjs 实时同步
                return self.success_response({
                    'applied': applied or [],
                    'id_map': id_map or {},
                    'serverVersion': canvas_doc.get('serverVersion') if isinstance(canvas_doc, dict) else None,
                    'warnings': warnings or [],
                    'sync_status': sync_status or "ok",
                })

            client = await self.db.client
            # Fetch existing
            res = await client.table('canvases').select('*').eq('id', target_canvas_id).eq('account_id', account_id).eq('is_deleted', False).limit(1).execute()
            if not res.data:
                return self.fail_response(f"Canvas not found or access denied: {target_canvas_id}")

            row = res.data[0]
            doc = row.get('doc') or {}
            base_doc = dict(doc) if isinstance(doc, dict) else {}
            if 'nodes' not in doc or 'connections' not in doc:
                doc.setdefault('nodes', [])
                doc.setdefault('connections', [])

            # Concurrency check (best-effort)
            if expected_server_version is not None:
                current_sv = doc.get('serverVersion')
                if current_sv is None or int(current_sv) != expected_server_version:
                    return self.fail_response("Version conflict. Please reload the canvas.")

            nodes = doc.get('nodes') or []
            conns = doc.get('connections') or []

            def find_node(nid: str) -> Optional[Dict[str, Any]]:
                for n in nodes:
                    if n.get('id') == nid:
                        return n
                return None

            def find_conn(cid: str) -> Optional[Dict[str, Any]]:
                for c in conns:
                    if c.get('id') == cid:
                        return c
                return None

            applied = []

            def _parse_table_content_payload(content: Any) -> Optional[Dict[str, Any]]:
                if not isinstance(content, str):
                    return None
                text = content.strip()
                if not text:
                    return None
                if not (text.startswith('{') or text.startswith('[')):
                    return None
                try:
                    payload = json.loads(text)
                except Exception:
                    return None
                rows = payload.get('rows')
                if not isinstance(rows, list):
                    return None
                cleaned_rows: List[List[str]] = []
                for row in rows:
                    if not isinstance(row, list):
                        return None
                    cleaned_rows.append(['' if cell is None else str(cell) for cell in row])
                result: Dict[str, Any] = {'rows': cleaned_rows}
                cw = payload.get('columnWidths')
                if isinstance(cw, list) and all(isinstance(v, (int, float)) for v in cw):
                    result['columnWidths'] = [float(v) for v in cw]
                rh = payload.get('rowHeights')
                if isinstance(rh, list) and all(isinstance(v, (int, float)) for v in rh):
                    result['rowHeights'] = [float(v) for v in rh]
                return result

            def _first_line(value: Any) -> str:
                if not isinstance(value, str):
                    return ""
                return value.splitlines()[0].strip()

            _IMAGE_EXTS = {"png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "tiff", "avif", "heic", "heif"}
            _VIDEO_EXTS = {"mp4", "mov", "webm", "mkv", "avi", "mpeg", "mpg"}
            _AUDIO_EXTS = {"mp3", "wav", "aac", "flac", "ogg", "m4a"}
            _DOC_EXTS = {"pdf", "doc", "docx", "rtf", "txt", "md"}
            _SHEET_EXTS = {"xls", "xlsx", "csv"}
            _SLIDE_EXTS = {"ppt", "pptx", "key"}
            _MIME_BY_EXT = {
                "png": "image/png",
                "jpg": "image/jpeg",
                "jpeg": "image/jpeg",
                "gif": "image/gif",
                "webp": "image/webp",
                "svg": "image/svg+xml",
                "pdf": "application/pdf",
                "mp4": "video/mp4",
                "mov": "video/quicktime",
                "mp3": "audio/mpeg",
                "wav": "audio/wav",
                "csv": "text/csv",
            }

            def _infer_media_type(ext: str, mime_type: Optional[str]) -> str:
                mt = (mime_type or "").lower()
                if mt.startswith("image/"):
                    return "image"
                if mt.startswith("audio/"):
                    return "audio"
                if mt.startswith("video/"):
                    return "video"
                if ext in _IMAGE_EXTS:
                    return "image"
                if ext in _AUDIO_EXTS:
                    return "audio"
                if ext in _VIDEO_EXTS:
                    return "video"
                if ext in _SHEET_EXTS:
                    return "spreadsheet"
                if ext in _SLIDE_EXTS:
                    return "presentation"
                if ext in _DOC_EXTS:
                    return "document"
                return "document"

            def _extract_file_name(node: Dict[str, Any]) -> Optional[str]:
                raw_name = node.get("fileName")
                if isinstance(raw_name, str) and raw_name.strip():
                    return raw_name.strip()
                for key in ("fileUrl", "externalUrl", "embedUrl"):
                    raw = node.get(key)
                    if not isinstance(raw, str) or not raw.strip():
                        continue
                    try:
                        path = urlparse(raw).path or ""
                        candidate = path.rsplit("/", 1)[-1]
                    except Exception:
                        candidate = raw.split("?", 1)[0].split("#", 1)[0].rsplit("/", 1)[-1]
                    if candidate:
                        return candidate
                return None

            def _fill_media_defaults(node: Dict[str, Any]) -> None:
                changed = False
                file_name = _extract_file_name(node)
                if not node.get("fileName") and file_name:
                    node["fileName"] = file_name
                    changed = True
                ext = node.get("fileExtension") or (
                    file_name.rsplit(".", 1)[-1] if file_name and "." in file_name else ""
                )
                ext = str(ext).lstrip(".").lower() if ext else ""
                if not node.get("fileExtension") and ext:
                    node["fileExtension"] = ext
                    changed = True
                if not node.get("fileType"):
                    node["fileType"] = _MIME_BY_EXT.get(ext, "application/octet-stream")
                    changed = True
                if not isinstance(node.get("fileSize"), (int, float)):
                    node["fileSize"] = 0
                    changed = True
                if not node.get("mediaType"):
                    node["mediaType"] = _infer_media_type(ext, node.get("fileType"))
                    changed = True
                if not node.get("uploadStatus"):
                    node["uploadStatus"] = "mock"
                    changed = True
                if not node.get("mediaSource"):
                    node["mediaSource"] = "external" if node.get("externalUrl") or node.get("embedUrl") else "file"
                    changed = True
                if changed:
                    _warn("auto-filled media defaults")

            # --- Build uniqueness sets and ID helpers (single canonical id format) ---
            used_node_ids = {str(n.get('id')) for n in nodes if n.get('id')}
            used_conn_ids = {str(c.get('id')) for c in conns if c.get('id')}
            id_map: Dict[str, str] = {}

            def _gen_entity_id() -> str:
                while True:
                    eid = generate_canvas_entity_id()
                    if eid not in used_node_ids and eid not in used_conn_ids:
                        return eid

            def _gen_node_id(_node_type: str) -> str:
                nid = _gen_entity_id()
                used_node_ids.add(nid)
                return nid

            def _gen_conn_id() -> str:
                cid = _gen_entity_id()
                used_conn_ids.add(cid)
                return cid

            def _is_tmp_id(v: Optional[str]) -> bool:
                return isinstance(v, str) and v.startswith('tmp:')

            def _clamp_opacity(val: Any) -> Optional[float]:
                try:
                    f = float(val)
                except Exception:
                    return None
                if f < 0:
                    return 0.0
                if f > 1:
                    return 1.0
                return f

            # Pre-scan to allocate ids for tmp:/missing ids and build id_map
            try:
                # Allocate node ids first
                for op in operations:
                    if not isinstance(op, dict):
                        continue
                    if op.get('op') == 'add_node':
                        node = op.get('node') or {}
                        ntype = node.get('type')
                        if not ntype:
                            continue
                        given = node.get('id')
                        if given is None or _is_tmp_id(given):
                            new_id = _gen_node_id(ntype)
                            if _is_tmp_id(given):
                                id_map[given] = new_id
                            node['id'] = new_id
                            op['node'] = node
                        else:
                            if not isinstance(given, str):
                                given = str(given)
                                node['id'] = given
                                op['node'] = node
                            used_node_ids.add(str(given))
                # Allocate connection ids
                for op in operations:
                    if not isinstance(op, dict):
                        continue
                    if op.get('op') == 'add_connection':
                        given_cid = op.get('id')
                        if given_cid is None or _is_tmp_id(given_cid):
                            new_cid = _gen_conn_id()
                            if _is_tmp_id(given_cid):
                                id_map[given_cid] = new_cid
                            op['id'] = new_cid
                        else:
                            if not isinstance(given_cid, str):
                                given_cid = str(given_cid)
                                op['id'] = given_cid
                            used_conn_ids.add(str(given_cid))
            except Exception as _e:
                logger.warning(f"Pre-scan id allocation error: {_e}")

            # Map tmp: refs across operations (from/to/parentGroupId/children/id/patch)
            def _map_tmp(v: Optional[str]) -> Optional[str]:
                if isinstance(v, str) and v.startswith('tmp:'):
                    if v in id_map:
                        return id_map[v]
                    raise ValueError(f"Unknown temporary id reference: {v}")
                return v

            try:
                for op in operations:
                    if not isinstance(op, dict):
                        continue
                    k = op.get('op')
                    if k == 'add_node':
                        node = op.get('node') or {}
                        # Canonicalize text opacity: allow either node.opacity or node.textStyles.opacity
                        if 'opacity' in node:
                            tv = _clamp_opacity(node.get('opacity'))
                            if tv is not None:
                                ts = node.get('textStyles') or {}
                                if not isinstance(ts, dict):
                                    ts = {}
                                ts['opacity'] = tv
                                node['textStyles'] = ts
                            node.pop('opacity', None)
                        if isinstance(node.get('textStyles'), dict) and 'opacity' in node['textStyles']:
                            tv = _clamp_opacity(node['textStyles'].get('opacity'))
                            if tv is not None:
                                node['textStyles']['opacity'] = tv
                        if isinstance(node.get('parentGroupId'), str):
                            node['parentGroupId'] = _map_tmp(node.get('parentGroupId'))
                        if isinstance(node.get('children'), list):
                            node['children'] = [(_map_tmp(x) or x) for x in node.get('children')]
                        op['node'] = node
                    elif k in ('update_node', 'move_node', 'apply_style', 'delete_node'):
                        if 'id' in op:
                            op['id'] = _map_tmp(op.get('id'))
                        if k == 'update_node':
                            patch = op.get('patch') or {}
                            # Canonicalize text opacity in update patch
                            if 'opacity' in patch:
                                tv = _clamp_opacity(patch.get('opacity'))
                                if tv is not None:
                                    ts = patch.get('textStyles') or {}
                                    if not isinstance(ts, dict):
                                        ts = {}
                                    ts['opacity'] = tv
                                    patch['textStyles'] = ts
                                patch.pop('opacity', None)
                            if isinstance(patch.get('textStyles'), dict) and 'opacity' in patch['textStyles']:
                                tv = _clamp_opacity(patch['textStyles'].get('opacity'))
                                if tv is not None:
                                    patch['textStyles']['opacity'] = tv
                            if isinstance(patch.get('parentGroupId'), str):
                                patch['parentGroupId'] = _map_tmp(patch.get('parentGroupId'))
                            if isinstance(patch.get('children'), list):
                                patch['children'] = [(_map_tmp(x) or x) for x in patch.get('children')]
                            op['patch'] = patch
                    elif k == 'add_connection':
                        if 'from' in op:
                            op['from'] = _map_tmp(op.get('from'))
                        if 'to' in op:
                            op['to'] = _map_tmp(op.get('to'))
                        if 'id' in op and _is_tmp_id(op.get('id')):
                            mapped = id_map.get(op.get('id'))
                            if mapped:
                                op['id'] = mapped
                    elif k == 'delete_connection':
                        if 'id' in op and _is_tmp_id(op.get('id')):
                            mapped = id_map.get(op.get('id'))
                            if mapped:
                                op['id'] = mapped
                    elif k == 'update_connection':
                        if 'id' in op and _is_tmp_id(op.get('id')):
                            mapped = id_map.get(op.get('id'))
                            if mapped:
                                op['id'] = mapped
                        # Allow endpoint mapping when id is absent but tmp endpoints are used
                        if 'from' in op:
                            op['from'] = _map_tmp(op.get('from'))
                        if 'to' in op:
                            op['to'] = _map_tmp(op.get('to'))
            except ValueError as ve:
                return self.fail_response(str(ve))

            def node_exists(nid: str) -> bool:
                return any(n.get('id') == nid for n in nodes)

            def get_node(nid: str) -> Optional[Dict[str, Any]]:
                for n in nodes:
                    if n.get('id') == nid:
                        return n
                return None

            def is_group_node_id(nid: str) -> bool:
                n = get_node(nid)
                return bool(n and n.get('type') == 'group')

            def _ensure_unique_node_id(nid: str) -> bool:
                """Return True if ID is not used yet."""
                if any(n.get('id') == nid for n in nodes):
                    return False
                if any(c.get('id') == nid for c in conns):
                    return False
                return True

            def _validate_type_specific_required(node: Dict[str, Any]) -> Optional[str]:
                """Return error message string if invalid; otherwise None."""
                ntype = node.get('type')
                if ntype == 'todo':
                    # completed is required by schema; if missing, default False
                    if 'completed' not in node:
                        node['completed'] = False
                elif ntype == 'code':
                    ctype = node.get('codeType')
                    if ctype not in ('mermaid', 'html', 'svg'):
                        return "code node requires codeType in {'mermaid','html','svg'}"
                elif ntype == 'table':
                    data = node.get('data')
                    if not isinstance(data, dict):
                        return "table node requires data.rows[][] (and optional columnWidths/rowHeights)"
                    rows = data.get('rows')
                    if not isinstance(rows, list):
                        return "table node requires data.rows(list of list)"
                    for row in rows:
                        if not isinstance(row, list):
                            return "table node requires data.rows(list of list)"
                elif ntype == 'media':
                    required = {
                        'fileName', 'fileType', 'fileExtension', 'fileSize', 'mediaType', 'uploadStatus'
                    }
                    missing = [k for k in required if k not in node]
                    if missing:
                        return f"media node missing fields: {missing}"
                elif ntype == 'canvas-link':
                    if not node.get('title'):
                        return "canvas-link node requires title"
                elif ntype == 'group':
                    # group requires children list
                    children = node.get('children')
                    if not isinstance(children, list):
                        return "group node requires children(list of node ids)"
                    # dedupe + remove self if present
                    node_id = node.get('id')
                    uniq = []
                    seen = set()
                    for cid in children:
                        if cid == node_id:
                            continue
                        if cid in seen:
                            continue
                        seen.add(cid)
                        uniq.append(cid)
                    node['children'] = uniq
                # column: no additional required fields, but children cannot contain column later (validated in final pass)
                return None

            def _final_validate(nodes_list: List[Dict[str, Any]], conns_list: List[Dict[str, Any]]) -> Optional[str]:
                # Uniqueness across nodes
                node_ids = [str(n.get('id')) for n in nodes_list if n.get('id')]
                if len(node_ids) != len(set(node_ids)):
                    return "duplicate node ids detected"
                id_map = {n.get('id'): n for n in nodes_list}
                # validate connections
                for c in conns_list:
                    frm = c.get('from')
                    to = c.get('to')
                    fpt = c.get('fromPoint')
                    tpt = c.get('toPoint')
                    has_nodes = frm is not None and to is not None
                    has_points = isinstance(fpt, dict) and isinstance(tpt, dict)
                    if has_nodes and has_points:
                        return "connection must not contain both (from,to) and (fromPoint,toPoint)"
                    if not has_nodes and not has_points:
                        return "connection requires either node endpoints or point endpoints"
                    if has_nodes:
                        if frm not in id_map or to not in id_map:
                            return f"connection references unknown node(s): from={frm}, to={to}"
                        if id_map[frm].get('type') == 'group' or id_map[to].get('type') == 'group':
                            return "connections must not target group nodes"
                    else:
                        try:
                            float(fpt.get('x')); float(fpt.get('y'))
                            float(tpt.get('x')); float(tpt.get('y'))
                        except Exception:
                            return "free connection requires numeric fromPoint/toPoint.x/y"
                # Uniqueness across connections and cross-collision with nodes
                conn_ids = [str(c.get('id')) for c in conns_list if c.get('id')]
                if len(conn_ids) != len(set(conn_ids)):
                    return "duplicate connection ids detected"
                if set(conn_ids) & set(node_ids):
                    return "node and connection ids must be globally unique (collision detected)"
                # validate column nesting
                for n in nodes_list:
                    if n.get('type') == 'column':
                        children = n.get('children') or []
                        for cid in children:
                            child = id_map.get(cid)
                            if child and child.get('type') == 'column':
                                return "column.children must not contain column nodes"
                # validate group children existence
                for n in nodes_list:
                    if n.get('type') == 'group':
                        for cid in (n.get('children') or []):
                            if cid not in id_map:
                                return f"group.children references unknown node id: {cid}"
                return None
            for op in operations:
                kind = op.get('op')
                # --- Top-level canvas update ---
                if kind == 'update_canvas':
                    patch = op.get('patch') or {}
                    if not isinstance(patch, dict) or not patch:
                        return self.fail_response("update_canvas requires non-empty 'patch' object")
                    for k, v in list(patch.items()):
                        if k not in CANVAS_PATCH_KEYS_SET:
                            patch.pop(k, None)
                    if not patch:
                        return self.fail_response("update_canvas patch contains no valid updatable fields")
                    # Apply
                    for k, v in patch.items():
                        doc[k] = v
                    doc['updatedAt'] = _now_ms()
                    applied.append({'op': 'update_canvas', 'keys': list(patch.keys())})
                    continue

                if kind == 'add_node':
                    node = op.get('node') or {}
                    # Fill sane defaults prior to validation
                    try:
                        t = str(node.get('type'))
                        if node.get('content') is None:
                            node['content'] = ''
                        title_val = node.get('title')
                        if t in ('group', 'column') and not _first_line(node.get('content')) and title_val:
                            node['content'] = str(title_val)
                            _warn("auto-filled group/column content from title")
                        if t == 'canvas-link':
                            if not node.get('title'):
                                derived = _first_line(node.get('content')) or "Canvas Link"
                                node['title'] = derived
                                _warn("auto-filled canvas-link title from content")
                            if not _first_line(node.get('content')) and node.get('title'):
                                node['content'] = str(node.get('title'))
                        if t == 'media':
                            _fill_media_defaults(node)
                        # Position defaults
                        if 'x' not in node:
                            node['x'] = 0
                        if 'y' not in node:
                            node['y'] = 0
                        # Code node default subtype
                        if node.get('type') == 'code' and not node.get('codeType'):
                            node['codeType'] = 'mermaid'
                        # Size defaults (centralized)
                        if 'width' not in node or node.get('width') in (None, 0) or 'height' not in node or node.get('height') in (None, 0):
                            w, h = get_default_node_size(t, node.get('codeType'))
                            node['width'] = float(node.get('width') or w)
                            node['height'] = float(node.get('height') or h)
                        # Table defaults
                        if t == 'table':
                            parsed = _parse_table_content_payload(node.get('content'))
                            if parsed:
                                node['data'] = parsed
                                node['content'] = ''
                            elif not isinstance(node.get('data'), dict):
                                node['data'] = {
                                    'rows': [['Header 1', 'Header 2'], ['', '']],
                                    'columnWidths': [160, 160],
                                    'rowHeights': [40, 40]
                                }
                        # Group defaults
                        if t == 'group':
                            ch = node.get('children')
                            if not isinstance(ch, list):
                                node['children'] = []
                            else:
                                # de-dup and drop self
                                seen = set()
                                uniq = []
                                for cid in ch:
                                    if cid and cid != node.get('id') and cid not in seen:
                                        uniq.append(cid); seen.add(cid)
                                node['children'] = uniq
                    except Exception:
                        pass

                    if not node.get('id'):
                        node['id'] = _gen_node_id(str(node.get('type')))
                    else:
                        if not _ensure_unique_node_id(node['id']):
                            return self.fail_response(f"add_node: duplicate id '{node['id']}'")
                    node.setdefault('createdAt', _now_ms())
                    node.setdefault('updatedAt', _now_ms())
                    required = {'id', 'type', 'x', 'y', 'width', 'height'}
                    if not required.issubset(node.keys()):
                        missing = required - set(node.keys())
                        return self.fail_response(
                            f"add_node missing fields: {missing}. Tip: width/height default to type; code node requires codeType (default 'mermaid').")
                    # Type-specific validation (and defaults)
                    err = _validate_type_specific_required(node)
                    if err:
                        return self.fail_response(f"add_node validation failed: {err}")
                    nodes.append(node)
                    applied.append({'op': 'add_node', 'id': node['id']})

                elif kind == 'update_node':
                    nid = op.get('id')
                    patch = op.get('patch') or {}
                    n = find_node(nid)
                    if not n:
                        return self.fail_response(f"update_node: node not found: {nid}")
                    if n.get('type') in ('group', 'column') and 'title' in patch and 'content' not in patch:
                        patch['content'] = str(patch.get('title') or '')
                        _warn("normalized group/column title -> content")
                    # Final safety: if patch.textStyles.opacity present, ensure [0,1]
                    if isinstance(patch.get('textStyles'), dict) and 'opacity' in patch['textStyles']:
                        tv = _clamp_opacity(patch['textStyles'].get('opacity'))
                        if tv is not None:
                            patch['textStyles']['opacity'] = tv
                    if n.get('type') == 'table':
                        parsed_patch = _parse_table_content_payload(patch.get('content'))
                        if parsed_patch:
                            patch['data'] = parsed_patch
                            patch['content'] = ''
                    n.update(patch)
                    n['updatedAt'] = _now_ms()
                    applied.append({'op': 'update_node', 'id': nid})

                elif kind == 'delete_node':
                    nid = op.get('id')
                    before = len(nodes)
                    nodes = [n for n in nodes if n.get('id') != nid]
                    conns = [c for c in conns if c.get('from') == nid or c.get('to') == nid and False]  # remove attached later
                    # remove connections touching node
                    conns = [c for c in conns if c.get('from') != nid and c.get('to') != nid]
                    applied.append({'op': 'delete_node', 'id': nid, 'removed': before - len(nodes)})

                elif kind == 'add_connection':
                    frm = op.get('from')
                    to = op.get('to')
                    fpt = op.get('fromPoint')
                    tpt = op.get('toPoint')
                    from_has_node = bool(frm)
                    from_has_point = isinstance(fpt, dict)
                    to_has_node = bool(to)
                    to_has_point = isinstance(tpt, dict)
                    if (from_has_node and from_has_point) or (to_has_node and to_has_point):
                        return self.fail_response("add_connection: each endpoint must choose either node id or point coordinates, not both.")
                    if not (from_has_node or from_has_point) or not (to_has_node or to_has_point):
                        return self.fail_response("add_connection: missing endpoints. Provide node ids and/or point coordinates for both ends.")
                    cid = op.get('id') or _gen_conn_id()
                    if any(c.get('id') == cid for c in conns):
                        return self.fail_response(f"add_connection: duplicate id '{cid}'")

                    payload_conn: Dict[str, Any] = {'id': cid, 'label': op.get('label'), 'createdAt': _now_ms()}
                    if from_has_node:
                        if not node_exists(frm) or is_group_node_id(frm):
                            return self.fail_response("add_connection: 'from' must reference an existing non-group node.")
                        payload_conn['from'] = frm
                    elif from_has_point:
                        try:
                            payload_conn['fromPoint'] = {'x': float(fpt.get('x')), 'y': float(fpt.get('y'))}
                        except Exception:
                            return self.fail_response("add_connection: fromPoint/toPoint must be objects with numeric x/y. Example: {\"fromPoint\":{\"x\":100,\"y\":200},\"toPoint\":{\"x\":300,\"y\":260}}")
                    if to_has_node:
                        if not node_exists(to) or is_group_node_id(to):
                            return self.fail_response("add_connection: 'to' must reference an existing non-group node.")
                        payload_conn['to'] = to
                    elif to_has_point:
                        try:
                            payload_conn['toPoint'] = {'x': float(tpt.get('x')), 'y': float(tpt.get('y'))}
                        except Exception:
                            return self.fail_response("add_connection: fromPoint/toPoint must be objects with numeric x/y. Example: {\"fromPoint\":{\"x\":100,\"y\":200},\"toPoint\":{\"x\":300,\"y\":260}}")

                    # Optional rendering hints
                    if isinstance(op.get('curveAnchor'), dict):
                        ca = op['curveAnchor']
                        try:
                            payload_conn['curveAnchor'] = {'x': float(ca.get('x')), 'y': float(ca.get('y'))}
                        except Exception:
                            return self.fail_response("add_connection: curveAnchor must have numeric x/y")
                    if isinstance(op.get('anchorParams'), dict):
                        ap = op['anchorParams']
                        try:
                            u = float(ap.get('u'))
                            v = float(ap.get('v'))
                        except Exception:
                            return self.fail_response("add_connection: anchorParams must have numeric u/v")
                        payload_conn['anchorParams'] = {'u': u, 'v': v}
                    if op.get('curveMode') is not None:
                        mode = op.get('curveMode')
                        if mode not in ('auto', 'tension', 'manual', 'orthogonal'):
                            return self.fail_response("add_connection: curveMode must be one of 'auto'|'tension'|'manual'|'orthogonal'")
                        payload_conn['curveMode'] = mode
                    if op.get('tension') is not None:
                        tv = _clamp_opacity(op.get('tension'))
                        if tv is None:
                            return self.fail_response("add_connection: tension must be a number (0..1)")
                        payload_conn['tension'] = tv
                    if op.get('style') in ('line', 'arrow'):
                        payload_conn['style'] = op.get('style')
                    if isinstance(op.get('dashed'), bool):
                        payload_conn['dashed'] = op.get('dashed')

                    conns.append(payload_conn)
                    applied.append({'op': 'add_connection', 'id': cid})

                elif kind == 'delete_connection':
                    cid = op.get('id')
                    before = len(conns)
                    conns = [c for c in conns if c.get('id') != cid]
                    applied.append({'op': 'delete_connection', 'id': cid, 'removed': before - len(conns)})

                elif kind == 'update_connection':
                    cid = op.get('id')
                    c = None
                    if cid:
                        c = find_conn(cid)
                    # Fallback: allow locating by endpoints when id unknown
                    if (c is None) and (('from' in op) and ('to' in op)):
                        def find_conn_by_endpoints(frm: str, to: str) -> Optional[Dict[str, Any]]:
                            for cc in conns:
                                if cc.get('from') == frm and cc.get('to') == to:
                                    return cc
                            return None
                        frm = op.get('from')
                        to = op.get('to')
                        if frm and to:
                            c = find_conn_by_endpoints(frm, to)
                    if not c:
                        return self.fail_response("update_connection: connection not found (provide valid 'id' or matching 'from'+'to')")
                    patch = op.get('patch') or {}
                    if not isinstance(patch, dict) or not patch:
                        return self.fail_response("update_connection requires non-empty 'patch'")
                    updated_any = False
                    # Label
                    if 'label' in patch:
                        c['label'] = patch.get('label')
                        updated_any = True
                    # Style flags
                    if 'style' in patch and patch.get('style') in ('line', 'arrow'):
                        c['style'] = patch.get('style')
                        updated_any = True
                    if 'dashed' in patch and isinstance(patch.get('dashed'), bool):
                        c['dashed'] = patch.get('dashed')
                        updated_any = True
                    # Curve anchor
                    if 'curveAnchor' in patch and isinstance(patch.get('curveAnchor'), dict):
                        ca = patch['curveAnchor']
                        try:
                            c['curveAnchor'] = {'x': float(ca.get('x')), 'y': float(ca.get('y'))}
                            updated_any = True
                        except Exception:
                            return self.fail_response("update_connection: curveAnchor must have numeric x/y")
                    # Anchor params (normalized mid-handle)
                    if 'anchorParams' in patch and isinstance(patch.get('anchorParams'), dict):
                        ap = patch['anchorParams']
                        try:
                            u = float(ap.get('u'))
                            v = float(ap.get('v'))
                        except Exception:
                            return self.fail_response("update_connection: anchorParams must have numeric u/v")
                        c['anchorParams'] = {'u': u, 'v': v}
                        updated_any = True
                    # Curve mode
                    if 'curveMode' in patch:
                        mode = patch.get('curveMode')
                        if mode not in (None, 'auto', 'tension', 'manual', 'orthogonal'):
                            return self.fail_response("update_connection: curveMode must be one of 'auto'|'tension'|'manual'|'orthogonal'")
                        if mode is not None:
                            c['curveMode'] = mode
                            updated_any = True
                    # Tension (0..1)
                    if 'tension' in patch:
                        tv = _clamp_opacity(patch.get('tension'))
                        if tv is None:
                            return self.fail_response("update_connection: tension must be a number (0..1)")
                        c['tension'] = tv
                        updated_any = True
                    # Endpoints: nodes or points (each side independent)
                    if ('from' in patch) or ('fromPoint' in patch):
                        frm = patch.get('from') if 'from' in patch else c.get('from')
                        fpt = patch.get('fromPoint') if 'fromPoint' in patch else c.get('fromPoint')
                        if frm and fpt:
                            return self.fail_response("update_connection: choose either 'from' (node id) or 'fromPoint', not both")
                        if frm:
                            if not node_exists(frm) or is_group_node_id(frm):
                                return self.fail_response("update_connection: 'from' must reference existing non-group node")
                            c['from'] = frm
                            c.pop('fromPoint', None)
                        elif isinstance(fpt, dict):
                            try:
                                c['fromPoint'] = {'x': float(fpt.get('x')), 'y': float(fpt.get('y'))}
                            except Exception:
                                return self.fail_response("update_connection: fromPoint must have numeric x/y")
                            c.pop('from', None)
                        else:
                            return self.fail_response("update_connection: provide valid 'from' or 'fromPoint'")
                        updated_any = True
                    if ('to' in patch) or ('toPoint' in patch):
                        to_val = patch.get('to') if 'to' in patch else c.get('to')
                        tpt = patch.get('toPoint') if 'toPoint' in patch else c.get('toPoint')
                        if to_val and tpt:
                            return self.fail_response("update_connection: choose either 'to' (node id) or 'toPoint', not both")
                        if to_val:
                            if not node_exists(to_val) or is_group_node_id(to_val):
                                return self.fail_response("update_connection: 'to' must reference existing non-group node")
                            c['to'] = to_val
                            c.pop('toPoint', None)
                        elif isinstance(tpt, dict):
                            try:
                                c['toPoint'] = {'x': float(tpt.get('x')), 'y': float(tpt.get('y'))}
                            except Exception:
                                return self.fail_response("update_connection: toPoint must have numeric x/y")
                            c.pop('to', None)
                        else:
                            return self.fail_response("update_connection: provide valid 'to' or 'toPoint'")
                        updated_any = True
                    # After endpoint updates, ensure both ends exist
                    if updated_any:
                        if not ((c.get('from') or c.get('fromPoint')) and (c.get('to') or c.get('toPoint'))):
                            return self.fail_response("update_connection: endpoints incomplete; ensure both ends are defined via node or point.")
                    if not updated_any:
                        return self.fail_response("update_connection patch contains no supported fields (label, style, dashed, curveAnchor, anchorParams, curveMode, tension, endpoints)")
                    applied.append({'op': 'update_connection', 'id': cid})

                elif kind == 'move_node':
                    nid = op.get('id')
                    n = find_node(nid)
                    if not n:
                        return self.fail_response(f"move_node: node not found: {nid}")
                    if 'x' in op:
                        n['x'] = op['x']
                    if 'y' in op:
                        n['y'] = op['y']
                    n['updatedAt'] = _now_ms()
                    applied.append({'op': 'move_node', 'id': nid})

                elif kind == 'apply_style':
                    nid = op.get('id')
                    patch = op.get('patch') or {}
                    n = find_node(nid)
                    if not n:
                        return self.fail_response(f"apply_style: node not found: {nid}")
                    # Canonicalize & clamp opacity for style patch
                    if 'opacity' in patch:
                        tv = _clamp_opacity(patch.get('opacity'))
                        if tv is not None:
                            ts = patch.get('textStyles') or {}
                            if not isinstance(ts, dict):
                                ts = {}
                            ts['opacity'] = tv
                            patch['textStyles'] = ts
                        patch.pop('opacity', None)
                    if isinstance(patch.get('textStyles'), dict) and 'opacity' in patch['textStyles']:
                        tv = _clamp_opacity(patch['textStyles'].get('opacity'))
                        if tv is not None:
                            patch['textStyles']['opacity'] = tv
                    n.update(patch)
                    n['updatedAt'] = _now_ms()
                    applied.append({'op': 'apply_style', 'id': nid})

                elif kind == 'relayout_mindmap':
                    gid = op.get('id') or op.get('group_id')
                    if not gid:
                        return self.fail_response("relayout_mindmap requires 'id' (group id)")
                    g = find_node(gid)
                    if not g or g.get('type') != 'group':
                        return self.fail_response(f"relayout_mindmap: group not found or not a group: {gid}")
                    patch = op.get('patch') or {}
                    if not isinstance(patch, dict) or not patch:
                        return self.fail_response("relayout_mindmap requires non-empty 'patch'")
                    # Optional: allow forcing groupMode to 'mindmap'
                    if 'groupMode' in patch:
                        if patch['groupMode'] not in ('mindmap', 'normal', None):
                            return self.fail_response("relayout_mindmap: groupMode must be 'mindmap' or 'normal'")
                        g['groupMode'] = patch['groupMode']
                    # Merge mindmap subfields; validate rootId if provided
                    if 'mindmap' in patch and isinstance(patch['mindmap'], dict):
                        mind = dict(g.get('mindmap') or {})
                        mm_patch = {k: v for k, v in patch['mindmap'].items()}
                        # Validate rootId existence when provided
                        if 'rootId' in mm_patch and mm_patch['rootId']:
                            if not node_exists(mm_patch['rootId']):
                                return self.fail_response(f"relayout_mindmap: rootId does not exist: {mm_patch['rootId']}")
                        mind.update(mm_patch)
                        g['mindmap'] = mind
                    # Touch updatedAt
                    g['updatedAt'] = _now_ms()
                    applied.append({'op': 'relayout_mindmap', 'id': gid})

                else:
                    return self.fail_response(f"Unsupported operation: {kind}")

            # Save back
            # Final contract validation before saving
            final_err = _final_validate(nodes, conns)
            if final_err:
                return self.fail_response(f"Validation failed: {final_err}")

            # Strip short‑lived media URL fields before persisting
            def _strip_media_signed_urls(ns: list[dict]) -> list[dict]:
                cleaned = []
                for n in ns:
                    try:
                        if isinstance(n, dict) and n.get('type') == 'media':
                            n.pop('fileUrl', None)
                            n.pop('fileDownloadUrl', None)
                            n.pop('localPath', None)
                    except Exception:
                        pass
                    cleaned.append(n)
                return cleaned

            doc['nodes'] = _strip_media_signed_urls(nodes)
            doc['connections'] = conns
            doc['updatedAt'] = _now_ms()
            server_version = await bump_canvas_server_version(
                target_canvas_id,
                doc.get('serverVersion') or doc.get('updatedAt'),
            )
            doc['serverVersion'] = server_version
            # bump version simple patch
            doc['version'] = str(doc.get('version', '1.0.0'))

            base_canvas = Canvas(
                id=target_canvas_id,
                workspace_id=account_id,
                title=base_doc.get('title') or row.get('title') or 'Untitled',
                version=str(base_doc.get('version') or row.get('version') or '1.0.0'),
                doc=base_doc,
            )
            saved_canvas = await UpdateCanvasUseCase(
                SupabaseCanvasRepository(self.db)
            ).execute(
                canvas=base_canvas,
                updates=doc,
                actor_id=None,
                event_payload={
                    "server_version": server_version,
                    "updated_at": doc.get("updatedAt"),
                },
            )
            new_row = {'doc': saved_canvas.doc}

            sync_status: Optional[str] = None
            if broadcast_canvas_ws:
                try:
                    sync_result = await self._write_service.sync_canvas_doc(
                        canvas_id=target_canvas_id,
                        workspace_id=account_id,
                        doc=doc,
                        updated_by=self.thread_id or "agent",
                        updated_at=doc.get('updatedAt') or _now_ms(),
                        server_version=server_version,
                    )
                    sync_status = sync_result.get("sync_status")
                    warnings.extend(sync_result.get("warnings", []))
                except Exception as sync_err:
                    sync_status = "degraded"
                    warn_msg = f"sync failed: {sync_err}"
                    warnings.append(warn_msg)
                    logger.warning(f"CanvasEditTool: sync failed for canvas {target_canvas_id}: {sync_err}")

            await self._log_ai_timeline(
                account_id=account_id,
                canvas_id=target_canvas_id,
                operations=operations,
                doc=doc,
                account_id_override=account_id_override,
                timeline_enabled=bool(row.get('timeline_enabled', False)),
            )
            if record_collaboration_ops:
                try:
                    await AppendCollaborationOperationsUseCase(
                        SupabaseCollaborationRepository(self.db)
                    ).execute(
                        session_id=f"agent:{self.thread_id}",
                        canvas_id=target_canvas_id,
                        workspace_id=account_id,
                        user_id=None,
                        operations=operations,
                        idempotency_key=None,
                    )
                except Exception as exc:
                    logger.warning(
                        f"collaboration ops append failed for canvas={target_canvas_id}: {exc}"
                    )
            return self.success_response({
                'applied': applied,
                'id_map': id_map,
                'canvas': new_row.get('doc', doc),
                'warnings': warnings,
                'sync_status': sync_status,
            })

        except Exception as e:
            logger.error(f"CanvasEditTool error: {e}")
            return self.fail_response(f"CanvasEditTool failed: {e}")

    @openapi_schema({
        "type": "function",
        "function": {
            "name": "canvas_edit",
            "description": "Alias of 'edit'. Apply operations to a canvas document (add/update/delete nodes, connections — including free-line endpoints and curvature anchors — move_node, apply_style, update_canvas, update_connection, relayout_mindmap).",
            "parameters": {
                "type": "object",
                "properties": {
                    "canvas_id": {"type": "string", "description": "Optional. Defaults to the canvas bound to this thread."},
                    "operations": {
                        "type": "array",
                        "items": {
                            "oneOf": [
                                { "type": "object", "properties": { "op": {"const": "update_node"}, "id": {"type": "string"}, "patch": {"type": "object"} }, "required": ["op","id","patch"] },
                                { "type": "object", "properties": { "op": {"const": "delete_node"}, "id": {"type": "string"} }, "required": ["op","id"] },
                                { "type": "object",
                                  "properties": {
                                    "op": {"const": "add_connection"},
                                    "from": {"type": "string"}, "to": {"type": "string"},
                                    "fromPoint": {"type": "object", "properties": {"x": {"type": "number"}, "y": {"type": "number"}}, "required": ["x","y"]},
                                    "toPoint": {"type": "object", "properties": {"x": {"type": "number"}, "y": {"type": "number"}}, "required": ["x","y"]},
                                    "label": {"type": "string"},
                                    "style": {"type": "string", "enum": ["line","arrow"]},
                                    "dashed": {"type": "boolean"},
                                    "curveAnchor": {"type": "object", "properties": {"x": {"type": "number"}, "y": {"type": "number"}}},
                                    "anchorParams": {"type": "object", "properties": {"u": {"type": "number"}, "v": {"type": "number"}}},
                                    "curveMode": {"type": "string", "enum": ["auto","tension","manual","orthogonal"]},
                                    "tension": {"type": "number"}
                                  },
                                  "required": ["op"],
                                  "oneOf": [ {"required": ["from","to"]}, {"required": ["fromPoint","toPoint"]} ]
                                },
                                { "type": "object", "properties": { "op": {"const": "delete_connection"}, "id": {"type": "string"} }, "required": ["op","id"] },
                                { "type": "object", "properties": { "op": {"const": "update_connection"}, "id": {"type": "string"}, "from": {"type": "string"}, "to": {"type": "string"}, "patch": {"type": "object"} }, "required": ["op","patch"] },
                                { "type": "object", "properties": { "op": {"const": "move_node"}, "id": {"type": "string"}, "x": {"type": "number"}, "y": {"type": "number"} }, "required": ["op","id"] },
                                { "type": "object", "properties": { "op": {"const": "apply_style"}, "id": {"type": "string"}, "patch": {"type": "object"} }, "required": ["op","id","patch"] },
                                { "type": "object", "properties": { "op": {"const": "update_canvas"}, "patch": {"type": "object"} }, "required": ["op","patch"] },
                                { "type": "object", "properties": { "op": {"const": "relayout_mindmap"}, "id": {"type": "string"}, "patch": {"type": "object"} }, "required": ["op","id","patch"] }
                            ]
                        }
                    },
                    "expected_version": {"type": "string"}
                },
                "required": ["operations"]
            }
        }
    })
    @usage_example(
        """
        {
          "tool_calls": [
            { "type": "function", "function": { "name": "canvas_edit", "arguments": {
              "operations": [
                {"op":"update_canvas","patch":{"title":"项目画布","textOpacityPreset":"dimmed"}},
                {"op":"add_connection","from":"node-1","to":"node-2","label":"引用","curveAnchor":{"x":420,"y":260},"style":"arrow"},
                {"op":"add_connection","fromPoint":{"x":100,"y":300},"toPoint":{"x":900,"y":300},"style":"line","dashed":true,"label":"X 轴"},
                {"op":"add_connection","fromPoint":{"x":500,"y":80},"toPoint":{"x":500,"y":740},"style":"line","dashed":true,"label":"Y 轴"},
                {"op":"relayout_mindmap","id":"group-1","patch":{"groupMode":"mindmap","mindmap":{"spacingX":96,"spacingY":30}}}
              ]
            } } }
          ]
        }
        """
    )
    async def canvas_edit(self, operations: List[Dict[str, Any]], canvas_id: Optional[str] = None, expected_version: Optional[str] = None) -> ToolResult:
        return await self.edit(
            canvas_id=canvas_id,
            operations=operations,
            expected_version=expected_version,
            broadcast_canvas_ws=True,
        )
