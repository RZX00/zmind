from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

import dramatiq

from core.services.supabase import DBConnection
from core.services.r2_storage import get_r2_client, get_r2_bucket
from core.utils.logger import logger
from core.services import metrics


MAX_JOB_ATTEMPTS = 3


async def _get_file_record_by_id(client, file_id: str) -> Optional[dict]:
    try:
        resp = (
            await client.table('file_uploads')
            .select('id, storage_provider, storage_bucket, storage_path')
            .eq('id', file_id)
            .limit(1)
            .execute()
        )
        if resp.data:
            return resp.data[0]
    except Exception as e:
        logger.warning(f"[kb-jobs] file_uploads lookup failed: {e}")
    return None


async def _maybe_cleanup_file_upload(client, file_id: str) -> None:
    try:
        remaining = (
            await client.table('file_links')
            .select('id')
            .eq('file_id', file_id)
            .limit(1)
            .execute()
        )
        if remaining.data:
            return
        record = await _get_file_record_by_id(client, file_id)
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
        logger.warning(f"[kb-jobs] file cleanup failed for {file_id}: {e}")


async def _update_job(client, job_id: str, **fields) -> None:
    if not fields:
        return
    fields.setdefault('updated_at', datetime.now(timezone.utc).isoformat())
    await client.table('kb_file_jobs').update(fields).eq('job_id', job_id).execute()


@dramatiq.actor(max_retries=MAX_JOB_ATTEMPTS - 1)
async def process_kb_file_job(job_id: str) -> None:
    db = DBConnection()
    client = await db.client

    res = (
        await client.table('kb_file_jobs')
        .select('*')
        .eq('job_id', job_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        return
    job = res.data[0]
    status = job.get('status')
    if status not in ('pending', 'retry'):
        return

    attempts = int(job.get('attempts') or 0) + 1
    await _update_job(client, job_id, status='running', attempts=attempts)

    action = job.get('action')
    entry_id = job.get('entry_id')
    file_id = job.get('file_id')
    provider = job.get('storage_provider') or 'supabase'
    storage_path = job.get('storage_path')
    target_path = job.get('target_path')
    target_folder_id = job.get('target_folder_id')

    try:
        if action == 'delete':
            if entry_id:
                try:
                    await client.table('file_links').delete().eq(
                        'entity_type', 'kb_entry'
                    ).eq('entity_id', str(entry_id)).execute()
                except Exception as e:
                    logger.warning(f"[kb-jobs] failed to remove file link for {entry_id}: {e}")

            if file_id:
                await _maybe_cleanup_file_upload(client, str(file_id))
            elif storage_path:
                if provider == 'r2':
                    r2 = get_r2_client()
                    r2.delete_object(Bucket=get_r2_bucket(), Key=storage_path)
                else:
                    await client.table('file_uploads').update({
                        'deleted_at': datetime.now(timezone.utc).isoformat(),
                        'status': 'deleted',
                    }).eq('storage_path', storage_path).execute()

            if entry_id:
                await client.table('knowledge_base_entries').delete().eq('entry_id', entry_id).execute()

        elif action == 'move':
            if not storage_path or not target_path or not target_folder_id:
                raise RuntimeError("missing storage_path or target_path for move job")
            if provider == 'r2':
                raise RuntimeError("r2 move should be handled inline")
            raise RuntimeError("Legacy storage move is no longer supported")

        await _update_job(client, job_id, status='completed')
        metrics.incr("kb.file_job.completed", 1, action=action)
    except Exception as e:
        logger.error(f"[kb-jobs] job failed {job_id}: {e}")
        next_status = 'retry' if attempts < MAX_JOB_ATTEMPTS else 'failed'
        await _update_job(client, job_id, status=next_status, last_error=str(e))
        metrics.incr(
            "kb.file_job.failed",
            1,
            action=action,
            final_status=next_status,
        )
        if attempts < MAX_JOB_ATTEMPTS:
            raise
