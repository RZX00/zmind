"""
Cleanup old rows from event_audit.

Usage:
    python cleanup_event_audit.py --days 180
"""

import asyncio
import os
from datetime import datetime, timedelta, timezone

from core.services.supabase import DBConnection


def _parse_days(value: str | None, default: int) -> int:
    if not value:
        return default
    try:
        return int(value)
    except ValueError:
        return default


async def main():
    import argparse

    parser = argparse.ArgumentParser(description="Cleanup event_audit rows")
    parser.add_argument("--days", type=int, default=None, help="Retention days")
    args = parser.parse_args()

    retention_days = args.days or _parse_days(os.getenv("EVENT_AUDIT_RETENTION_DAYS"), 180)
    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)

    db = DBConnection()
    client = await db.client

    await client.table("event_audit").delete().lt("occurred_at", cutoff.isoformat()).execute()
    print(f"event_audit cleanup complete (retention_days={retention_days})")


if __name__ == "__main__":
    asyncio.run(main())
