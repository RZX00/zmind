from __future__ import annotations

from functools import lru_cache
from types import SimpleNamespace

from core.application.services.canvas_command_application_service import (
    CanvasCommandApplicationService,
    CanvasCommandDependencies,
    CanvasCommandLegacyHandlers,
)
from core.application.services.canvas_query_service import (
    CanvasQueryDependencies,
    CanvasQueryService,
)
from core.application.services.canvas_ai_service import CanvasAIDependencies, CanvasAIService
from core.application.services.canvas_share_service import CanvasShareDependencies, CanvasShareService
from core.canvas import api as legacy_canvas_api
from core.canvas.api_models import CanvasDoc, CanvasVersion
from core.canvas.write_service import CanvasWriteService


async def _get_canvas_db_client():
    return await legacy_canvas_api.utils.db.client


def _build_canvas_command_dependencies() -> CanvasCommandDependencies:
    gateway = SimpleNamespace(
        _resolve_user_workspace=legacy_canvas_api._resolve_user_workspace,
        _now_ts=legacy_canvas_api._now_ts,
        _compose_doc=legacy_canvas_api._compose_doc,
        _ensure_unique_canvas_title=legacy_canvas_api._ensure_unique_canvas_title,
        _clean_canvas_doc_dict=legacy_canvas_api._clean_canvas_doc_dict,
        _clean_node_dict=legacy_canvas_api._clean_node_dict,
        _clean_connection_dict=legacy_canvas_api._clean_connection_dict,
        _workspace_canvas_meta=legacy_canvas_api._workspace_canvas_meta,
        _broadcast_canvas_update=legacy_canvas_api._broadcast_canvas_update,
        _set_cached_snapshot=legacy_canvas_api._set_cached_snapshot,
        _sync_canvas_file_links=legacy_canvas_api._sync_canvas_file_links,
        _snapshot_cache_key=legacy_canvas_api._snapshot_cache_key,
        bump_canvas_server_version=legacy_canvas_api.bump_canvas_server_version,
        bump_workspace_version_and_broadcast=legacy_canvas_api.bump_workspace_version_and_broadcast,
        rebuild_canvas_search_index=legacy_canvas_api.rebuild_canvas_search_index,
        delete_canvas_search_index=legacy_canvas_api.delete_canvas_search_index,
        cache_service=legacy_canvas_api.cache_service,
        logger=legacy_canvas_api.logger,
        config=legacy_canvas_api.config,
        utils=legacy_canvas_api.utils,
    )
    return CanvasCommandDependencies(
        gateway=gateway,
    )


def _build_canvas_command_legacy_handlers() -> CanvasCommandLegacyHandlers:
    return CanvasCommandLegacyHandlers(
        save_canvas_version=legacy_canvas_api.save_canvas_version,
        delete_canvas_version=legacy_canvas_api.delete_canvas_version,
        purge_deleted_canvases=legacy_canvas_api.purge_deleted_canvases,
        hard_delete_canvas=legacy_canvas_api.hard_delete_canvas,
        restore_canvases_batch=legacy_canvas_api.restore_canvases_batch,
        purge_canvases_by_ids=legacy_canvas_api.purge_canvases_by_ids,
        ensure_thread_for_canvas=legacy_canvas_api.ensure_thread_for_canvas,
    )


def _build_canvas_query_dependencies() -> CanvasQueryDependencies:
    return CanvasQueryDependencies(
        resolve_user_workspace=legacy_canvas_api._resolve_user_workspace,
        extract_invited_context=legacy_canvas_api._extract_invited_context,
        get_db_client=_get_canvas_db_client,
        compose_doc=legacy_canvas_api._compose_doc,
        compose_meta=legacy_canvas_api._compose_meta,
        iso_to_ms=legacy_canvas_api._iso_to_ms,
        make_meta_etag=legacy_canvas_api._make_meta_etag,
        make_canvas_etag=legacy_canvas_api._make_canvas_etag,
        now_ts=legacy_canvas_api._now_ts,
        backfill_media_storage_paths_from_file_ids=legacy_canvas_api._backfill_media_storage_paths_from_file_ids,
        set_cached_snapshot=legacy_canvas_api._set_cached_snapshot,
        get_cached_snapshot=legacy_canvas_api._get_cached_snapshot,
        doc_needs_media_backfill=legacy_canvas_api._doc_needs_media_backfill,
        create_write_service=CanvasWriteService,
        canvas_doc_model=CanvasDoc,
        canvas_version_model=CanvasVersion,
        logger=legacy_canvas_api.logger,
        realtime_write_enabled=legacy_canvas_api.config.CANVAS_REALTIME_WRITE_ENABLED,
        snapshot_timeout_sec=legacy_canvas_api.SNAPSHOT_TIMEOUT_SEC,
    )


def _build_canvas_share_dependencies() -> CanvasShareDependencies:
    return CanvasShareDependencies(
        create_canvas_invite=legacy_canvas_api.create_canvas_invite,
        list_canvas_invites=legacy_canvas_api.list_canvas_invites,
        revoke_canvas_invite=legacy_canvas_api.revoke_canvas_invite,
        verify_canvas_invite=legacy_canvas_api.verify_canvas_invite,
        get_canvas_share_health=legacy_canvas_api.get_canvas_share_health,
        get_canvas_share_status=legacy_canvas_api.get_canvas_share_status,
        update_canvas_share=legacy_canvas_api.update_canvas_share,
        get_public_canvas_snapshot=legacy_canvas_api.get_public_canvas_snapshot,
        list_public_canvas_versions=legacy_canvas_api.list_public_canvas_versions,
        list_public_canvas_timeline=legacy_canvas_api.list_public_canvas_timeline,
    )


def _build_canvas_ai_dependencies() -> CanvasAIDependencies:
    return CanvasAIDependencies(
        stream_canvas_selection_chat=legacy_canvas_api.stream_canvas_selection_chat,
        generate_selection_infographic=legacy_canvas_api.generate_selection_infographic,
        generate_canvas_title=legacy_canvas_api.generate_canvas_title,
        resolve_external_video_metadata=legacy_canvas_api.resolve_external_video_metadata,
        generate_canvas_media=legacy_canvas_api.generate_canvas_media,
    )


@lru_cache(maxsize=1)
def get_canvas_command_service() -> CanvasCommandApplicationService:
    return CanvasCommandApplicationService(
        deps=_build_canvas_command_dependencies(),
        legacy_handlers=_build_canvas_command_legacy_handlers(),
    )


@lru_cache(maxsize=1)
def get_canvas_query_service() -> CanvasQueryService:
    return CanvasQueryService(
        deps=_build_canvas_query_dependencies()
    )


@lru_cache(maxsize=1)
def get_canvas_share_service() -> CanvasShareService:
    return CanvasShareService(
        deps=_build_canvas_share_dependencies()
    )


@lru_cache(maxsize=1)
def get_canvas_ai_service() -> CanvasAIService:
    return CanvasAIService(
        deps=_build_canvas_ai_dependencies()
    )
