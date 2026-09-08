BEGIN;

CREATE TABLE IF NOT EXISTS public.projection_failures (
    projection_name TEXT NOT NULL,
    event_id UUID NOT NULL,
    event_type TEXT NOT NULL,
    schema_version INT NOT NULL DEFAULT 1,
    occurred_at TIMESTAMPTZ NOT NULL,
    aggregate_id TEXT NOT NULL,
    aggregate_type TEXT NOT NULL,
    tenant_id TEXT NULL,
    actor_id TEXT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    failure_count INT NOT NULL DEFAULT 1,
    first_failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_error TEXT NULL,
    PRIMARY KEY (projection_name, event_id)
);

CREATE INDEX IF NOT EXISTS idx_projection_failures_event_type
    ON public.projection_failures(event_type);

CREATE INDEX IF NOT EXISTS idx_projection_failures_last_failed_at
    ON public.projection_failures(last_failed_at);

ALTER TABLE public.projection_failures ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'projection_failures'
          AND policyname = 'service_role_all_projection_failures'
    ) THEN
        CREATE POLICY "service_role_all_projection_failures"
            ON public.projection_failures
            FOR ALL
            TO service_role
            USING (true)
            WITH CHECK (true);
    END IF;
END $$;

COMMIT;
