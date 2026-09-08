"""
Rebuild canvas search index.

Usage:
    python rebuild_search_index.py --account-id <uuid>
    python rebuild_search_index.py --canvas-id <uuid>
    python rebuild_search_index.py  # all accounts
"""

import asyncio
from typing import Optional

from core.services.supabase import DBConnection
from core.search.indexer import rebuild_canvas_search_index, rebuild_workspace_search_index
from core.utils.logger import logger


async def _resolve_canvas_account(client, canvas_id: str) -> Optional[str]:
    res = (
        await client.table("canvases")
        .select("account_id")
        .eq("id", canvas_id)
        .limit(1)
        .execute()
    )
    if res.data:
        return res.data[0].get("account_id")
    return None


async def _list_accounts(client) -> list[str]:
    res = await client.table("canvases").select("account_id").execute()
    account_ids = {
        str(row.get("account_id"))
        for row in (res.data or [])
        if row.get("account_id")
    }
    return sorted(account_ids)


async def main():
    import argparse

    parser = argparse.ArgumentParser(description="Rebuild canvas search index")
    parser.add_argument("--account-id", dest="account_id", help="Account/workspace id")
    parser.add_argument("--canvas-id", dest="canvas_id", help="Canvas id")
    args = parser.parse_args()

    db = DBConnection()
    client = await db.client

    if args.canvas_id:
        account_id = args.account_id or await _resolve_canvas_account(client, args.canvas_id)
        if not account_id:
            raise RuntimeError("Account id required to rebuild single canvas index")
        await rebuild_canvas_search_index(args.canvas_id, account_id, client=client)
        print(f"reindexed canvas {args.canvas_id}")
        return

    if args.account_id:
        await rebuild_workspace_search_index(args.account_id)
        print(f"reindexed account {args.account_id}")
        return

    accounts = await _list_accounts(client)
    if not accounts:
        print("no canvases found")
        return

    for account_id in accounts:
        try:
            await rebuild_workspace_search_index(account_id)
            print(f"reindexed account {account_id}")
        except Exception as exc:
            logger.warning("search_rebuild_failed", account_id=account_id, error=str(exc))


if __name__ == "__main__":
    asyncio.run(main())
