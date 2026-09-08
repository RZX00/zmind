BEGIN;

CREATE TABLE IF NOT EXISTS public.event_audit (
    event_id UUID PRIMARY KEY,
    event_type TEXT NOT NULL,
    schema_version INT NOT NULL DEFAULT 1,
    occurred_at TIMESTAMPTZ NOT NULL,
    aggregate_id TEXT NOT NULL,
    aggregate_type TEXT NOT NULL,
    tenant_id TEXT NULL,
    actor_id TEXT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_audit_type
    ON public.event_audit(event_type);

CREATE INDEX IF NOT EXISTS idx_event_audit_occurred_at
    ON public.event_audit(occurred_at);

CREATE INDEX IF NOT EXISTS idx_event_audit_tenant
    ON public.event_audit(tenant_id);

ALTER TABLE public.event_audit ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'event_audit'
          AND policyname = 'service_role_all_event_audit'
    ) THEN
        CREATE POLICY "service_role_all_event_audit"
            ON public.event_audit
            FOR ALL
            TO service_role
            USING (true)
            WITH CHECK (true);
    END IF;
END $$;

COMMIT;
