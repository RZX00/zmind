"""
PostgREST 兼容的 asyncpg 客户端 —— 用来替掉 supabase-py。

存在的理由：全后端有 700 处 `client.table(...).select(...).eq(...).execute()` 形式的
调用。与其改 700 个调用点，不如保持这套 API 形状不变、把底下的实现从
"HTTP 打 PostgREST" 换成 "asyncpg 直连 Postgres"。调用点一行不用改，还少一跳网络。

核心保真手段：**JSON 由 Postgres 生成，不在 Python 侧做类型映射。**
每个查询都被包成 `select coalesce(json_agg(t), '[]'::json) from (<真实查询>) t`，
返回的文本直接 json.loads。这与 PostgREST 内部做法一致，因此 uuid、timestamptz、
numeric、jsonb 等类型的表示形状天然与云端逐字节相同——不会出现 asyncpg 返回
UUID 对象而调用方拿字符串比较导致的静默失配。

只实现后端真实用到的算子（已对全仓库做过普查）：
  过滤  eq neq gt gte lt lte like ilike is_ in_ contains or_ filter
  修饰  select order limit range single maybe_single count="exact"
  写    insert update upsert(on_conflict) delete
  其他  .schema('basejump') / .from_() 别名 / 单层嵌套 join / rpc
"""

from __future__ import annotations

import json
import re
from typing import Any, Iterable, Optional, Sequence

import asyncpg

from core.utils.logger import logger


class PostgrestError(RuntimeError):
    """查询失败。调用方目前不区分异常类型（全仓库没有 catch supabase 异常的地方），
    统一抛这个即可。"""


class QueryResult:
    """替代 supabase-py 的 APIResponse。

    普查过全部 806 处 .execute() 的结果消费方式，只用到 .data 和 .count 两个属性，
    所以这里也只提供这两个。多提供属性反而会掩盖将来的误用。
    """

    __slots__ = ("data", "count")

    def __init__(self, data: Any, count: Optional[int] = None):
        self.data = data
        self.count = count

    def __repr__(self) -> str:  # 调试用
        n = len(self.data) if isinstance(self.data, list) else ("None" if self.data is None else 1)
        return f"<QueryResult rows={n} count={self.count}>"


def _quote_ident(name: str) -> str:
    """引用标识符。表名列名都来自代码字面量，但仍然做校验——
    万一将来有人把用户输入传进来，这里是最后一道闸。"""
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name or ""):
        raise PostgrestError(f"非法标识符: {name!r}")
    return f'"{name}"'


def _quote_qualified(schema: str, table: str) -> str:
    return f"{_quote_ident(schema)}.{_quote_ident(table)}"


class _Params:
    """收集查询参数，生成 $1 $2 …。所有值都走参数绑定，不做字符串拼接。"""

    def __init__(self) -> None:
        self.values: list[Any] = []

    def add(self, value: Any) -> str:
        self.values.append(value)
        return f"${len(self.values)}"


# PostgREST 的 or_ 语法：  "name.ilike.%x%,description.ilike.%x%"
# 拆成 (列, 算子, 值) 三元组。后端只用到 ilike/eq，但把常见算子都支持上。
_OR_OP_SQL = {
    "eq": "=",
    "neq": "<>",
    "gt": ">",
    "gte": ">=",
    "lt": "<",
    "lte": "<=",
    "like": "LIKE",
    "ilike": "ILIKE",
}

# 这些类型直接收 str，不需要补 ::类型 转换（见 _build_where 的说明）
_TEXTUAL_TYPES = frozenset({
    "text", "character varying", "character", "name", "citext", "uuid",
})


class _Query:
    """所有查询类型的公共基类：持有过滤条件与修饰符，并负责生成 WHERE 子句。"""

    def __init__(self, client: "AsyncPGClient", schema: str, table: str):
        self._client = client
        self._schema = schema
        self._table = table
        self._filters: list[tuple[str, str, Any]] = []   # (kind, column, value)
        self._order: list[tuple[str, bool]] = []          # (column, desc)
        self._limit: Optional[int] = None
        self._offset: Optional[int] = None

    # ---- 过滤算子：全部返回 self 以支持链式调用 ----

    def eq(self, column: str, value: Any) -> "_Query":
        self._filters.append(("eq", column, value)); return self

    def neq(self, column: str, value: Any) -> "_Query":
        self._filters.append(("neq", column, value)); return self

    def gt(self, column: str, value: Any) -> "_Query":
        self._filters.append(("gt", column, value)); return self

    def gte(self, column: str, value: Any) -> "_Query":
        self._filters.append(("gte", column, value)); return self

    def lt(self, column: str, value: Any) -> "_Query":
        self._filters.append(("lt", column, value)); return self

    def lte(self, column: str, value: Any) -> "_Query":
        self._filters.append(("lte", column, value)); return self

    def like(self, column: str, pattern: str) -> "_Query":
        self._filters.append(("like", column, pattern)); return self

    def ilike(self, column: str, pattern: str) -> "_Query":
        self._filters.append(("ilike", column, pattern)); return self

    def is_(self, column: str, value: Any) -> "_Query":
        # 后端 23 处调用全部传字符串 "null"（PostgREST 的写法），也兼容真 None / 布尔
        self._filters.append(("is", column, value)); return self

    def in_(self, column: str, values: Sequence[Any]) -> "_Query":
        self._filters.append(("in", column, list(values))); return self

    def contains(self, column: str, value: Any) -> "_Query":
        # 6 处调用全是 jsonb 包含判断：contains("metadata", {"doc_item_id": x})
        self._filters.append(("contains", column, value)); return self

    def or_(self, expression: str) -> "_Query":
        self._filters.append(("or", "", expression)); return self

    def filter(self, column: str, operator: str, value: Any) -> "_Query":
        self._filters.append((operator.lstrip("."), column, value)); return self

    # ---- 修饰符 ----

    def order(self, column: str, desc: bool = False, **_ignored: Any) -> "_Query":
        self._order.append((column, bool(desc))); return self

    def limit(self, n: int) -> "_Query":
        self._limit = int(n); return self

    def range(self, start: int, end: int) -> "_Query":
        # PostgREST 的 range 是双端闭区间
        self._offset = int(start)
        self._limit = max(0, int(end) - int(start) + 1)
        return self

    # ---- WHERE 生成 ----

    async def _build_where(self, p: _Params) -> str:
        """生成 WHERE 子句。

        为什么要查列类型：PostgREST 走 HTTP，所有过滤值都是文本，由 Postgres 自己
        往目标类型转换，所以 `.gte("created_at", "2020-01-01")` 传字符串没问题。
        而 asyncpg 是二进制协议，会先向 Postgres 问出 $1 的类型（timestamptz），
        然后拒绝一个 str，报 "expected a datetime.date or datetime.datetime instance"。
        后端大量代码传的正是 .isoformat() 字符串，所以必须显式 $n::<列类型> 把
        转换责任交回给 Postgres —— 这样行为就与 PostgREST 完全一致。
        """
        types = await self._client._column_types(self._schema, self._table)

        def bind(column: str, value: Any) -> str:
            """绑定一个标量值，必要时补类型转换。

            必须写成 `$n::text::<类型>` 而不是 `$n::<类型>`：后者会被 Postgres 的
            参数类型推断折叠掉——它直接把 $n 判成目标类型，asyncpg 于是照旧要求
            datetime 对象，转换等于没写。先落到 text 才能把转换责任真正交给 Postgres。
            """
            ph = p.add(value)
            coltype = types.get(column)
            if isinstance(value, str) and coltype and coltype not in _TEXTUAL_TYPES:
                return f"{ph}::text::{coltype}"
            return ph

        clauses: list[str] = []
        for kind, column, value in self._filters:
            if kind == "or":
                clauses.append(self._build_or(value, p))
                continue

            col = _quote_ident(column)
            if kind == "eq":
                clauses.append(f"{col} = {bind(column, value)}")
            elif kind == "neq":
                clauses.append(f"{col} <> {bind(column, value)}")
            elif kind == "gt":
                clauses.append(f"{col} > {bind(column, value)}")
            elif kind == "gte":
                clauses.append(f"{col} >= {bind(column, value)}")
            elif kind == "lt":
                clauses.append(f"{col} < {bind(column, value)}")
            elif kind == "lte":
                clauses.append(f"{col} <= {bind(column, value)}")
            elif kind == "like":
                clauses.append(f"{col}::text LIKE {p.add(value)}")
            elif kind == "ilike":
                clauses.append(f"{col}::text ILIKE {p.add(value)}")
            elif kind == "is":
                clauses.append(f"{col} {_is_predicate(value)}")
            elif kind == "in":
                if not value:
                    # PostgREST 对空 in 列表返回空集；ANY(空数组) 语义相同，
                    # 但显式写 false 更快也更清楚
                    clauses.append("false")
                else:
                    vals = list(value)
                    ph = p.add(vals)
                    coltype = types.get(column)
                    if coltype and any(isinstance(v, str) for v in vals) and coltype not in _TEXTUAL_TYPES:
                        clauses.append(f"{col} = ANY({ph}::text[]::{coltype}[])")
                    else:
                        clauses.append(f"{col} = ANY({ph})")
            elif kind == "contains":
                payload = value if isinstance(value, str) else json.dumps(value)
                clauses.append(f"{col} @> {p.add(payload)}::jsonb")
            else:
                raise PostgrestError(f"未实现的过滤算子: {kind}")

        return (" WHERE " + " AND ".join(clauses)) if clauses else ""

    def _build_or(self, expression: str, p: _Params) -> str:
        """解析 PostgREST 的 or 语法。注意值里可能含逗号（如 ilike 的 %a,b%），
        所以按 '列.算子.' 的模式切分，而不是无脑 split(',')。"""
        parts: list[str] = []
        for token in _split_or_expression(expression):
            m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)\.([a-z]+)\.(.*)$", token, re.S)
            if not m:
                raise PostgrestError(f"无法解析 or_ 片段: {token!r}")
            column, op, raw = m.group(1), m.group(2), m.group(3)
            col = _quote_ident(column)
            if op == "is":
                parts.append(f"{col} {_is_predicate(raw)}")
            elif op in ("like", "ilike"):
                parts.append(f"{col}::text {_OR_OP_SQL[op]} {p.add(raw)}")
            elif op in _OR_OP_SQL:
                parts.append(f"{col} {_OR_OP_SQL[op]} {p.add(raw)}")
            else:
                raise PostgrestError(f"or_ 中未实现的算子: {op}")
        if not parts:
            raise PostgrestError("or_ 表达式为空")
        return "(" + " OR ".join(parts) + ")"

    def _build_tail(self) -> str:
        sql = ""
        if self._order:
            cols = ", ".join(
                f"{_quote_ident(c)} {'DESC' if d else 'ASC'}" for c, d in self._order
            )
            sql += f" ORDER BY {cols}"
        if self._limit is not None:
            sql += f" LIMIT {int(self._limit)}"
        if self._offset:
            sql += f" OFFSET {int(self._offset)}"
        return sql

    @property
    def _relation(self) -> str:
        return _quote_qualified(self._schema, self._table)


def _is_predicate(value: Any) -> str:
    """把 .is_() 的值翻成 SQL 谓词。"""
    if value is None or (isinstance(value, str) and value.lower() == "null"):
        return "IS NULL"
    if value is True or (isinstance(value, str) and value.lower() == "true"):
        return "IS TRUE"
    if value is False or (isinstance(value, str) and value.lower() == "false"):
        return "IS FALSE"
    raise PostgrestError(f"is_ 不支持的值: {value!r}")


def _split_or_expression(expression: str) -> list[str]:
    """按顶层逗号切分 or_ 表达式，跳过括号内的逗号。"""
    out, depth, buf = [], 0, []
    for ch in expression:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            out.append("".join(buf).strip()); buf = []
        else:
            buf.append(ch)
    if buf:
        out.append("".join(buf).strip())
    return [t for t in out if t]


class _SelectQuery(_Query):
    def __init__(self, client, schema, table, columns: str, count: Optional[str]):
        super().__init__(client, schema, table)
        self._columns_raw = columns or "*"
        self._count_mode = count
        self._single = False
        self._maybe_single = False

    def single(self) -> "_SelectQuery":
        self._single = True; return self

    def maybe_single(self) -> "_SelectQuery":
        self._maybe_single = True; return self

    async def execute(self) -> QueryResult:
        p = _Params()
        select_list = await self._build_select_list()
        where = await self._build_where(p)
        inner = f"SELECT {select_list} FROM {self._relation}{where}{self._build_tail()}"

        # 让 Postgres 生成 JSON：形状与 PostgREST 一致，规避一切 Python 侧类型映射
        sql = f"SELECT coalesce(json_agg(_t), '[]'::json)::text FROM ({inner}) _t"

        rows = await self._client._fetchval(sql, p.values)
        data = json.loads(rows) if rows else []

        count = None
        if self._count_mode == "exact":
            cp = _Params()
            cwhere = await self._build_where(cp)
            count = await self._client._fetchval(
                f"SELECT count(*) FROM {self._relation}{cwhere}", cp.values
            )

        if self._single or self._maybe_single:
            if len(data) == 1:
                return QueryResult(data[0], count)
            if len(data) == 0 and self._maybe_single:
                # ⚠️ 刻意复刻 supabase-py 2.17.0 的行为：maybe_single() 无命中时
                # execute() 返回 None 本身，而不是 data=None 的响应对象（已实测确认）。
                # 这会让调用方的 `result.data` 抛 AttributeError —— 那是仓库里既有的
                # 潜在缺陷（如 core/agent_crud.py:87 本该返回 404 却会崩成 500）。
                # 迁移层的职责是保真，不在这里顺手改语义；该缺陷单独修。
                return None
            raise PostgrestError(
                f"single() 期望恰好 1 行，实际 {len(data)} 行 "
                f"({self._schema}.{self._table})"
            )

        return QueryResult(data, count)

    async def _build_select_list(self) -> str:
        """把 PostgREST 的 select 串翻成 SQL 选择列表。

        支持单层嵌套（全仓库只有 2 处，形如 "*, threads(account_id)"）：
        通过外键反查关联，生成一个返回 jsonb 对象的相关子查询，键名用关联表名，
        与 PostgREST 的多对一嵌套输出形状一致。
        """
        raw = self._columns_raw.strip()
        if raw == "*":
            return "*"

        plain: list[str] = []
        embeds: list[str] = []

        for token in _split_top_level(raw):
            m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)\s*\((.*)\)$", token, re.S)
            if m:
                embeds.append(await self._build_embed(m.group(1), m.group(2)))
            elif token == "*":
                plain.append("*")
            else:
                plain.append(_quote_ident(token))

        return ", ".join(plain + embeds) if (plain or embeds) else "*"

    async def _build_embed(self, rel: str, cols: str) -> str:
        fk = await self._client._lookup_fk(self._schema, self._table, rel)
        if not fk:
            raise PostgrestError(
                f"找不到 {self._schema}.{self._table} 指向 {rel} 的外键，无法展开嵌套查询"
            )
        local_cols, ref_schema, ref_table, ref_cols = fk

        sub_cols = ", ".join(
            _quote_ident(c.strip()) for c in cols.split(",") if c.strip()
        ) or "*"

        on = " AND ".join(
            f"_e.{_quote_ident(rc)} = {self._relation}.{_quote_ident(lc)}"
            for lc, rc in zip(local_cols, ref_cols)
        )
        ref = _quote_qualified(ref_schema, ref_table)
        return (
            f"(SELECT to_jsonb(_x) FROM "
            f"(SELECT {sub_cols} FROM {ref} _e WHERE {on} LIMIT 1) _x) AS {_quote_ident(rel)}"
        )


def _split_top_level(s: str) -> list[str]:
    """按顶层逗号切分 select 串，括号内的逗号属于嵌套列表，不切。"""
    out, depth, buf = [], 0, []
    for ch in s:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            out.append("".join(buf).strip()); buf = []
        else:
            buf.append(ch)
    if buf:
        out.append("".join(buf).strip())
    return [t for t in out if t]


class _WriteQuery(_Query):
    """insert / update / upsert / delete 的共同实现。

    PostgREST 默认对写操作返回受影响的行（Prefer: return=representation），
    supabase-py 也是这个行为，所以这里一律带 RETURNING *。
    """

    def __init__(self, client, schema, table, kind: str,
                 rows: Any = None, on_conflict: Optional[str] = None):
        super().__init__(client, schema, table)
        self._kind = kind
        self._rows = rows
        self._on_conflict = on_conflict
        self._count_mode: Optional[str] = None

    def single(self) -> "_WriteQuery":
        self._single = True; return self

    async def execute(self) -> QueryResult:
        p = _Params()
        if self._kind == "delete":
            inner = f"DELETE FROM {self._relation}{await self._build_where(p)} RETURNING *"
        elif self._kind == "update":
            types = await self._client._column_types(self._schema, self._table)
            parts = []
            for k, v in self._rows.items():
                ph = p.add(_encode(v))
                ct = types.get(k)
                # 与过滤同理：写入 timestamptz/numeric 等列时后端常传字符串
                if isinstance(v, str) and ct and ct not in _TEXTUAL_TYPES:
                    ph = f"{ph}::text::{ct}"   # 双段转换，理由见 _build_where.bind
                parts.append(f"{_quote_ident(k)} = {ph}")
            if not parts:
                raise PostgrestError("update 的赋值为空")
            sets = ", ".join(parts)
            inner = f"UPDATE {self._relation} SET {sets}{await self._build_where(p)} RETURNING *"
        else:  # insert / upsert
            rows = self._rows if isinstance(self._rows, list) else [self._rows]
            if not rows:
                return QueryResult([], None)
            columns = list(rows[0].keys())
            col_sql = ", ".join(_quote_ident(c) for c in columns)
            types = await self._client._column_types(self._schema, self._table)
            tuples = []
            for r in rows:
                cells = []
                for c in columns:
                    v = r.get(c)
                    ph = p.add(_encode(v))
                    ct = types.get(c)
                    if isinstance(v, str) and ct and ct not in _TEXTUAL_TYPES:
                        ph = f"{ph}::text::{ct}"   # 双段转换，理由见 _build_where.bind
                    cells.append(ph)
                tuples.append("(" + ", ".join(cells) + ")")
            inner = f"INSERT INTO {self._relation} ({col_sql}) VALUES {', '.join(tuples)}"
            if self._kind == "upsert":
                # on_conflict 未显式给出时用主键，与 PostgREST 的默认行为一致
                target = self._on_conflict or await self._client._lookup_pk(
                    self._schema, self._table
                )
                if not target:
                    raise PostgrestError(
                        f"{self._schema}.{self._table} 没有主键且未指定 on_conflict，"
                        f"无法执行 upsert"
                    )
                conflict_cols = ", ".join(
                    _quote_ident(c.strip()) for c in target.split(",") if c.strip()
                )
                updates = ", ".join(
                    f"{_quote_ident(c)} = EXCLUDED.{_quote_ident(c)}"
                    for c in columns
                    if c not in {t.strip() for t in target.split(",")}
                )
                inner += (
                    f" ON CONFLICT ({conflict_cols}) DO UPDATE SET {updates}"
                    if updates
                    else f" ON CONFLICT ({conflict_cols}) DO NOTHING"
                )
            inner += " RETURNING *"

        sql = f"WITH _w AS ({inner}) SELECT coalesce(json_agg(_w), '[]'::json)::text FROM _w"
        raw = await self._client._fetchval(sql, p.values)
        data = json.loads(raw) if raw else []

        if getattr(self, "_single", False):
            return QueryResult(data[0] if data else None, None)
        return QueryResult(data, None)


def _encode(value: Any) -> Any:
    """dict / list 要以 JSON 文本形式绑定，交给 Postgres 隐式转成 jsonb。"""
    if isinstance(value, (dict, list)):
        return json.dumps(value)
    return value


class _TableRef:
    def __init__(self, client: "AsyncPGClient", schema: str, table: str):
        self._client, self._schema, self._table = client, schema, table

    def select(self, columns: str = "*", count: Optional[str] = None, **_kw) -> _SelectQuery:
        return _SelectQuery(self._client, self._schema, self._table, columns, count)

    def insert(self, rows: Any, **_kw) -> _WriteQuery:
        return _WriteQuery(self._client, self._schema, self._table, "insert", rows)

    def upsert(self, rows: Any, on_conflict: Optional[str] = None, **_kw) -> _WriteQuery:
        return _WriteQuery(self._client, self._schema, self._table, "upsert", rows, on_conflict)

    def update(self, values: dict, **_kw) -> _WriteQuery:
        return _WriteQuery(self._client, self._schema, self._table, "update", values)

    def delete(self, **_kw) -> _WriteQuery:
        return _WriteQuery(self._client, self._schema, self._table, "delete")


class _RpcQuery:
    """PostgREST 的 rpc。

    返回形状必须区分标量函数和集合函数——这是实测出来的真实差异：
    `get_user_email` 是标量，调用方直接 `email = result.data`；
    `search_canvas_nodes` 返回 TABLE，调用方 `rows = result.data or []`。
    用 pg_proc.proretset 判定，与 PostgREST 的规则一致。
    """

    def __init__(self, client: "AsyncPGClient", schema: str, fn: str, params: Optional[dict]):
        self._client, self._schema, self._fn = client, schema, fn
        self._params = params or {}

    async def execute(self) -> QueryResult:
        p = _Params()
        args = ", ".join(
            f"{_quote_ident(k)} => {p.add(_encode(v))}" for k, v in self._params.items()
        )
        call = f"{_quote_qualified(self._schema, self._fn)}({args})"

        returns_set = await self._client._function_returns_set(self._schema, self._fn)
        if returns_set:
            sql = (
                f"SELECT coalesce(json_agg(_r), '[]'::json)::text "
                f"FROM (SELECT * FROM {call}) _r"
            )
            raw = await self._client._fetchval(sql, p.values)
            return QueryResult(json.loads(raw) if raw else [])

        sql = f"SELECT to_json({call})::text"
        raw = await self._client._fetchval(sql, p.values)
        return QueryResult(json.loads(raw) if raw is not None else None)


class _SchemaScoped:
    """`.schema('basejump')` 的返回值。后端有 26 处这种调用。"""

    def __init__(self, client: "AsyncPGClient", schema: str):
        self._client, self._schema = client, schema

    def table(self, name: str) -> _TableRef:
        return _TableRef(self._client, self._schema, name)

    def from_(self, name: str) -> _TableRef:
        return self.table(name)

    def rpc(self, fn: str, params: Optional[dict] = None) -> _RpcQuery:
        return _RpcQuery(self._client, self._schema, fn, params)


class AsyncPGClient:
    """对外形状与 supabase.AsyncClient 一致的部分。"""

    def __init__(self, pool: asyncpg.Pool):
        self._pool = pool
        self._fk_cache: dict[tuple[str, str, str], Any] = {}
        self._pk_cache: dict[tuple[str, str], Optional[str]] = {}
        self._retset_cache: dict[tuple[str, str], bool] = {}
        self._coltype_cache: dict[tuple[str, str], dict[str, str]] = {}

    # ---- 对外 API ----

    def table(self, name: str) -> _TableRef:
        return _TableRef(self, "public", name)

    def from_(self, name: str) -> _TableRef:
        return self.table(name)

    def schema(self, name: str) -> _SchemaScoped:
        return _SchemaScoped(self, name)

    def rpc(self, fn: str, params: Optional[dict] = None) -> _RpcQuery:
        return _RpcQuery(self, "public", fn, params)

    async def close(self) -> None:
        await self._pool.close()

    # ---- 内部 ----

    async def _fetchval(self, sql: str, params: list[Any]) -> Any:
        try:
            async with self._pool.acquire() as conn:
                return await conn.fetchval(sql, *params)
        except asyncpg.PostgresError as e:
            logger.error(f"[db] 查询失败: {e}\nSQL: {sql}")
            raise PostgrestError(str(e)) from e

    async def _column_types(self, schema: str, table: str) -> dict[str, str]:
        """列名 -> 类型名（format_type 的输出，可直接用于 ::cast）。整表缓存，
        每张表一生只查一次。"""
        key = (schema, table)
        if key in self._coltype_cache:
            return self._coltype_cache[key]
        sql = """
            SELECT a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod)
            FROM pg_attribute a
            JOIN pg_class     c ON c.oid = a.attrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = $1 AND c.relname = $2
              AND a.attnum > 0 AND NOT a.attisdropped
        """
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(sql, schema, table)
        result = {r[0]: r[1] for r in rows}
        self._coltype_cache[key] = result
        return result

    async def _lookup_fk(self, schema: str, table: str, rel: str):
        key = (schema, table, rel)
        if key in self._fk_cache:
            return self._fk_cache[key]
        sql = """
            SELECT
              (SELECT array_agg(a.attname ORDER BY x.ord)
                 FROM unnest(c.conkey) WITH ORDINALITY AS x(attnum, ord)
                 JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = x.attnum),
              rn.nspname, rc.relname,
              (SELECT array_agg(a.attname ORDER BY x.ord)
                 FROM unnest(c.confkey) WITH ORDINALITY AS x(attnum, ord)
                 JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = x.attnum)
            FROM pg_constraint c
            JOIN pg_class      bc ON bc.oid = c.conrelid
            JOIN pg_namespace  bn ON bn.oid = bc.relnamespace
            JOIN pg_class      rc ON rc.oid = c.confrelid
            JOIN pg_namespace  rn ON rn.oid = rc.relnamespace
            WHERE c.contype = 'f' AND bn.nspname = $1 AND bc.relname = $2 AND rc.relname = $3
            LIMIT 1
        """
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(sql, schema, table, rel)
        result = (list(row[0]), row[1], row[2], list(row[3])) if row else None
        self._fk_cache[key] = result
        return result

    async def _lookup_pk(self, schema: str, table: str) -> Optional[str]:
        key = (schema, table)
        if key in self._pk_cache:
            return self._pk_cache[key]
        sql = """
            SELECT string_agg(a.attname, ',' ORDER BY x.ord)
            FROM pg_constraint c
            JOIN pg_class     bc ON bc.oid = c.conrelid
            JOIN pg_namespace bn ON bn.oid = bc.relnamespace,
            unnest(c.conkey) WITH ORDINALITY AS x(attnum, ord)
            JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = x.attnum
            WHERE c.contype = 'p' AND bn.nspname = $1 AND bc.relname = $2
            GROUP BY c.oid
        """
        async with self._pool.acquire() as conn:
            val = await conn.fetchval(sql, schema, table)
        self._pk_cache[key] = val
        return val

    async def _function_returns_set(self, schema: str, fn: str) -> bool:
        key = (schema, fn)
        if key in self._retset_cache:
            return self._retset_cache[key]
        sql = """
            SELECT bool_or(p.proretset)
            FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = $1 AND p.proname = $2
        """
        async with self._pool.acquire() as conn:
            val = await conn.fetchval(sql, schema, fn)
        result = bool(val)
        self._retset_cache[key] = result
        return result


async def create_client(dsn: str, *, min_size: int = 2, max_size: int = 20) -> AsyncPGClient:
    pool = await asyncpg.create_pool(
        dsn,
        min_size=min_size,
        max_size=max_size,
        command_timeout=60,
        # search_path 与云端一致：extensions 里放着 gen_random_uuid 等列默认值用到的函数
        server_settings={"search_path": "public,extensions"},
    )
    return AsyncPGClient(pool)
