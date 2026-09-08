from __future__ import annotations

from typing import Optional, List, Dict
from fastapi import APIRouter, HTTPException, Request, Query, Header
from core.utils.logger import logger
from core.utils.auth_utils import resolve_user_and_workspace
from core.services.supabase import DBConnection
from datetime import datetime, timezone
import uuid
from .. import core_utils as utils
from .api_models import Folder, CreateFolderRequest, UpdateFolderRequest, FolderStats, FoldersListResponse
from core.workspace.service import bump_workspace_version_and_broadcast
from core.utils.config import config
from core.canvas.write_service import CanvasWriteService


router = APIRouter()

MAX_FOLDER_LEVELS = 3


async def _db():
    return await utils.db.client


async def _resolve_user_workspace(request: Request, token: Optional[str] = None) -> tuple[str, str]:
    return await resolve_user_and_workspace(request, token)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _now_ms() -> int:
    return int(datetime.now(timezone.utc).timestamp() * 1000)


async def _get_folder_map(client, workspace_id: str) -> Dict[str, dict]:
    res = await client.table('folders').select('*').eq('account_id', workspace_id).eq('is_deleted', False).execute()
    by_id: Dict[str, dict] = {}
    for r in (res.data or []):
        by_id[r['id']] = r
    return by_id


def _calc_level(folder_id: Optional[str], folders_by_id: Dict[str, dict]) -> int:
    level = 0
    cur = folder_id
    while cur:
        parent = folders_by_id.get(cur)
        if not parent:
            break
        cur = parent.get('parent_id')
        if cur:
            level += 1
    return level


def _would_create_cycle(folders_by_id: Dict[str, dict], folder_id: str, new_parent_id: Optional[str]) -> bool:
    cur = new_parent_id
    while cur:
        if cur == folder_id:
            return True
        rec = folders_by_id.get(cur)
        if not rec:
            break
        cur = rec.get('parent_id')
    return False


async def _compute_child_map(folders_by_id: Dict[str, dict]) -> Dict[str, List[str]]:
    children: Dict[str, List[str]] = {}
    for f in folders_by_id.values():
        pid = f.get('parent_id')
        if pid:
            children.setdefault(pid, []).append(f['id'])
    return children


async def _folder_to_model(folder_row: dict, folders_by_id: Dict[str, dict], canvas_ids_by_folder: Dict[str, List[str]]) -> Folder:
    child_map = await _compute_child_map(folders_by_id)
    fid = folder_row['id']
    # Robust timestamp parsing
    def _to_ms(v):
        if not v:
            return _now_ms()
        try:
            if isinstance(v, (int, float)):
                # assume ms
                return int(v)
            s = str(v)
            if s.endswith('Z'):
                s = s.replace('Z', '+00:00')
            return int(datetime.fromisoformat(s).timestamp() * 1000)
        except Exception:
            return _now_ms()
    return Folder(
        id=fid,
        name=folder_row['name'],
        parentId=folder_row.get('parent_id'),
        canvasIds=canvas_ids_by_folder.get(fid, []),
        childFolderIds=child_map.get(fid, []),
        level=_calc_level(folder_row.get('parent_id'), folders_by_id),
        isExpanded=bool(folder_row.get('is_expanded', False)),
        sortOrder=int(folder_row.get('sort_order') or 0),
        createdAt=_to_ms(folder_row.get('created_at')),
        updatedAt=_to_ms(folder_row.get('updated_at')),
    )


async def _scan_canvas_ids_by_folder(client, workspace_id: str) -> Dict[str, List[str]]:
    # Query canvases owned by workspace and group by doc.folderId
    res = await client.table('canvases').select('id, doc, account_id, is_deleted').eq('account_id', workspace_id).eq('is_deleted', False).execute()
    mapping: Dict[str, List[str]] = {}
    for r in (res.data or []):
        doc = r.get('doc')
        fid = None
        try:
            if isinstance(doc, dict):
                fid = doc.get('folderId')
            elif isinstance(doc, str):
                import json as _json
                parsed = _json.loads(doc)
                if isinstance(parsed, dict):
                    fid = parsed.get('folderId')
        except Exception:
            fid = None
        if fid:
            mapping.setdefault(fid, []).append(r['id'])
    return mapping


@router.get('/folders', response_model=FoldersListResponse)
async def list_folders(request: Request, token: Optional[str] = None):
    user_id, workspace_id = await _resolve_user_workspace(request, token)
    client = await _db()
    try:
        folders_by_id = await _get_folder_map(client, workspace_id)
        canvas_ids_by_folder = await _scan_canvas_ids_by_folder(client, workspace_id)
        folders: List[Folder] = []
        for row in folders_by_id.values():
            folders.append(await _folder_to_model(row, folders_by_id, canvas_ids_by_folder))

        # Build a simple root-only tree (compat field; frontend builds rich tree itself)
        root_folder_ids = [f.id for f in folders if not f.parentId]
        tree = [f.dict() for f in folders if f.id in root_folder_ids]
        metadata = {
            'version': '1.0.0',
            'totalFolders': len(folders),
            'lastUpdated': _now_ms(),
        }
        return FoldersListResponse(folders=folders, tree=tree, metadata=metadata)
    except Exception as e:
        logger.error(f"Error listing folders: {e}")
        raise HTTPException(status_code=500, detail='Failed to list folders')


@router.post('/folders', response_model=Folder)
async def create_folder(
    payload: CreateFolderRequest,
    request: Request,
    token: Optional[str] = None,
    client_request_id: Optional[str] = Header(default=None, alias="X-Client-Request-Id"),
):
    user_id, workspace_id = await _resolve_user_workspace(request, token)
    client = await _db()
    try:
        folders_by_id = await _get_folder_map(client, workspace_id)
        parent_id = payload.parentId
        if parent_id and parent_id not in folders_by_id:
            raise HTTPException(status_code=400, detail=f'父文件夹 {parent_id} 不存在')

        level = _calc_level(parent_id, folders_by_id)
        if level >= MAX_FOLDER_LEVELS:
            raise HTTPException(status_code=400, detail=f'文件夹层级超出限制，最大层级为 {MAX_FOLDER_LEVELS}')

        # Use UUID to avoid primary key collisions on rapid creation
        folder_id = f"folder_{uuid.uuid4().hex}"
        row = {
            'id': folder_id,
            'account_id': workspace_id,
            'name': (payload.name or '').strip() or '新建文件夹',
            'parent_id': parent_id,
            'is_expanded': False,
            'sort_order': payload.sortOrder or int(datetime.now(timezone.utc).timestamp() * 1000),
            'is_deleted': False,
            'created_at': _now_iso(),
            'updated_at': _now_iso(),
        }
        saved = await client.table('folders').insert(row).execute()
        saved_row = saved.data[0] if saved.data else row
        canvas_ids_by_folder = await _scan_canvas_ids_by_folder(client, workspace_id)
        folder_model = await _folder_to_model(saved_row, await _get_folder_map(client, workspace_id), canvas_ids_by_folder)
        try:
            change_data = folder_model.dict()
            if client_request_id:
                change_data['clientRequestId'] = client_request_id
            await bump_workspace_version_and_broadcast(
                workspace_id,
                changes=[{'entity': 'folder', 'action': 'create', 'data': change_data}],
                actor_id=user_id,
                request_id=client_request_id,
            )
        except Exception as e:
            logger.warning(f"Failed to bump workspace version after folder create: {e}")
        return folder_model
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating folder: {e}")
        raise HTTPException(status_code=500, detail='创建文件夹失败')


@router.put('/folders/{folder_id}', response_model=Folder)
async def update_folder(
    folder_id: str,
    payload: UpdateFolderRequest,
    request: Request,
    token: Optional[str] = None,
    client_request_id: Optional[str] = Header(default=None, alias="X-Client-Request-Id"),
):
    user_id, workspace_id = await _resolve_user_workspace(request, token)
    client = await _db()
    try:
        folders_by_id = await _get_folder_map(client, workspace_id)
        row = folders_by_id.get(folder_id)
        if not row:
            raise HTTPException(status_code=404, detail='文件夹不存在')

        update_row = {}
        if payload.name is not None:
            name = payload.name.strip()
            if not name:
                raise HTTPException(status_code=400, detail='文件夹名称不能为空')
            update_row['name'] = name
        if payload.isExpanded is not None:
            update_row['is_expanded'] = bool(payload.isExpanded)
        if payload.sortOrder is not None:
            update_row['sort_order'] = int(payload.sortOrder)
        if payload.parentId is not None:
            new_parent = payload.parentId
            if new_parent and new_parent not in folders_by_id:
                raise HTTPException(status_code=400, detail=f'父文件夹 {new_parent} 不存在')
            if _would_create_cycle(folders_by_id, folder_id, new_parent):
                raise HTTPException(status_code=400, detail='不能将文件夹移动到其子树内（将产生循环依赖）')
            # Check depth limit
            new_level = _calc_level(new_parent, folders_by_id)
            if new_level >= MAX_FOLDER_LEVELS:
                raise HTTPException(status_code=400, detail=f'文件夹层级超出限制，最大层级为 {MAX_FOLDER_LEVELS}')
            update_row['parent_id'] = new_parent

        if not update_row:
            # Nothing to update
            update_row['updated_at'] = _now_iso()
        else:
            update_row['updated_at'] = _now_iso()

        saved = await client.table('folders').update(update_row).eq('id', folder_id).eq('account_id', workspace_id).execute()
        saved_row = saved.data[0] if saved.data else {**row, **update_row}
        canvas_ids_by_folder = await _scan_canvas_ids_by_folder(client, workspace_id)
        folder_model = await _folder_to_model(saved_row, await _get_folder_map(client, workspace_id), canvas_ids_by_folder)
        try:
            # only bump if affecting structure; name/parentId/sortOrder changes should reflect in workspace list
            if any(k in update_row for k in ('name','parent_id','sort_order')):
                change_data = folder_model.dict()
                if 'parent_id' in update_row and row.get('parent_id') != update_row.get('parent_id'):
                    change_data['oldParentId'] = row.get('parent_id')
                if client_request_id:
                    change_data['clientRequestId'] = client_request_id
                await bump_workspace_version_and_broadcast(
                    workspace_id,
                    changes=[{'entity': 'folder', 'action': 'update', 'data': change_data}],
                    actor_id=user_id,
                    request_id=client_request_id,
                )
        except Exception as e:
            logger.warning(f"Failed to bump workspace version after folder update: {e}")
        return folder_model
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating folder {folder_id}: {e}")
        raise HTTPException(status_code=500, detail='更新文件夹失败')


@router.delete('/folders/{folder_id}')
async def delete_folder(
    folder_id: str,
    request: Request,
    token: Optional[str] = None,
    moveCanvasesToParent: Optional[bool] = Query(True),
    client_request_id: Optional[str] = Header(default=None, alias="X-Client-Request-Id"),
):
    user_id, workspace_id = await _resolve_user_workspace(request, token)
    client = await _db()
    write_service = CanvasWriteService() if config.CANVAS_REALTIME_WRITE_ENABLED else None
    try:
        folders_by_id = await _get_folder_map(client, workspace_id)
        row = folders_by_id.get(folder_id)
        if not row:
            raise HTTPException(status_code=404, detail='文件夹不存在')

        # check child folders
        child_exists = any(f.get('parent_id') == folder_id for f in folders_by_id.values())
        if child_exists:
            raise HTTPException(status_code=400, detail='文件夹不为空，请先删除或移动子文件夹')

        # canvases in folder
        canvas_ids_by_folder = await _scan_canvas_ids_by_folder(client, workspace_id)
        canvases = canvas_ids_by_folder.get(folder_id, [])
        if canvases:
            if moveCanvasesToParent:
                parent_id = row.get('parent_id')
                # move canvases to parent (or root if None)
                for cid in canvases:
                    if write_service:
                        try:
                            patch = {"folderId": parent_id} if parent_id else {"folderId": None}
                            await write_service.apply_canvas_ops(
                                canvas_id=cid,
                                workspace_id=workspace_id,
                                operations=[{"op": "update_canvas", "patch": patch}],
                                user_id=user_id,
                            )
                        except Exception as e:
                            logger.warning(f"[folders] realtime move canvas failed for {cid}: {e}")
                        continue

                    # legacy direct DB update fallback
                    cres = await client.table('canvases').select('*').eq('id', cid).eq('account_id', workspace_id).limit(1).execute()
                    if not cres.data:
                        continue
                    crow = cres.data[0]
                    cdoc = crow.get('doc') or {}
                    if parent_id:
                        cdoc['folderId'] = parent_id
                    else:
                        cdoc.pop('folderId', None)
                    await client.table('canvases').update({'doc': cdoc, 'updated_at': _now_iso()}).eq('id', cid).eq('account_id', workspace_id).execute()
            else:
                raise HTTPException(status_code=400, detail='文件夹包含Canvas文件，请先移动或删除文件')

        await client.table('folders').update({'is_deleted': True, 'updated_at': _now_iso()}).eq('id', folder_id).eq('account_id', workspace_id).execute()
        try:
            change_data = {
                'id': folder_id,
                'parentId': row.get('parent_id'),
                'canvasIds': canvases,
                'moveCanvasesToParent': moveCanvasesToParent,
            }
            if client_request_id:
                change_data['clientRequestId'] = client_request_id
            await bump_workspace_version_and_broadcast(
                workspace_id,
                changes=[{'entity': 'folder', 'action': 'delete', 'data': change_data}],
                actor_id=user_id,
                request_id=client_request_id,
            )
        except Exception as e:
            logger.warning(f"Failed to bump workspace version after folder delete: {e}")
        return {'success': True, 'message': '文件夹删除成功'}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting folder {folder_id}: {e}")
        raise HTTPException(status_code=500, detail='删除文件夹失败')


@router.post('/folders/{folder_id}/canvases/{canvas_id}')
async def move_canvas_to_folder(
    folder_id: str,
    canvas_id: str,
    request: Request,
    token: Optional[str] = None,
    client_request_id: Optional[str] = Header(default=None, alias="X-Client-Request-Id"),
):
    user_id, workspace_id = await _resolve_user_workspace(request, token)
    client = await _db()
    try:
        # ensure folder exists
        fres = await client.table('folders').select('id').eq('id', folder_id).eq('account_id', workspace_id).eq('is_deleted', False).limit(1).execute()
        if not fres.data:
            raise HTTPException(status_code=404, detail=f'目标文件夹不存在: {folder_id}')

        if config.CANVAS_REALTIME_WRITE_ENABLED:
            write_service = CanvasWriteService()
            await write_service.apply_canvas_ops(
                canvas_id=canvas_id,
                workspace_id=workspace_id,
                operations=[{"op": "update_canvas", "patch": {"folderId": folder_id}}],
                user_id=user_id,
            )
        else:
            # update canvas doc (legacy direct DB write)
            cres = await client.table('canvases').select('*').eq('id', canvas_id).eq('account_id', workspace_id).eq('is_deleted', False).limit(1).execute()
            if not cres.data:
                raise HTTPException(status_code=404, detail='画布不存在')
            crow = cres.data[0]
            cdoc = crow.get('doc') or {}
            cdoc['folderId'] = folder_id
            await client.table('canvases').update({'doc': cdoc, 'updated_at': _now_iso()}).eq('id', canvas_id).eq('account_id', workspace_id).execute()
        try:
            if not config.CANVAS_REALTIME_WRITE_ENABLED:
                await bump_workspace_version_and_broadcast(
                    workspace_id,
                    changes=[{
                        'entity': 'canvas',
                        'action': 'move',
                        'data': {
                            'id': canvas_id,
                            'toFolderId': folder_id,
                            **({'clientRequestId': client_request_id} if client_request_id else {}),
                        },
                    }],
                    actor_id=user_id,
                    request_id=client_request_id,
                )
        except Exception as e:
            logger.warning(f"Failed to bump workspace version after move canvas: {e}")
        return {'success': True, 'message': 'Canvas文件移动成功', 'data': {'canvasId': canvas_id, 'folderId': folder_id}}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error moving canvas {canvas_id} to folder {folder_id}: {e}")
        raise HTTPException(status_code=500, detail='Canvas文件移动失败')


@router.delete('/folders/{folder_id}/canvases/{canvas_id}')
async def remove_canvas_from_folder(
    folder_id: str,
    canvas_id: str,
    request: Request,
    token: Optional[str] = None,
    client_request_id: Optional[str] = Header(default=None, alias="X-Client-Request-Id"),
):
    user_id, workspace_id = await _resolve_user_workspace(request, token)
    client = await _db()
    try:
        if config.CANVAS_REALTIME_WRITE_ENABLED:
            # Best-effort: validate current folder matches before clearing to keep semantics.
            cres = await client.table('canvases').select('doc').eq('id', canvas_id).eq('account_id', workspace_id).eq('is_deleted', False).limit(1).execute()
            if not cres.data:
                raise HTTPException(status_code=404, detail='画布不存在')
            cdoc = cres.data[0].get('doc') or {}
            if cdoc.get('folderId') != folder_id:
                raise HTTPException(status_code=404, detail='Canvas文件不在此文件夹中')

            write_service = CanvasWriteService()
            await write_service.apply_canvas_ops(
                canvas_id=canvas_id,
                workspace_id=workspace_id,
                operations=[{"op": "update_canvas", "patch": {"folderId": None}}],
                user_id=user_id,
            )
            return {'success': True, 'message': 'Canvas文件移除成功'}

        cres = await client.table('canvases').select('*').eq('id', canvas_id).eq('account_id', workspace_id).eq('is_deleted', False).limit(1).execute()
        if not cres.data:
            raise HTTPException(status_code=404, detail='画布不存在')
        crow = cres.data[0]
        cdoc = crow.get('doc') or {}
        # only clear if current folder matches
        if cdoc.get('folderId') == folder_id:
            cdoc.pop('folderId', None)
            await client.table('canvases').update({'doc': cdoc, 'updated_at': _now_iso()}).eq('id', canvas_id).eq('account_id', workspace_id).execute()
            try:
                await bump_workspace_version_and_broadcast(
                    workspace_id,
                    changes=[{
                        'entity': 'canvas',
                        'action': 'move',
                        'data': {
                            'id': canvas_id,
                            'toFolderId': None,
                            **({'clientRequestId': client_request_id} if client_request_id else {}),
                        },
                    }],
                    actor_id=user_id,
                    request_id=client_request_id,
                )
            except Exception as e:
                logger.warning(f"Failed to bump workspace version after remove canvas: {e}")
            return {'success': True, 'message': 'Canvas文件移除成功'}
        else:
            raise HTTPException(status_code=404, detail='Canvas文件不在此文件夹中')
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error removing canvas {canvas_id} from folder {folder_id}: {e}")
        raise HTTPException(status_code=500, detail='移除Canvas文件失败')


@router.get('/folders/stats', response_model=FolderStats)
async def folder_stats(request: Request, token: Optional[str] = None):
    user_id, workspace_id = await _resolve_user_workspace(request, token)
    client = await _db()
    try:
        folders_by_id = await _get_folder_map(client, workspace_id)
        try:
            canvas_ids_by_folder = await _scan_canvas_ids_by_folder(client, workspace_id)
        except Exception as e:
            logger.warning(f"scan_canvas_ids_by_folder failed, fallback empty mapping: {e}")
            canvas_ids_by_folder = {}
        folders = list(folders_by_id.values())
        folders_by_level: Dict[int, int] = {}
        deepest = 0
        for f in folders:
            try:
                lvl = _calc_level(f.get('parent_id'), folders_by_id)
            except Exception:
                lvl = 0
            deepest = max(deepest, lvl)
            folders_by_level[lvl] = folders_by_level.get(lvl, 0) + 1
        total_canvases = sum(len(v) for v in canvas_ids_by_folder.values())
        return FolderStats(totalFolders=len(folders), totalCanvases=total_canvases, foldersByLevel=folders_by_level, deepestLevel=deepest)
    except Exception as e:
        logger.error(f"Error computing folder stats: {e}")
        # Return safe defaults instead of 500 to avoid breaking UI
        return FolderStats(totalFolders=0, totalCanvases=0, foldersByLevel={}, deepestLevel=0)
