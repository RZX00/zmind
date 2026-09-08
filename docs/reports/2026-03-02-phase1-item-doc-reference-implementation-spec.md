# Phase 1 Implementation Spec

| 字段 | 内容 |
|---|---|
| 项目 | Canvas + Markdown Unified Knowledge OS |
| 文档类型 | Phase 1 领域实现规格 |
| 版本 | v1.0 |
| 日期 | 2026-03-02 |
| 前置 | `docs/reports/2026-03-02-phase0-canvas-md-execution-playbook.md` |

## 1. Phase 1 范围

Phase 1 目标是“完成后端主干能力”，但仍保持前端大范围 UI 变更最小化：

1. 引入统一 `items` 模型（doc/canvas 双类型）。
2. 引入 `docs` 与 `references` 主存储与查询能力。
3. 扩展 workspace 聚合接口可返回 doc/item 基础信息。
4. 保持与现有 `canvases + folders` 兼容，支持灰度双读。
5. 冻结 Doc 图片上传契约，复用现有编辑器上传能力与媒体代理链路。

## 2. 目标架构（Phase 1）

```text
Client/BFF
  -> /items /docs /references /workspace/meta
  -> Application Service (Items/Docs/References)
  -> Repository (Supabase)
  -> Redis (version + patch channel)
  -> workspace ws patch
```

## 3. 数据模型设计（DDL 草案）

## 3.1 items

```sql
create table if not exists public.items (
  id text primary key,
  account_id text not null references basejump.accounts(id) on delete cascade,
  type text not null check (type in ('canvas','doc')),
  title text not null,
  folder_id text null references public.folders(id) on delete set null,
  parent_item_id text null references public.items(id) on delete set null,
  source_id text null, -- 关联 legacy 主对象: canvas_id or doc_id
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_items_account_updated
  on public.items(account_id, updated_at desc)
  where is_deleted = false;

create index if not exists idx_items_parent
  on public.items(account_id, parent_item_id)
  where is_deleted = false;
```

## 3.2 docs

```sql
create table if not exists public.docs (
  item_id text primary key references public.items(id) on delete cascade,
  content_md text not null default '',
  frontmatter jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

## 3.3 doc_blocks（可选物化）

```sql
create table if not exists public.doc_blocks (
  block_id text primary key,
  item_id text not null references public.items(id) on delete cascade,
  block_type text not null default 'paragraph',
  anchor text not null,
  text_preview text not null default '',
  hash text not null,
  order_index int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_doc_blocks_item_order
  on public.doc_blocks(item_id, order_index);
```

## 3.4 references

```sql
create table if not exists public.references (
  id text primary key,
  account_id text not null references basejump.accounts(id) on delete cascade,
  source_type text not null check (source_type in ('canvas_node','doc_block')),
  source_item_id text not null references public.items(id) on delete cascade,
  source_anchor text null,
  target_type text not null check (target_type in ('doc','doc_block','canvas')),
  target_item_id text not null references public.items(id) on delete cascade,
  target_anchor text null,
  mode text not null check (mode in ('reference','snapshot')),
  snapshot_payload jsonb null,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_refs_target
  on public.references(account_id, target_item_id)
  where is_deleted = false;

create index if not exists idx_refs_source
  on public.references(account_id, source_item_id)
  where is_deleted = false;
```

## 4. API 设计（Phase 1 可交付）

## 4.1 Items API

| Endpoint | Method | 说明 |
|---|---|---|
| `/items` | GET | 按 workspace 列表，支持 type/folder/parent 过滤 |
| `/items` | POST | 新建 item（doc/canvas） |
| `/items/{id}` | GET | 读取 item 元信息 |
| `/items/{id}` | PUT | 更新 title/folder/parent |
| `/items/{id}` | DELETE | 软删 item |
| `/items/{id}/move` | POST | 原子移动（folder+parent） |

### 请求头约束

1. 必须有 `X-Workspace-Id`。
2. 变更接口建议携带 `X-Client-Request-Id`。

## 4.2 Docs API

| Endpoint | Method | 说明 |
|---|---|---|
| `/docs` | POST | 创建 doc 并绑定 item(type=doc) |
| `/docs/{item_id}` | GET | 获取 markdown 文档 |
| `/docs/{item_id}` | PUT | 更新 markdown（If-Match） |
| `/docs/{item_id}/blocks` | GET | 返回块级锚点 |
| `/docs/{item_id}/images` | POST | 上传图片并返回可渲染 URL + markdown 片段建议 |

### Docs Image Contract

1. 服务端接收图片后复用现有文件上传意图链路，`source` 标记为 `doc`。
2. 返回 URL 必须是可权限校验的代理 URL，不返回裸存储路径。
3. 返回体包含建议 markdown 片段，便于编辑器直接插入：

```json
{
  "url": "/api/media/file-uploads/....",
  "markdown": "![image](...url...)",
  "fileId": "file_xxx"
}
```

## 4.3 References API

| Endpoint | Method | 说明 |
|---|---|---|
| `/references` | POST | 创建引用边（支持 reference/snapshot） |
| `/references/{id}` | DELETE | 删除引用边 |
| `/references/backlinks` | GET | 按 target 查询反链 |
| `/references/resolve` | POST | 批量解析引用（权限过滤） |

## 4.4 Workspace 扩展

`/workspace/meta` 在现有 payload 上新增可选字段：

```json
{
  "items": [],
  "docsMeta": [],
  "refsSummary": {
    "inboundCountByItem": {},
    "outboundCountByItem": {}
  }
}
```

兼容要求：
1. 旧前端可忽略新增字段。
2. 新前端优先读 `items`，缺失时回退 `folders + canvases`。

## 5. 后端代码分层与文件规划

```text
backend/core
├── items/
│   ├── api.py
│   ├── api_models.py
│   ├── service.py
│   └── repository.py
├── docs/
│   ├── api.py
│   ├── api_models.py
│   ├── service.py
│   ├── block_extractor.py
│   └── repository.py
└── references/
    ├── api.py
    ├── api_models.py
    ├── service.py
    └── repository.py
```

## 6. 兼容策略（双读/双写）

## 6.1 双读

```text
read workspace meta
  -> if feature_item_model_on:
       read items + docs meta + canvases/folders
     else:
       read legacy folders + canvases only
```

## 6.2 双写（可配置）

```text
canvas create/update/move
  -> write legacy canvases
  -> if feature_dual_write_items:
       upsert items(type=canvas)

doc create/update
  -> write docs + items(type=doc)
doc image upload
  -> use unified file pipeline (source=doc) + proxy url
```

## 7. 一致性约束

1. `items.parent_item_id` 不允许形成环。
2. `item.folder_id` 与 `item.parent_item_id` 可并存，但 parent 不可跨 workspace。
3. `references` 源/目标都必须在同 workspace，除非后续跨空间分享策略显式允许。
4. 删除 item 时 reference 逻辑删除，不做硬删除丢证据。

## 8. 迁移计划（Phase 1 实施）

## 8.1 Backfill 任务

```text
Job A: canvases -> items(type=canvas)
Job B: folders relation -> item.folder_id
Job C: parent mapping (可选，初始为空)
Job D: 校验并输出差异报告
```

## 8.2 幂等规则

1. backfill 以 `(account_id, source_id, type)` 作为自然幂等键。
2. 重跑不重复插入，只修复缺失字段。

## 8.3 失败恢复

1. 分批迁移（按 workspace 分片）。
2. 保存每批 checkpoint（last_account_id）。
3. 单批失败不阻断全局，进入重试队列。

## 9. 测试计划

## 9.1 单元测试

1. parent cycle check。
2. block extractor 稳定 anchor。
3. reference resolver 权限过滤。

## 9.2 集成测试

1. `/items` CRUD + move。
2. `/docs` PUT 并发更新（If-Match）。
3. `/references/backlinks` 返回正确且过滤越权数据。
4. workspace meta 在 feature flag 两种模式下都正确。
5. doc image upload returns proxy URL and markdown snippet.

## 9.3 回归测试

1. 现有 canvas 新建/删除/移动不回归。
2. 现有 folder 逻辑不回归。

## 10. 观测指标

| 指标 | 目标 |
|---|---|
| items backfill 成功率 | >= 99.99% |
| references 解析失败率 | < 0.1% |
| docs PUT 冲突率 | 可观测且有重试策略 |
| workspace meta 响应 p95 | < 500ms（meta 模式） |
| doc image upload 成功率 | >= 99.9% |

## 11. Feature Flags

| Flag | 默认 | 说明 |
|---|---|---|
| `feature_item_model_on` | off | 开启 items 读路径 |
| `feature_dual_write_items` | off | 开启 canvas -> item 双写 |
| `feature_docs_on` | off | 开启 docs API |
| `feature_references_on` | off | 开启 references API |
| `feature_doc_images_on` | off | 开启 doc 图片上传接口 |

## 12. 交付里程碑

| Milestone | 内容 |
|---|---|
| M1 | DDL + API model + repository skeleton |
| M2 | items/docs/references API 可跑通 |
| M3 | workspace meta 扩展 + 双读可切换 |
| M4 | backfill dry-run + integrity report |
| M5 | pilot workspace 灰度 |

## 13. Phase 1 完成定义

满足以下条件视为完成：

1. items/docs/references API 在灰度 workspace 可用。
2. workspace meta 可返回 items 增量字段且不影响旧前端。
3. backfill 完成并通过完整性校验。
4. 关键链路可观测，出现问题可按 requestId 排查。
