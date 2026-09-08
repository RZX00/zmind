"""
Replay failed projection events stored in projection_failures.

Usage:
    python replay_projection_failures.py --projection canvas_search_projection --limit 200
"""

import asyncio

from core.infrastructure.projections.projection_worker import ProjectionWorker
from core.infrastructure.projections.canvas_share_projection import CanvasShareProjection
from core.infrastructure.projections.canvas_search_projection import CanvasSearchProjection
from core.infrastructure.projections.event_audit_projection import EventAuditProjection
from core.services.supabase import DBConnection


async def main():
    import argparse

    parser = argparse.ArgumentParser(description="Replay projection failures")
    parser.add_argument("--projection", required=True, help="Projection name")
    parser.add_argument("--limit", type=int, default=200, help="Batch size")
    args = parser.parse_args()

    db = DBConnection()
    client = await db.client

    worker = ProjectionWorker()
    projections = [
        CanvasShareProjection(),
        CanvasSearchProjection(),
        EventAuditProjection(),
    ]
    for projection in projections:
        worker.register(projection)

    res = (
        await client.table("projection_failures")
        .select("projection_name,event_id,event_type,schema_version,occurred_at,aggregate_id,aggregate_type,tenant_id,actor_id,payload")
        .eq("projection_name", args.projection)
        .order("last_failed_at", desc=False)
        .limit(args.limit)
        .execute()
    )
    rows = res.data or []
    if not rows:
        print("no failures to replay")
        return

    handler = worker._handlers.get(args.projection)
    if not handler:
        raise RuntimeError(f"projection not registered: {args.projection}")

    success = 0
    for row in rows:
        try:
            event = worker._build_event(row)
            await handler.handle(event)
            await client.table("projection_failures").delete().eq(
                "projection_name", args.projection
            ).eq("event_id", row.get("event_id")).execute()
            success += 1
        except Exception as exc:
            await worker._record_failure(args.projection, row, str(exc))
            continue

    print(f"replayed {success}/{len(rows)} failures")


if __name__ == "__main__":
    asyncio.run(main())
