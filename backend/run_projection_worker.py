import dotenv

dotenv.load_dotenv(".env")

import asyncio
import os

from core.infrastructure.projections.projection_worker import ProjectionWorker
from core.infrastructure.projections.canvas_share_projection import CanvasShareProjection
from core.infrastructure.projections.canvas_search_projection import CanvasSearchProjection
from core.infrastructure.projections.event_audit_projection import EventAuditProjection


def _parse_float(value: str | None, default: float) -> float:
    if not value:
        return default
    try:
        return float(value)
    except ValueError:
        return default


def _parse_projection_names(value: str | None) -> list[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


async def _run_selected(worker: ProjectionWorker, names: list[str], interval_sec: float) -> None:
    tasks = [
        worker.run_forever(name, interval_sec=interval_sec)
        for name in names
    ]
    await asyncio.gather(*tasks)


if __name__ == "__main__":
    interval_sec = _parse_float(os.getenv("PROJECTION_WORKER_INTERVAL_SEC"), 2.0)
    worker = ProjectionWorker()
    projections = [
        CanvasShareProjection(),
        CanvasSearchProjection(),
        EventAuditProjection(),
    ]
    for projection in projections:
        worker.register(projection)

    projection_names = _parse_projection_names(os.getenv("PROJECTION_NAMES"))
    if not projection_names:
        projection_names = [projection.name for projection in projections]

    asyncio.run(_run_selected(worker, projection_names, interval_sec=interval_sec))
