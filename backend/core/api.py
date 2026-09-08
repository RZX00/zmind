from fastapi import APIRouter
from .versioning.api import router as agent_versioning_router
from .core_utils import initialize, cleanup
from .agent_runs import router as agent_runs_router
from .agent_crud import router as agent_crud_router
from .agent_tools import router as agent_tools_router
from .canvas.api import router as canvas_router
from .threads import router as threads_router
from .media.api import router as media_router
from .files.api import router as files_router
from .runtime.files_api import router as runtime_files_router
from .search.api import router as search_router
from .search.unified_api import router as unified_search_router
from .workspace.api import router as workspace_router
from .items.api import router as items_router
from .docs.api import router as docs_router
from .references.api import router as references_router
from .skills.marketplace_api import router as skills_marketplace_router
from .interfaces.http.canvas.ai_routes import router as canvas_ai_router
from .interfaces.http.canvas.command_routes import router as canvas_command_router
from .interfaces.http.canvas.query_routes import router as canvas_query_router
from .interfaces.http.canvas.share_routes import router as canvas_share_router
from .interfaces.http.infographic.routes import router as infographic_router
from .integrations.obsidian.import_api import router as obsidian_import_router
from .integrations.obsidian.export_api import router as obsidian_export_router
from .integrations.openclaw.api import router as openclaw_router

router = APIRouter()

# Include all sub-routers
router.include_router(agent_versioning_router)
router.include_router(agent_runs_router)
router.include_router(agent_crud_router)
router.include_router(agent_tools_router)
router.include_router(threads_router)
router.include_router(canvas_router)
router.include_router(canvas_query_router)
router.include_router(canvas_command_router)
router.include_router(canvas_share_router)
router.include_router(canvas_ai_router)
router.include_router(infographic_router)
router.include_router(media_router)
router.include_router(files_router)
router.include_router(runtime_files_router)
router.include_router(search_router)
router.include_router(unified_search_router)
router.include_router(workspace_router)
router.include_router(items_router)
router.include_router(docs_router)
router.include_router(references_router)
router.include_router(skills_marketplace_router)
router.include_router(obsidian_import_router)
router.include_router(obsidian_export_router)
router.include_router(openclaw_router)

# Re-export the initialize and cleanup functions
__all__ = ['router', 'initialize', 'cleanup']
