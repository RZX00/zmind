#!/usr/bin/env python3
"""
差分测试：把同一批查询分别喂给 supabase-py 和自研的 asyncpg shim，逐条比对结果。

这是替换数据库层的唯一可信验收方式——700 个调用点靠肉眼 review 是review不出来的。
两边返回的都是 JSON 结构，直接深比较；不一致就打印差异并以非零码退出。

跑法（在 backend 容器里）：
    SUPABASE_URL=http://zmind-gateway:8000 \
    SUPABASE_SERVICE_ROLE_KEY=... \
    ZMIND_DATABASE_URL=postgres://zmind_app:...@zmind-postgres:5432/postgres \
    python scripts/verify_db_client_parity.py
"""

import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from supabase import create_async_client            # noqa: E402  对照组
from core.services.db_client import create_client   # noqa: E402  被测对象


PASS, FAIL = [], []


def _norm(v):
    """把结果规整成可比较的形式。

    唯一允许的差异：列表顺序。没有 ORDER BY 的查询，Postgres 不保证返回顺序，
    PostgREST 和 shim 各跑一次 SQL，顺序可能不同——那不是缺陷。
    有 ORDER BY 的用例单独按原顺序比（见 ordered=True）。
    """
    return json.loads(json.dumps(v, sort_keys=True, default=str))


def _sorted_norm(v):
    n = _norm(v)
    if isinstance(n, list):
        return sorted(n, key=lambda x: json.dumps(x, sort_keys=True))
    return n


async def check(name, sb_call, shim_call, ordered=False, compare_count=False):
    try:
        a = await sb_call()
        b = await shim_call()
    except Exception as e:                      # noqa: BLE001
        FAIL.append((name, f"执行异常: {type(e).__name__}: {e}"))
        print(f"  ✗ {name}: 执行异常 {type(e).__name__}: {e}")
        return

    # supabase-py 的 maybe_single() 无命中时 execute() 直接返回 None（不是响应对象），
    # shim 刻意复刻了这个行为，所以两边都可能是 None，要先比对象本身。
    if a is None or b is None:
        if (a is None) == (b is None):
            PASS.append(name)
            print(f"  ✓ {name}  (两边同为 None)")
        else:
            FAIL.append((name, f"None 语义不一致: supabase={a!r} shim={b!r}"))
            print(f"  ✗ {name}: None 语义不一致 supabase={type(a).__name__} shim={type(b).__name__}")
        return

    fa = _norm(a.data) if ordered else _sorted_norm(a.data)
    fb = _norm(b.data) if ordered else _sorted_norm(b.data)

    if fa != fb:
        FAIL.append((name, "data 不一致"))
        print(f"  ✗ {name}: data 不一致")
        print(f"      supabase: {json.dumps(fa, ensure_ascii=False)[:300]}")
        print(f"      shim    : {json.dumps(fb, ensure_ascii=False)[:300]}")
        return

    if compare_count and a.count != b.count:
        FAIL.append((name, f"count 不一致 {a.count} vs {b.count}"))
        print(f"  ✗ {name}: count {a.count} vs {b.count}")
        return

    n = len(fa) if isinstance(fa, list) else 1
    PASS.append(name)
    print(f"  ✓ {name}  ({n} 行{f', count={a.count}' if compare_count else ''})")


async def main():
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    dsn = os.environ["ZMIND_DATABASE_URL"]

    sb = await create_async_client(url, key)
    shim = await create_client(dsn)

    print("=" * 72)
    print("差分测试：supabase-py (对照) vs asyncpg shim (被测)")
    print("=" * 72)

    # 取一些真实存在的值当过滤条件，避免全部命中空集导致"假通过"
    seed = await sb.table("threads").select("thread_id, account_id").limit(1).execute()
    if not seed.data:
        print("!! threads 表为空，无法构造有意义的用例")
        return 1
    thread_id = seed.data[0]["thread_id"]
    account_id = seed.data[0]["account_id"]

    print("\n-- 基础 select / 过滤 --")
    await check("select * + limit",
                lambda: sb.table("threads").select("*").limit(3).execute(),
                lambda: shim.table("threads").select("*").limit(3).execute())

    await check("指定列",
                lambda: sb.table("threads").select("thread_id, created_at").limit(5).execute(),
                lambda: shim.table("threads").select("thread_id, created_at").limit(5).execute())

    await check("eq",
                lambda: sb.table("threads").select("*").eq("thread_id", thread_id).execute(),
                lambda: shim.table("threads").select("*").eq("thread_id", thread_id).execute())

    await check("neq + limit",
                lambda: sb.table("threads").select("thread_id").neq("thread_id", thread_id).limit(5).execute(),
                lambda: shim.table("threads").select("thread_id").neq("thread_id", thread_id).limit(5).execute())

    await check("is_ null",
                lambda: sb.table("threads").select("thread_id").is_("project_id", "null").limit(5).execute(),
                lambda: shim.table("threads").select("thread_id").is_("project_id", "null").limit(5).execute())

    await check("in_",
                lambda: sb.table("threads").select("thread_id").in_("thread_id", [thread_id]).execute(),
                lambda: shim.table("threads").select("thread_id").in_("thread_id", [thread_id]).execute())

    await check("in_ 空列表",
                lambda: sb.table("threads").select("thread_id").in_("thread_id", []).execute(),
                lambda: shim.table("threads").select("thread_id").in_("thread_id", []).execute())

    await check("gte 时间",
                lambda: sb.table("messages").select("message_id").gte("created_at", "2020-01-01").limit(5).execute(),
                lambda: shim.table("messages").select("message_id").gte("created_at", "2020-01-01").limit(5).execute())

    await check("ilike",
                lambda: sb.table("agents").select("agent_id, name").ilike("name", "%Zmind%").limit(5).execute(),
                lambda: shim.table("agents").select("agent_id, name").ilike("name", "%Zmind%").limit(5).execute())

    await check("or_ (两个 ilike)",
                lambda: sb.table("agents").select("agent_id").or_("name.ilike.%Zmind%,description.ilike.%Zmind%").limit(5).execute(),
                lambda: shim.table("agents").select("agent_id").or_("name.ilike.%Zmind%,description.ilike.%Zmind%").limit(5).execute())

    print("\n-- 排序 / 分页 / 计数 --")
    await check("order desc（保序比较）",
                lambda: sb.table("messages").select("message_id, created_at").order("created_at", desc=True).limit(8).execute(),
                lambda: shim.table("messages").select("message_id, created_at").order("created_at", desc=True).limit(8).execute(),
                ordered=True)

    await check("order asc（保序比较）",
                lambda: sb.table("messages").select("message_id, created_at").order("created_at", desc=False).limit(8).execute(),
                lambda: shim.table("messages").select("message_id, created_at").order("created_at", desc=False).limit(8).execute(),
                ordered=True)

    await check("range 分页（保序）",
                lambda: sb.table("messages").select("message_id").order("message_id").range(10, 19).execute(),
                lambda: shim.table("messages").select("message_id").order("message_id").range(10, 19).execute(),
                ordered=True)

    await check("count=exact",
                lambda: sb.table("threads").select("thread_id", count="exact").limit(1).execute(),
                lambda: shim.table("threads").select("thread_id", count="exact").limit(1).execute(),
                compare_count=True)

    await check("count=exact + 过滤",
                lambda: sb.table("messages").select("message_id", count="exact").eq("thread_id", thread_id).limit(1).execute(),
                lambda: shim.table("messages").select("message_id", count="exact").eq("thread_id", thread_id).limit(1).execute(),
                compare_count=True)

    print("\n-- single / maybe_single --")
    await check("single",
                lambda: sb.table("threads").select("*").eq("thread_id", thread_id).single().execute(),
                lambda: shim.table("threads").select("*").eq("thread_id", thread_id).single().execute())

    await check("maybe_single 命中",
                lambda: sb.table("threads").select("*").eq("thread_id", thread_id).maybe_single().execute(),
                lambda: shim.table("threads").select("*").eq("thread_id", thread_id).maybe_single().execute())

    await check("maybe_single 空",
                lambda: sb.table("threads").select("*").eq("thread_id", "00000000-0000-0000-0000-000000000000").maybe_single().execute(),
                lambda: shim.table("threads").select("*").eq("thread_id", "00000000-0000-0000-0000-000000000000").maybe_single().execute())

    print("\n-- jsonb / 嵌套 / 其他 schema --")
    await check("contains jsonb",
                lambda: sb.table("threads").select("thread_id").contains("metadata", {"source": "canvas"}).limit(5).execute(),
                lambda: shim.table("threads").select("thread_id").contains("metadata", {"source": "canvas"}).limit(5).execute())

    await check("嵌套 join: agent_runs -> threads",
                lambda: sb.table("agent_runs").select("id, thread_id, threads(account_id)").limit(5).execute(),
                lambda: shim.table("agent_runs").select("id, thread_id, threads(account_id)").limit(5).execute())

    await check("schema('basejump')",
                lambda: sb.schema("basejump").table("accounts").select("id, name").limit(5).execute(),
                lambda: shim.schema("basejump").table("accounts").select("id, name").limit(5).execute())

    await check("from_ 别名",
                lambda: sb.from_("threads").select("thread_id").limit(3).execute(),
                lambda: shim.from_("threads").select("thread_id").limit(3).execute())

    print("\n-- rpc --")
    await check("rpc 集合函数 search_canvas_nodes",
                lambda: sb.rpc("search_canvas_nodes", {"p_account_id": account_id, "p_query": "canvas"}).execute(),
                lambda: shim.rpc("search_canvas_nodes", {"p_account_id": account_id, "p_query": "canvas"}).execute())

    await check("rpc 标量函数 get_user_email",
                lambda: sb.rpc("get_user_email", {"user_id": account_id}).execute(),
                lambda: shim.rpc("get_user_email", {"user_id": account_id}).execute())

    await shim.close()

    print("\n" + "=" * 72)
    print(f"通过 {len(PASS)} / 失败 {len(FAIL)}")
    if FAIL:
        for n, why in FAIL:
            print(f"  ✗ {n}: {why}")
        return 1
    print("✅ 全部一致")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
