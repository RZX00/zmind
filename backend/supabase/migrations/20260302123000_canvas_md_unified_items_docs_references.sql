-- Canvas + Markdown unified knowledge model (Phase 1)

create table if not exists public.items (
  id text primary key,
  account_id uuid not null references basejump.accounts(id) on delete cascade,
  type text not null check (type in ('canvas','doc')),
  title text not null,
  folder_id text null references public.folders(id) on delete set null,
  parent_item_id text null references public.items(id) on delete set null,
  source_id text null,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_items_source_nondeleted
  on public.items(account_id, type, source_id)
  where source_id is not null and is_deleted = false;

create index if not exists idx_items_account_updated
  on public.items(account_id, updated_at desc)
  where is_deleted = false;

create index if not exists idx_items_parent
  on public.items(account_id, parent_item_id)
  where is_deleted = false;

create table if not exists public.docs (
  item_id text primary key references public.items(id) on delete cascade,
  content_md text not null default '',
  frontmatter jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_docs_updated
  on public.docs(updated_at desc);

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

create index if not exists idx_doc_blocks_item_anchor
  on public.doc_blocks(item_id, anchor);

create table if not exists public.references (
  id text primary key,
  account_id uuid not null references basejump.accounts(id) on delete cascade,
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

create index if not exists idx_refs_target_anchor
  on public.references(account_id, target_item_id, target_anchor)
  where is_deleted = false;
