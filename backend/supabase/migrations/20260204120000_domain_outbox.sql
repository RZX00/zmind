BEGIN;

CREATE TABLE IF NOT EXISTS public.domain_outbox (
    event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type TEXT NOT NULL,
    schema_version INT NOT NULL DEFAULT 1,
    occurred_at TIMESTAMPTZ NOT NULL,
    aggregate_id TEXT NOT NULL,
    aggregate_type TEXT NOT NULL,
    tenant_id TEXT NULL,
    actor_id TEXT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    published_at TIMESTAMPTZ NULL,
    publish_attempts INT NOT NULL DEFAULT 0,
    last_attempted_at TIMESTAMPTZ NULL,
    last_error TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_domain_outbox_pending
    ON public.domain_outbox(published_at)
    WHERE published_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_domain_outbox_occurred_at
    ON public.domain_outbox(occurred_at);

CREATE INDEX IF NOT EXISTS idx_domain_outbox_tenant
    ON public.domain_outbox(tenant_id);

ALTER TABLE public.domain_outbox ENABLE ROW LEVEL SECURITY;

COMMIT;
