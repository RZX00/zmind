import asyncio
import uuid
from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form, Request
from pydantic import BaseModel, Field, validator
from core.utils.auth_utils import resolve_user_and_workspace, require_agent_access, AuthorizedAgentAccess
from core.services.supabase import DBConnection
from core.knowledge_base.file_processor import FileProcessor
from core.billing.config import get_storage_limits
from core.billing import entitlements
from core.services.r2_storage import get_object_bytes
from core.utils.logger import logger
from core.utils.idempotency import get_idempotency_key, normalize_idempotency_key
from core.utils.errors import raise_api_error, raise_file_removed
from core.knowledge_base.file_jobs import process_kb_file_job
from core.services import metrics
from .validation import FileNameValidator, ValidationError, validate_folder_name_unique, validate_file_name_unique_in_folder

router = APIRouter(prefix="/knowledge-base", tags=["knowledge-base"])
KB_FILE_LINK_TYPE = "kb_entry"

async def _get_storage_usage_bytes(account_id: str, client) -> int:
    resp = await client.table("file_uploads") \
        .select("file_size, status") \
        .eq("account_id", account_id) \
        .is_("deleted_at", "null") \
        .execute()
    rows = resp.data or []
    valid_statuses = {"uploaded", "processing", "ready", ""}
    total = 0
    for row in rows:
        status = (row.get("status") or "").lower()
        if status not in valid_statuses:
            continue
        total += int(row.get("file_size") or 0)
    return total


# Helper function to check total file size limit
async def check_total_file_size_limit(account_id: str, new_file_size: int):
    """Check if adding a new file would exceed the total file size limit."""
    try:
        client = await DBConnection().client
        tier_info = await entitlements.get_user_subscription_tier(account_id)
        limits = get_storage_limits(tier_info["name"])

        if new_file_size > limits.max_file_bytes:
            raise_api_error(
                413,
                "File exceeds per-file limit",
                error_code="KB_FILE_TOO_LARGE",
                retryable=False,
            )

        used_bytes = await _get_storage_usage_bytes(account_id, client)
        if used_bytes + new_file_size > limits.max_total_bytes:
            raise_api_error(
                402,
                "Storage quota exceeded",
                error_code="KB_STORAGE_QUOTA_EXCEEDED",
                retryable=False,
            )
            
        return True
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error checking file size limit: {str(e)}")
        raise_api_error(
            500,
            "Failed to check file size limit",
            error_code="KB_STORAGE_CHECK_FAILED",
            retryable=True,
        )

# Models
class FolderRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    
    @validator('name')
    def validate_folder_name(cls, v):
        is_valid, error_message = FileNameValidator.validate_name(v, "folder")
        if not is_valid:
            raise ValueError(error_message)
        return FileNameValidator.sanitize_name(v)

class UpdateFolderRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    
    @validator('name')
    def validate_folder_name(cls, v):
        if v is not None:
            is_valid, error_message = FileNameValidator.validate_name(v, "folder")
            if not is_valid:
                raise ValueError(error_message)
            return FileNameValidator.sanitize_name(v)
        return v

class FolderResponse(BaseModel):
    folder_id: str
    name: str
    description: Optional[str]
    entry_count: int
    created_at: str

class EntryResponse(BaseModel):
    entry_id: str
    filename: str
    summary: str
    file_size: int
    created_at: str

class UpdateEntryRequest(BaseModel):
    summary: str = Field(..., min_length=1, max_length=1000)

class AgentAssignmentRequest(BaseModel):
    folder_ids: List[str]

db = DBConnection()
file_processor = FileProcessor()


async def _get_file_record_by_id(client, file_id: str, account_id: Optional[str]) -> Optional[dict]:
    try:
        query = client.table('file_uploads') \
            .select('id, storage_provider, storage_bucket, storage_path, content_type, original_filename, file_size, status, account_id, metadata') \
            .eq('id', file_id)
        if account_id:
            query = query.eq('account_id', account_id)
        resp = await query.limit(1).execute()
        if resp.data:
            return resp.data[0]
    except Exception as e:
        logger.warning(f"[kb] file_uploads lookup failed: {e}")
    return None


async def _get_linked_file_record(client, entry_id: str, account_id: str) -> Optional[dict]:
    try:
        link = await client.table('file_links') \
            .select('file_id') \
            .eq('entity_type', KB_FILE_LINK_TYPE) \
            .eq('entity_id', entry_id) \
            .limit(1) \
            .execute()
        if link.data:
            file_id = link.data[0].get('file_id')
            if file_id:
                return await _get_file_record_by_id(client, file_id, account_id)
    except Exception as e:
        logger.warning(f"[kb] file_links lookup failed: {e}")
    return None


async def _fetch_file_bytes(client, record: dict) -> bytes:
    provider = record.get('storage_provider') or 'supabase'
    key = record.get('storage_path')
    if not key:
        return b""
    if provider == 'r2':
        return await asyncio.to_thread(get_object_bytes, key)
    raise_file_removed("FILE_REMOVED")


async def _maybe_cleanup_file_upload(client, file_id: str) -> None:
    try:
        remaining = await client.table('file_links') \
            .select('id') \
            .eq('file_id', file_id) \
            .limit(1) \
            .execute()
        if remaining.data:
            return
        record = await _get_file_record_by_id(client, file_id, account_id=None)
    except Exception:
        record = None

    if not record:
        return
    provider = record.get('storage_provider') or 'supabase'
    key = record.get('storage_path')
    if not key:
        return
    try:
        if provider == 'r2':
            from core.services.r2_storage import get_r2_client, get_r2_bucket
            r2 = get_r2_client()
            r2.delete_object(Bucket=get_r2_bucket(), Key=key)
        else:
            await client.table('file_uploads').update({
                'deleted_at': datetime.now(timezone.utc).isoformat(),
                'status': 'deleted',
            }).eq('id', file_id).execute()
            return
        await client.table('file_uploads').update({
            'deleted_at': datetime.now(timezone.utc).isoformat(),
            'status': 'deleted',
        }).eq('id', file_id).execute()
    except Exception as e:
        logger.warning(f"[kb] file cleanup failed for {file_id}: {e}")

# Folder management
@router.get("/folders", response_model=List[FolderResponse])
async def get_folders(user_workspace: tuple[str, str] = Depends(resolve_user_and_workspace)):
    """Get all knowledge base folders for user."""
    try:
        client = await db.client
        user_id, account_id = user_workspace
        
        result = await client.table('knowledge_base_folders').select(
            'folder_id, name, description, created_at'
        ).eq('account_id', account_id).order('created_at', desc=True).execute()
        
        folders = []
        for folder_data in result.data:
            # Count entries in folder
            count_result = await client.table('knowledge_base_entries').select(
                'entry_id', count='exact'
            ).eq('folder_id', folder_data['folder_id']).execute()
            
            folders.append(FolderResponse(
                folder_id=folder_data['folder_id'],
                name=folder_data['name'],
                description=folder_data['description'],
                entry_count=count_result.count or 0,
                created_at=folder_data['created_at']
            ))
        
        return folders
        
    except Exception as e:
        logger.error(f"Error getting folders: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to retrieve folders")

@router.post("/folders", response_model=FolderResponse)
async def create_folder(
    folder_data: FolderRequest,
    user_workspace: tuple[str, str] = Depends(resolve_user_and_workspace)
):
    """Create a new knowledge base folder."""
    try:
        client = await db.client
        user_id, account_id = user_workspace
        
        # Get existing folder names to check for conflicts
        existing_result = await client.table('knowledge_base_folders').select('name').eq('account_id', account_id).execute()
        existing_names = [folder['name'] for folder in existing_result.data]
        
        # Generate unique name if there's a conflict
        final_name = FileNameValidator.generate_unique_name(folder_data.name, existing_names, "folder")
        
        insert_data = {
            'account_id': account_id,
            'name': final_name,
            'description': folder_data.description
        }
        
        result = await client.table('knowledge_base_folders').insert(insert_data).execute()
        
        if not result.data:
            raise HTTPException(status_code=500, detail="Failed to create folder")
        
        created_folder = result.data[0]
        
        return FolderResponse(
            folder_id=created_folder['folder_id'],
            name=created_folder['name'],
            description=created_folder['description'],
            entry_count=0,
            created_at=created_folder['created_at']
        )
        
    except ValidationError:
        raise
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating folder: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to create folder")

@router.put("/folders/{folder_id}", response_model=FolderResponse)
async def update_folder(
    folder_id: str,
    folder_data: UpdateFolderRequest,
    user_workspace: tuple[str, str] = Depends(resolve_user_and_workspace)
):
    """Update a knowledge base folder."""
    try:
        client = await db.client
        user_id, account_id = user_workspace
        
        # Verify ownership and get current folder
        folder_result = await client.table('knowledge_base_folders').select(
            'folder_id, name, description, created_at'
        ).eq('folder_id', folder_id).eq('account_id', account_id).execute()
        
        if not folder_result.data:
            raise HTTPException(status_code=404, detail="Folder not found")
        
        current_folder = folder_result.data[0]
        
        # Build update data with only provided fields
        update_data = {}
        if folder_data.name is not None:
            # Validate name uniqueness (excluding current folder)
            await validate_folder_name_unique(folder_data.name, account_id, folder_id)
            update_data['name'] = folder_data.name
        if folder_data.description is not None:
            update_data['description'] = folder_data.description
            
        # If no fields to update, return current folder
        if not update_data:
            # Count entries in folder
            count_result = await client.table('knowledge_base_entries').select(
                'entry_id', count='exact'
            ).eq('folder_id', folder_id).execute()
            
            return FolderResponse(
                folder_id=current_folder['folder_id'],
                name=current_folder['name'],
                description=current_folder['description'],
                entry_count=count_result.count or 0,
                created_at=current_folder['created_at']
            )
        
        # Update folder
        result = await client.table('knowledge_base_folders').update(
            update_data
        ).eq('folder_id', folder_id).execute()
        
        if not result.data:
            raise HTTPException(status_code=500, detail="Failed to update folder")
        
        updated_folder = result.data[0]
        
        # Count entries in folder
        count_result = await client.table('knowledge_base_entries').select(
            'entry_id', count='exact'
        ).eq('folder_id', folder_id).execute()
        
        return FolderResponse(
            folder_id=updated_folder['folder_id'],
            name=updated_folder['name'],
            description=updated_folder['description'],
            entry_count=count_result.count or 0,
            created_at=updated_folder['created_at']
        )
        
    except ValidationError:
        raise
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating folder: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to update folder")

@router.delete("/folders/{folder_id}")
async def delete_folder(
    folder_id: str,
    user_workspace: tuple[str, str] = Depends(resolve_user_and_workspace)
):
    """Delete a knowledge base folder and all its entries."""
    try:
        client = await db.client
        user_id, account_id = user_workspace
        
        # Verify ownership
        folder_result = await client.table('knowledge_base_folders').select(
            'folder_id'
        ).eq('folder_id', folder_id).eq('account_id', account_id).execute()
        
        if not folder_result.data:
            raise HTTPException(status_code=404, detail="Folder not found")
        
        # Get all entries in the folder to delete their files
        entries_result = await client.table('knowledge_base_entries').select(
            'entry_id, file_path'
        ).eq('folder_id', folder_id).execute()

        linked_file_ids: List[str] = []
        if entries_result.data:
            for entry in entries_result.data:
                entry_id = entry.get('entry_id')
                if not entry_id:
                    continue
                record = await _get_linked_file_record(client, entry_id, account_id)
                if record and record.get('id'):
                    linked_file_ids.append(str(record.get('id')))

        if entries_result.data:
            entry_ids = [entry.get('entry_id') for entry in entries_result.data if entry.get('entry_id')]
            if entry_ids:
                try:
                    await client.table('file_links') \
                        .delete() \
                        .eq('entity_type', KB_FILE_LINK_TYPE) \
                        .in_('entity_id', entry_ids) \
                        .execute()
                except Exception as e:
                    logger.warning(f"[kb] failed to remove file links: {e}")

        for fid in linked_file_ids:
            await _maybe_cleanup_file_upload(client, fid)
        
        # Delete folder (cascade will handle entries and assignments in DB)
        await client.table('knowledge_base_folders').delete().eq('folder_id', folder_id).execute()
        
        return {"success": True}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting folder: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to delete folder")

# File upload
@router.post("/folders/{folder_id}/upload")
async def upload_file(
    folder_id: str,
    file: Optional[UploadFile] = File(None),
    file_id: Optional[str] = Form(None),
    request: Request = None,
    user_workspace: tuple[str, str] = Depends(resolve_user_and_workspace)
):
    """Upload a file to a knowledge base folder."""
    try:
        client = await db.client
        user_id, account_id = user_workspace

        idempotency_key = get_idempotency_key(request) if request else None
        if not idempotency_key and file_id:
            idempotency_key = normalize_idempotency_key(f"kb:{folder_id}:{file_id}")
        upload_request_id = None
        
        # Verify folder ownership
        folder_result = await client.table('knowledge_base_folders').select(
            'folder_id'
        ).eq('folder_id', folder_id).eq('account_id', account_id).execute()
        
        if not folder_result.data:
            raise_api_error(
                404,
                "Folder not found",
                error_code="KB_FOLDER_NOT_FOUND",
                retryable=False,
            )

        async def _build_duplicate_response(existing_entry_id: str) -> dict:
            entry_resp = await client.table('knowledge_base_entries').select(
                'entry_id, filename, summary, file_size'
            ).eq('entry_id', existing_entry_id).limit(1).execute()
            entry_row = entry_resp.data[0] if entry_resp.data else {}
            link_resp = await client.table('file_links').select('file_id').eq(
                'entity_type', KB_FILE_LINK_TYPE
            ).eq('entity_id', existing_entry_id).limit(1).execute()
            file_id_value = None
            if link_resp.data:
                file_id_value = link_resp.data[0].get('file_id')
            summary = entry_row.get('summary') or ''
            return {
                "success": True,
                "duplicate": True,
                "entry_id": entry_row.get('entry_id') or existing_entry_id,
                "filename": entry_row.get('filename'),
                "summary_length": len(summary),
                "file_id": file_id_value,
            }

        if idempotency_key:
            try:
                req_insert = await client.table('kb_upload_requests').insert({
                    'account_id': account_id,
                    'folder_id': folder_id,
                    'idempotency_key': idempotency_key,
                    'status': 'processing',
                }).execute()
                if req_insert.data:
                    upload_request_id = req_insert.data[0].get('request_id')
                else:
                    raise RuntimeError("kb_upload_requests insert failed")
            except Exception:
                existing_req = await client.table('kb_upload_requests').select(
                    'entry_id, status'
                ).eq('account_id', account_id).eq('idempotency_key', idempotency_key).limit(1).execute()
                if existing_req.data:
                    row = existing_req.data[0]
                    if row.get('entry_id'):
                        metrics.incr("kb.upload.idempotency_hit", 1)
                        return await _build_duplicate_response(row['entry_id'])
                    raise_api_error(
                        409,
                        "Upload is already in progress for this idempotency key",
                        error_code="KB_UPLOAD_IN_PROGRESS",
                        retryable=True,
                    )
                logger.warning(
                    "[kb] idempotency lock failed; proceeding without dedupe",
                    account_id=account_id,
                    folder_id=folder_id,
                )

        if file_id:
            try:
                uuid.UUID(file_id)
            except Exception:
                raise_api_error(
                    400,
                    "Invalid file_id",
                    error_code="KB_FILE_ID_INVALID",
                    retryable=False,
                )

            record = await _get_file_record_by_id(client, file_id, account_id)
            if not record or record.get('status') not in (None, 'uploaded', 'processing', 'ready'):
                raise_api_error(
                    400,
                    "File is not available for knowledge base",
                    error_code="KB_FILE_NOT_READY",
                    retryable=True,
                )
            if (record.get('storage_provider') or '').lower() not in ('r2',):
                raise_file_removed("FILE_REMOVED")
            if not record.get('storage_path'):
                raise_api_error(
                    400,
                    "File storage path is missing",
                    error_code="KB_FILE_STORAGE_MISSING",
                    retryable=False,
                )

            original_name = record.get('original_filename') or 'file'
            is_valid, error_message = FileNameValidator.validate_name(original_name, "file")
            if not is_valid:
                original_name = FileNameValidator.sanitize_name(original_name)

            final_filename = await validate_file_name_unique_in_folder(original_name, folder_id)
            try:
                file_content = await _fetch_file_bytes(client, record)
            except Exception as e:
                message = str(e)
                if "NoSuchKey" in message or "not found" in message.lower():
                    try:
                        metadata = record.get("metadata") or {}
                        if isinstance(metadata, str):
                            metadata = {}
                        metadata.update({
                            "missing_object": True,
                            "missing_object_at": datetime.now(timezone.utc).isoformat(),
                        })
                        await client.table("file_uploads").update({
                            "status": "failed",
                            "metadata": metadata,
                        }).eq("id", file_id).execute()
                    except Exception:
                        pass
                    raise_api_error(
                        409,
                        "File missing in storage. Please re-upload and try again.",
                        error_code="KB_FILE_MISSING",
                        retryable=True,
                    )
                raise
            if not file_content and int(record.get('file_size') or 0) > 0:
                try:
                    metadata = record.get("metadata") or {}
                    if isinstance(metadata, str):
                        metadata = {}
                    metadata.update({
                        "missing_object": True,
                        "missing_object_at": datetime.now(timezone.utc).isoformat(),
                    })
                    await client.table("file_uploads").update({
                        "status": "failed",
                        "metadata": metadata,
                    }).eq("id", file_id).execute()
                except Exception:
                    pass
                raise_api_error(
                    409,
                    "File missing in storage. Please re-upload and try again.",
                    error_code="KB_FILE_MISSING",
                    retryable=True,
                )
            result = await file_processor.process_existing_file(
                account_id=account_id,
                folder_id=folder_id,
                file_id=file_id,
                filename=final_filename,
                mime_type=record.get('content_type') or 'application/octet-stream',
                file_size=int(record.get('file_size') or 0),
                storage_path=record.get('storage_path') or '',
                file_content=file_content,
                user_id=user_id,
                idempotency_key=idempotency_key,
            )

            if final_filename != original_name:
                result['filename_changed'] = True
                result['original_filename'] = original_name
                result['final_filename'] = final_filename
        else:
            if not file or not file.filename:
                raise ValidationError("Filename is required")

            is_valid, error_message = FileNameValidator.validate_name(file.filename, "file")
            if not is_valid:
                raise ValidationError(error_message)

            # Read file content
            file_content = await file.read()

            # Check total file size limit before processing
            await check_total_file_size_limit(account_id, len(file_content))

            # Generate unique filename if there's a conflict
            final_filename = await validate_file_name_unique_in_folder(file.filename, folder_id)

            # Process file
            result = await file_processor.process_file(
                account_id=account_id,
                user_id=user_id,
                folder_id=folder_id,
                file_content=file_content,
                filename=final_filename,
                mime_type=file.content_type or 'application/octet-stream',
                idempotency_key=idempotency_key,
            )

        if not result['success']:
            raise_api_error(
                400,
                result.get('error') or "Upload failed",
                error_code="KB_UPLOAD_FAILED",
                retryable=True,
            )

        if upload_request_id and idempotency_key:
            try:
                await client.table('kb_upload_requests').update({
                    'entry_id': result.get('entry_id'),
                    'status': 'completed',
                }).eq('request_id', upload_request_id).execute()
            except Exception as e:
                logger.warning(f"[kb] failed to update upload request: {e}")
        if result.get('duplicate'):
            metrics.incr("kb.upload.idempotency_hit", 1)

        # Add info about filename changes
        if file and final_filename != file.filename:
            result['filename_changed'] = True
            result['original_filename'] = file.filename
            result['final_filename'] = final_filename
        
        return result
        
    except ValidationError:
        raise
    except HTTPException:
        raise
    except Exception as e:
        if upload_request_id:
            try:
                await client.table('kb_upload_requests').update({
                    'status': 'failed',
                    'error': str(e),
                }).eq('request_id', upload_request_id).execute()
            except Exception:
                pass
        logger.error(f"Error uploading file: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to upload file")

# Entries
@router.get("/folders/{folder_id}/entries", response_model=List[EntryResponse])
async def get_folder_entries(
    folder_id: str,
    user_workspace: tuple[str, str] = Depends(resolve_user_and_workspace)
):
    """Get all entries in a folder."""
    try:
        client = await db.client
        user_id, account_id = user_workspace
        
        # Verify folder ownership
        folder_result = await client.table('knowledge_base_folders').select(
            'folder_id'
        ).eq('folder_id', folder_id).eq('account_id', account_id).execute()
        
        if not folder_result.data:
            raise HTTPException(status_code=404, detail="Folder not found")
        
        result = await client.table('knowledge_base_entries').select(
            'entry_id, filename, summary, file_size, created_at'
        ).eq('folder_id', folder_id).eq('is_active', True).order('created_at', desc=True).execute()
        
        return [
            EntryResponse(
                entry_id=entry['entry_id'],
                filename=entry['filename'],
                summary=entry['summary'],
                file_size=entry['file_size'],
                created_at=entry['created_at']
            )
            for entry in result.data
        ]
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting folder entries: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to retrieve entries")

@router.delete("/entries/{entry_id}")
async def delete_entry(
    entry_id: str,
    user_workspace: tuple[str, str] = Depends(resolve_user_and_workspace)
):
    """Delete a knowledge base entry."""
    try:
        client = await db.client
        user_id, account_id = user_workspace
        
        # Verify ownership
        entry_result = await client.table('knowledge_base_entries').select(
            'entry_id, file_path'
        ).eq('entry_id', entry_id).eq('account_id', account_id).execute()
        
        if not entry_result.data:
            raise_api_error(
                404,
                "Entry not found",
                error_code="KB_ENTRY_NOT_FOUND",
                retryable=False,
            )
        
        entry = entry_result.data[0]
        
        linked_record = await _get_linked_file_record(client, entry_id, account_id)
        linked_file_id = linked_record.get('id') if linked_record else None
        linked_provider = (linked_record or {}).get('storage_provider') if linked_record else None

        if not linked_record or linked_provider != 'r2':
            try:
                await client.table('file_links').delete().eq(
                    'entity_type', KB_FILE_LINK_TYPE
                ).eq('entity_id', entry_id).execute()
            except Exception:
                pass
            await client.table('knowledge_base_entries').delete().eq('entry_id', entry_id).execute()
            return {"success": True, "status": "deleted"}

        job_payload = {
            'account_id': account_id,
            'entry_id': entry_id,
            'action': 'delete',
            'status': 'pending',
        }
        job_payload.update({
            'file_id': linked_file_id,
            'storage_provider': linked_record.get('storage_provider') or 'r2',
            'storage_bucket': linked_record.get('storage_bucket'),
            'storage_path': linked_record.get('storage_path'),
        })

        try:
            await client.table('knowledge_base_entries').update({
                'is_active': False,
            }).eq('entry_id', entry_id).execute()

            job_res = await client.table('kb_file_jobs').insert(job_payload).execute()
            if job_res.data:
                job_id = job_res.data[0].get('job_id')
                if job_id:
                    process_kb_file_job.send(job_id)
            return {"success": True, "status": "scheduled"}
        except Exception as e:
            logger.error(f"[kb] delete scheduling failed: {e}")
            raise_api_error(
                500,
                "Failed to schedule delete",
                error_code="KB_DELETE_SCHEDULE_FAILED",
                retryable=True,
            )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting entry: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to delete entry")


@router.get("/entries/{entry_id}/download")
async def download_entry_file(
    entry_id: str,
    user_workspace: tuple[str, str] = Depends(resolve_user_and_workspace)
):
    """Download knowledge base entry contents for preview.

    - 文本类文件：直接返回 UTF-8 文本内容，`is_binary=False`
    - 二进制文件（如 PDF）：返回 base64 编码，`is_binary=True`
    """
    try:
        client = await db.client

        # 仅允许访问当前用户账户下的条目
        user_id, account_id = user_workspace
        result = await client.table('knowledge_base_entries').select(
            'file_path, filename, mime_type, account_id'
        ).eq('entry_id', entry_id).eq('account_id', account_id).limit(1).execute()

        if not result.data:
            raise HTTPException(status_code=404, detail="File not found")

        entry = result.data[0]
        mime_type = entry.get('mime_type') or 'application/octet-stream'

        linked_record = await _get_linked_file_record(client, entry_id, account_id)
        if linked_record:
            mime_type = linked_record.get('content_type') or mime_type
            data = await _fetch_file_bytes(client, linked_record)
        else:
            raise_file_removed("FILE_REMOVED")

        if data is None:
            raise HTTPException(status_code=404, detail="File content not found in storage")

        # Supabase Python 客户端通常返回 bytes
        raw = data if isinstance(data, (bytes, bytearray)) else bytes(data)

        if mime_type.startswith('text/'):
            try:
                text = raw.decode('utf-8')
            except Exception:
                # 容错解码，避免预览失败
                text = raw.decode('utf-8', errors='ignore')
            return {"content": text, "is_binary": False}
        else:
            import base64
            b64 = base64.b64encode(raw).decode('utf-8')
            return {"content": b64, "is_binary": True}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error downloading knowledge base entry {entry_id}: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to download file")

@router.patch("/entries/{entry_id}", response_model=EntryResponse)
async def update_entry(
    entry_id: str,
    request: UpdateEntryRequest,
    user_workspace: tuple[str, str] = Depends(resolve_user_and_workspace)
):
    """Update a knowledge base entry summary."""
    try:
        client = await db.client
        user_id, account_id = user_workspace
        
        # Verify ownership and get current entry
        entry_result = await client.table('knowledge_base_entries').select(
            'entry_id, filename, summary, file_size, created_at, account_id'
        ).eq('entry_id', entry_id).eq('account_id', account_id).execute()
        
        if not entry_result.data:
            raise HTTPException(status_code=404, detail="Entry not found")
        
        # Update the summary
        update_result = await client.table('knowledge_base_entries').update({
            'summary': request.summary
        }).eq('entry_id', entry_id).execute()
        
        if not update_result.data:
            raise HTTPException(status_code=500, detail="Failed to update entry")
        
        # Return the updated entry
        updated_entry = update_result.data[0]
        return EntryResponse(
            entry_id=updated_entry['entry_id'],
            filename=updated_entry['filename'],
            summary=updated_entry['summary'],
            file_size=updated_entry['file_size'],
            created_at=updated_entry['created_at']
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating entry: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to update entry")


@router.get("/entries/{entry_id}", response_model=EntryResponse)
async def get_entry(
    entry_id: str,
    user_workspace: tuple[str, str] = Depends(resolve_user_and_workspace)
):
    """Get single knowledge base entry metadata (for UI operations)."""
    try:
        client = await db.client
        user_id, account_id = user_workspace

        result = await client.table('knowledge_base_entries').select(
            'entry_id, filename, summary, file_size, created_at, account_id'
        ).eq('entry_id', entry_id).eq('account_id', account_id).limit(1).execute()

        if not result.data:
            raise HTTPException(status_code=404, detail="Entry not found")

        row = result.data[0]
        return EntryResponse(
            entry_id=row['entry_id'],
            filename=row['filename'],
            summary=row.get('summary', ''),
            file_size=row.get('file_size', 0),
            created_at=row['created_at']
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching entry {entry_id}: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to fetch entry")

# Agent assignments
@router.get("/agents/{agent_id}/assignments")
async def get_agent_assignments(
    agent_id: str,
    auth: AuthorizedAgentAccess = Depends(require_agent_access)
):
    """Get entry assignments for an agent."""
    try:
        client = await db.client
        
        # Get file-level assignments only
        file_result = await client.table('agent_knowledge_entry_assignments').select(
            'entry_id, enabled'
        ).eq('agent_id', agent_id).execute()
        
        return {row['entry_id']: row['enabled'] for row in file_result.data}
        
    except Exception as e:
        logger.error(f"Error getting agent assignments: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to retrieve agent assignments")

@router.post("/agents/{agent_id}/assignments")
async def update_agent_assignments(
    agent_id: str,
    assignment_data: dict,
    auth: AuthorizedAgentAccess = Depends(require_agent_access)
):
    """Update agent entry assignments."""
    try:
        client = await db.client
        account_id = auth.agent_data.get('account_id') or auth.user_id
        entry_ids = assignment_data.get('entry_ids', [])
        if not isinstance(entry_ids, list):
            raise_api_error(
                400,
                "entry_ids must be a list",
                error_code="KB_ASSIGNMENTS_INVALID",
                retryable=False,
            )

        cleaned_ids = [str(eid) for eid in entry_ids if eid]
        rpc_res = await client.rpc('replace_kb_assignments', {
            'p_agent_id': agent_id,
            'p_account_id': account_id,
            'p_entry_ids': cleaned_ids,
        }).execute()

        assigned_count = None
        if rpc_res.data:
            assigned_count = rpc_res.data[0].get('assigned_count')

        return {
            "success": True,
            "message": "Assignments updated successfully",
            "assigned_count": assigned_count if assigned_count is not None else len(cleaned_ids),
        }
        
    except Exception as e:
        logger.error(f"Error updating agent assignments: {str(e)}")
        raise_api_error(
            500,
            "Failed to update assignments",
            error_code="KB_ASSIGNMENTS_FAILED",
            retryable=True,
        )

class FolderMoveRequest(BaseModel):
    folder_id: str

# File operations
@router.put("/entries/{entry_id}/move")
async def move_file(
    entry_id: str,
    request: FolderMoveRequest,
    user_workspace: tuple[str, str] = Depends(resolve_user_and_workspace)
):
    """Move a file to a different folder."""
    try:
        client = await db.client
        user_id, account_id = user_workspace
        
        # Get current entry details including file path and filename
        entry_result = await client.table('knowledge_base_entries').select(
            'entry_id, folder_id, file_path, filename'
        ).eq('entry_id', entry_id).execute()
        
        if not entry_result.data:
            raise_api_error(
                404,
                "File not found",
                error_code="KB_ENTRY_NOT_FOUND",
                retryable=False,
            )
        
        entry = entry_result.data[0]
        current_folder_id = entry['folder_id']
        current_file_path = entry['file_path']
        filename = entry['filename']
        
        # If already in the target folder, no need to move
        if current_folder_id == request.folder_id:
            return {"success": True, "message": "File is already in the target folder"}
        
        # Verify target folder belongs to user
        folder_result = await client.table('knowledge_base_folders').select(
            'folder_id'
        ).eq('folder_id', request.folder_id).eq('account_id', account_id).execute()
        
        if not folder_result.data:
            raise_api_error(
                404,
                "Target folder not found",
                error_code="KB_FOLDER_NOT_FOUND",
                retryable=False,
            )
        
        linked_record = await _get_linked_file_record(client, entry_id, account_id)
        if linked_record:
            # R2-backed files keep storage path stable; just move the entry metadata
            await client.table('knowledge_base_entries').update({
                'folder_id': request.folder_id,
            }).eq('entry_id', entry_id).execute()
            return {"success": True, "message": "File moved successfully"}
        raise_file_removed("FILE_REMOVED")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error moving file: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to move file")
