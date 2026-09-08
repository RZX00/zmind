#!/usr/bin/env python3
"""Rebuild canvas node search index."""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path
from typing import Optional

# Ensure repo root is on sys.path when executed directly.
REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.core.services.supabase import DBConnection
from backend.core.search.indexer import rebuild_canvas_search_index
from backend.core.utils.logger import logger


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Rebuild canvas search index for a workspace or all canvases.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--workspace", help="Workspace (account_id) to reindex")
    parser.add_argument("--canvas", help="Canvas ID to reindex")
    parser.add_argument("--all", action="store_true", help="Reindex all canvases")
    return parser


async def _reindex_canvas(client, canvas_id: str, account_id: str) -> None:
    res = await client.table("canvases").select("id,title,doc,is_deleted").eq("id", canvas_id).eq("account_id", account_id).limit(1).execute()
    if not res.data:
        logger.warning(f"[search] canvas not found: {canvas_id}")
        return
    row = res.data[0]
    if row.get("is_deleted"):
        logger.info(f"[search] skip deleted canvas {canvas_id}")
        return
    doc = row.get("doc") or {}
    if isinstance(doc, str):
        import orjson
        try:
            doc = orjson.loads(doc)
        except Exception:
            doc = {}
    if isinstance(doc, dict):
        doc.setdefault("id", row.get("id"))
        doc.setdefault("title", row.get("title"))
    await rebuild_canvas_search_index(canvas_id, account_id, doc=doc, client=client)


async def _reindex_workspace(client, workspace_id: str) -> None:
    res = await client.table("canvases").select("id,account_id,title,doc,is_deleted").eq("account_id", workspace_id).execute()
    rows = res.data or []
    logger.info(f"[search] workspace {workspace_id}: {len(rows)} canvases")
    for row in rows:
        if row.get("is_deleted"):
            continue
        canvas_id = str(row.get("id"))
        doc = row.get("doc") or {}
        if isinstance(doc, str):
            import orjson
            try:
                doc = orjson.loads(doc)
            except Exception:
                doc = {}
        if isinstance(doc, dict):
            doc.setdefault("id", row.get("id"))
            doc.setdefault("title", row.get("title"))
        await rebuild_canvas_search_index(canvas_id, workspace_id, doc=doc, client=client)


async def _reindex_all(client) -> None:
    res = await client.table("canvases").select("id,account_id,title,doc,is_deleted").execute()
    rows = res.data or []
    logger.info(f"[search] total canvases: {len(rows)}")
    for row in rows:
        if row.get("is_deleted"):
            continue
        canvas_id = str(row.get("id"))
        account_id = str(row.get("account_id"))
        doc = row.get("doc") or {}
        if isinstance(doc, str):
            import orjson
            try:
                doc = orjson.loads(doc)
            except Exception:
                doc = {}
        if isinstance(doc, dict):
            doc.setdefault("id", row.get("id"))
            doc.setdefault("title", row.get("title"))
        await rebuild_canvas_search_index(canvas_id, account_id, doc=doc, client=client)


async def _run(args: argparse.Namespace) -> int:
    db = DBConnection()
    client = await db.client

    if args.canvas:
        if not args.workspace:
            print("--canvas requires --workspace (account_id)", file=sys.stderr)
            return 1
        await _reindex_canvas(client, args.canvas, args.workspace)
        return 0

    if args.workspace:
        await _reindex_workspace(client, args.workspace)
        return 0

    if args.all:
        await _reindex_all(client)
        return 0

    print("Please specify --canvas + --workspace, or --workspace, or --all", file=sys.stderr)
    return 1


def main() -> int:
    parser = _build_parser()
    args = parser.parse_args()
    return asyncio.run(_run(args))


if __name__ == "__main__":
    raise SystemExit(main())
