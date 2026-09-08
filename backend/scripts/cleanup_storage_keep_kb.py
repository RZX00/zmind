#!/usr/bin/env python3
"""Clean Supabase storage objects, keeping only Knowledge Base uploads."""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path
from typing import Iterable, List, Sequence, Set

# Ensure repo root is on sys.path when executed directly.
REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.core.services.supabase import DBConnection
from backend.core.utils.config import config


DEFAULT_BUCKETS = ("file-uploads",)
KB_PREFIX = "knowledge-base/"
PAGE_SIZE = 1000
DELETE_BATCH_SIZE = 200


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Remove storage objects not tied to Knowledge Base uploads.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Actually delete objects (default is dry-run).",
    )
    parser.add_argument(
        "--strict-kb",
        action="store_true",
        help="Keep only KB entries present in knowledge_base_entries "
        "(default keeps everything under knowledge-base/).",
    )
    parser.add_argument(
        "--bucket",
        action="append",
        dest="buckets",
        default=list(DEFAULT_BUCKETS),
        help="Bucket to clean (repeat to include multiple). Default: file-uploads",
    )
    parser.add_argument(
        "--delete-file-uploads-table",
        action="store_true",
        help="Delete rows in public.file_uploads that point to removed objects.",
    )
    return parser


def _chunked(items: Sequence[str], size: int) -> Iterable[List[str]]:
    for idx in range(0, len(items), size):
        yield list(items[idx : idx + size])


async def _fetch_names(client, bucket: str) -> List[str]:
    names: List[str] = []
    start = 0
    while True:
        resp = (
            await client.table("storage.objects")
            .select("name")
            .eq("bucket_id", bucket)
            .range(start, start + PAGE_SIZE - 1)
            .execute()
        )
        data = resp.data or []
        if not data:
            break
        names.extend([row["name"] for row in data if row.get("name")])
        if len(data) < PAGE_SIZE:
            break
        start += PAGE_SIZE
    return names


async def _fetch_kb_paths(client) -> Set[str]:
    paths: Set[str] = set()
    start = 0
    while True:
        resp = (
            await client.table("knowledge_base_entries")
            .select("file_path")
            .range(start, start + PAGE_SIZE - 1)
            .execute()
        )
        data = resp.data or []
        if not data:
            break
        for row in data:
            path = row.get("file_path")
            if path:
                paths.add(path)
        if len(data) < PAGE_SIZE:
            break
        start += PAGE_SIZE
    return paths


def _should_keep(name: str, *, bucket: str, kb_paths: Set[str], strict_kb: bool) -> bool:
    if bucket != "file-uploads":
        return False
    if not name.startswith(KB_PREFIX):
        return False
    if strict_kb:
        return name in kb_paths
    return True


async def _delete_storage_objects(client, bucket: str, names: Sequence[str]) -> None:
    for batch in _chunked(list(names), DELETE_BATCH_SIZE):
        await client.storage.from_(bucket).remove(batch)


async def _delete_file_upload_rows(client, bucket: str, names: Sequence[str]) -> int:
    if not names:
        return 0
    deleted = 0
    for batch in _chunked(list(names), DELETE_BATCH_SIZE):
        resp = (
            await client.table("file_uploads")
            .delete()
            .eq("bucket_name", bucket)
            .in_("storage_path", batch)
            .execute()
        )
        deleted += len(resp.data or [])
    return deleted


async def _run(args: argparse.Namespace) -> int:
    if not config.SUPABASE_URL or not config.SUPABASE_SERVICE_ROLE_KEY:
        print(
            "[ERROR] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.",
            file=sys.stderr,
        )
        return 1

    db = DBConnection()
    client = await db.client

    kb_paths = await _fetch_kb_paths(client)
    print(f"[info] KB entries: {len(kb_paths)} paths")

    total_deleted = 0
    total_candidates = 0
    for bucket in args.buckets:
        names = await _fetch_names(client, bucket)
        to_delete = [
            name
            for name in names
            if not _should_keep(name, bucket=bucket, kb_paths=kb_paths, strict_kb=args.strict_kb)
        ]
        total_candidates += len(to_delete)
        print(
            f"[info] Bucket '{bucket}': {len(names)} objects, {len(to_delete)} eligible for removal"
        )

        if args.execute and to_delete:
            await _delete_storage_objects(client, bucket, to_delete)
            total_deleted += len(to_delete)
            print(f"[info] Bucket '{bucket}': deleted {len(to_delete)} objects")

        if args.execute and args.delete_file_uploads_table and bucket == "file-uploads":
            removed_rows = await _delete_file_upload_rows(client, bucket, to_delete)
            print(
                f"[info] Bucket '{bucket}': deleted {removed_rows} rows from file_uploads"
            )

    if not args.execute:
        print(f"[dry-run] Total eligible for removal: {total_candidates}")
    else:
        print(f"[done] Total deleted: {total_deleted}")
    return 0


def main() -> int:
    parser = _build_parser()
    args = parser.parse_args()
    return asyncio.run(_run(args))


if __name__ == "__main__":
    raise SystemExit(main())
