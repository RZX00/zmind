-- Native Doc Agent editing support: revisions, operation journal, idempotency

create table if not exists public.doc_revisions (
  id text primary key,
  item_id text not null references public.items(id) on delete cascade,
  account_id uuid not null references basejump.accounts(id) on delete cascade,
  base_version bigint not null,
  new_version bigint not null,
  actor_type text not null default 'agent' check (actor_type in ('user', 'agent', 'system')),
  actor_id text null,
  agent_run_id text null,
  thread_id text null,
  summary text not null default '',
  ops_json jsonb not null default '[]'::jsonb,
  content_before text not null default '',
  content_after text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_doc_revisions_item_created
  on public.doc_revisions(item_id, created_at desc);

create index if not exists idx_doc_revisions_account_created
  on public.doc_revisions(account_id, created_at desc);

create table if not exists public.doc_operation_journal (
  id text primary key,
  revision_id text not null references public.doc_revisions(id) on delete cascade,
  item_id text not null references public.items(id) on delete cascade,
  account_id uuid not null references basejump.accounts(id) on delete cascade,
  op_index int not null,
  op_type text not null,
  payload_json jsonb not null default '{}'::jsonb,
  status text not null default 'applied' check (status in ('applied', 'failed', 'skipped')),
  error_code text null,
  latency_ms int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_doc_op_journal_revision
  on public.doc_operation_journal(revision_id, op_index);

create index if not exists idx_doc_op_journal_item_created
  on public.doc_operation_journal(item_id, created_at desc);

create table if not exists public.doc_idempotency_keys (
  item_id text not null references public.items(id) on delete cascade,
  idempotency_key text not null,
  account_id uuid not null references basejump.accounts(id) on delete cascade,
  revision_id text null references public.doc_revisions(id) on delete set null,
  response_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz null,
  primary key (item_id, idempotency_key)
);

create index if not exists idx_doc_idempotency_account_created
  on public.doc_idempotency_keys(account_id, created_at desc);
