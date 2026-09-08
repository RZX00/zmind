"""
Replay a projection from the beginning by clearing its offset.

Usage:
    python replay_projection.py canvas_share_projection
    python replay_projection.py canvas_search_projection --limit 500
"""

import asyncio

from core.infrastructure.projections.projection_worker import ProjectionWorker
from core.infrastructure.projections.canvas_share_projection import CanvasShareProjection
from core.infrastructure.projections.canvas_search_projection import CanvasSearchProjection
from core.infrastructure.projections.event_audit_projection import EventAuditProjection
from core.services.supabase import DBConnection


async def main():
    import argparse

    parser = argparse.ArgumentParser(description="Replay projection from the start")
    parser.add_argument("projection_name", help="Projection name to replay")
    parser.add_argument("--limit", type=int, default=200, help="Batch size per run")
    args = parser.parse_args()

    db = DBConnection()
    client = await db.client

    await client.table("projection_offsets").delete().eq("projection_name", args.projection_name).execute()

    worker = ProjectionWorker()
    projections = [
        CanvasShareProjection(),
        CanvasSearchProjection(),
        EventAuditProjection(),
    ]
    for projection in projections:
        worker.register(projection)

    total = 0
    while True:
        processed = await worker.run_once(args.projection_name, limit=args.limit)
        total += processed
        if processed == 0:
            break
    print(f"replayed {args.projection_name}: {total} events")


if __name__ == "__main__":
    asyncio.run(main())
