#!/usr/bin/env python3
"""
迁移执行器 —— 取代 `npx supabase db push`。

为什么要换掉 supabase CLI：它要求登录 supabase.com、link 一个云项目，而我们已经
不再有云项目了。这个脚本只需要一个 Postgres 连接串。

为什么不直接沿用 supabase_migrations.schema_migrations：那张表已经与现实脱节——
云端只记录了 94 条，而仓库有 151 个迁移文件，最后一条记录停在 20250920，之后的
迁移全是绕过 CLI 手工执行的。照它 seed 会导致重复执行几十个已生效的迁移。
所以这里用自己的 zmind_migrations.applied 表重新记账。

用法：
    python scripts/migrate.py status              # 看有哪些待应用
    python scripts/migrate.py baseline            # 把现有文件全标为已应用（首次切换用）
    python scripts/migrate.py up                  # 按文件名顺序应用待执行的迁移
    python scripts/migrate.py up --dry-run        # 只打印要做什么

连接串取自 ZMIND_DATABASE_URL。
"""

import argparse
import asyncio
import hashlib
import os
import sys
from pathlib import Path

import asyncpg

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "supabase" / "migrations"

_BOOTSTRAP = """
CREATE SCHEMA IF NOT EXISTS zmind_migrations;
CREATE TABLE IF NOT EXISTS zmind_migrations.applied (
    version     text PRIMARY KEY,
    name        text NOT NULL,
    sha256      text NOT NULL,
    applied_at  timestamptz NOT NULL DEFAULT now(),
    -- baseline 标记：true 表示"文件在切换时就已经生效了"，并非由本脚本执行
    baselined   boolean NOT NULL DEFAULT false
);
"""


def discover():
    """返回 [(version, name, path, sha256)]，按 version 升序。

    .DISABLED 后缀的文件被刻意排除——仓库里有 2 个，是历史上主动停用的。
    """
    out = []
    for p in sorted(MIGRATIONS_DIR.glob("*.sql")):
        stem = p.stem
        version, _, name = stem.partition("_")
        if not version.isdigit():
            print(f"!! 跳过文件名不含版本号的迁移: {p.name}", file=sys.stderr)
            continue
        sha = hashlib.sha256(p.read_bytes()).hexdigest()
        out.append((version, name or stem, p, sha))
    return out


async def _applied(conn):
    rows = await conn.fetch("SELECT version, sha256 FROM zmind_migrations.applied")
    return {r["version"]: r["sha256"] for r in rows}


async def cmd_status(conn, files):
    done = await _applied(conn)
    pending = [f for f in files if f[0] not in done]
    changed = [f for f in files if f[0] in done and done[f[0]] != f[3]]

    print(f"迁移目录: {MIGRATIONS_DIR}")
    print(f"文件总数: {len(files)}   已应用: {len(done)}   待应用: {len(pending)}")
    if pending:
        print("\n待应用:")
        for v, n, p, _ in pending:
            print(f"  {v}  {p.name}")
    if changed:
        # 已应用的迁移内容被改动 = 危险信号：数据库里的状态和文件对不上了
        print("\n⚠️ 已应用但文件内容已变（数据库状态与文件不一致）:")
        for v, n, p, _ in changed:
            print(f"  {v}  {p.name}")
    if not pending and not changed:
        print("\n✅ 无待办")
    return 0


async def cmd_baseline(conn, files):
    done = await _applied(conn)
    todo = [f for f in files if f[0] not in done]
    if not todo:
        print("✅ 所有迁移都已登记，无需 baseline")
        return 0
    async with conn.transaction():
        for v, n, p, sha in todo:
            await conn.execute(
                "INSERT INTO zmind_migrations.applied (version, name, sha256, baselined) "
                "VALUES ($1, $2, $3, true) ON CONFLICT (version) DO NOTHING",
                v, n, sha,
            )
    print(f"✅ 已把 {len(todo)} 个迁移标记为 baseline（未执行，视为切换前就已生效）")
    return 0


async def cmd_up(conn, files, dry_run=False):
    done = await _applied(conn)
    pending = [f for f in files if f[0] not in done]
    if not pending:
        print("✅ 没有待应用的迁移")
        return 0

    print(f"待应用 {len(pending)} 个：")
    for v, n, p, _ in pending:
        print(f"  {v}  {p.name}")
    if dry_run:
        print("\n(dry-run，未执行)")
        return 0

    for v, n, p, sha in pending:
        sql = p.read_text(encoding="utf-8")
        print(f"\n>>> {p.name}")
        try:
            # 每个迁移一个事务：失败就整体回滚，不留半截状态
            async with conn.transaction():
                await conn.execute(sql)
                await conn.execute(
                    "INSERT INTO zmind_migrations.applied (version, name, sha256) VALUES ($1,$2,$3)",
                    v, n, sha,
                )
            print(f"    ✅ 已应用")
        except Exception as e:                      # noqa: BLE001
            print(f"    ❌ 失败，已回滚该迁移: {e}", file=sys.stderr)
            return 1
    print(f"\n✅ 完成 {len(pending)} 个迁移")
    return 0


async def main():
    ap = argparse.ArgumentParser(description="zmind 数据库迁移执行器")
    ap.add_argument("command", choices=["status", "baseline", "up"])
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    dsn = os.environ.get("ZMIND_DATABASE_URL")
    if not dsn:
        print("!! 未设置 ZMIND_DATABASE_URL", file=sys.stderr)
        return 2

    files = discover()
    conn = await asyncpg.connect(dsn)
    try:
        await conn.execute(_BOOTSTRAP)
        if args.command == "status":
            return await cmd_status(conn, files)
        if args.command == "baseline":
            return await cmd_baseline(conn, files)
        return await cmd_up(conn, files, args.dry_run)
    finally:
        await conn.close()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
