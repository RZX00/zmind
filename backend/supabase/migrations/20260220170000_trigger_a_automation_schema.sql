BEGIN;

CREATE TABLE IF NOT EXISTS public.automations (
    automation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES basejump.accounts(id) ON DELETE CASCADE,
    agent_id UUID NULL REFERENCES public.agents(agent_id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    description TEXT NULL,
    trigger_type TEXT NOT NULL CHECK (trigger_type IN ('schedule', 'event')),
    provider TEXT NULL,
    provider_binding_key TEXT NULL,
    route_type TEXT NOT NULL DEFAULT 'agent' CHECK (route_type IN ('agent', 'workflow')),
    route_ref TEXT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by UUID NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT automations_schedule_config_ck CHECK (
        trigger_type <> 'schedule' OR config ? 'cron_expression'
    ),
    CONSTRAINT automations_event_provider_ck CHECK (
        trigger_type <> 'event' OR provider IS NOT NULL
    ),
    CONSTRAINT automations_agent_route_ck CHECK (
        route_type <> 'agent' OR agent_id IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS idx_automations_account_active
    ON public.automations(account_id, is_active);

CREATE INDEX IF NOT EXISTS idx_automations_account_trigger
    ON public.automations(account_id, trigger_type);

CREATE UNIQUE INDEX IF NOT EXISTS ux_automations_account_provider_binding
    ON public.automations(account_id, provider, provider_binding_key)
    WHERE provider_binding_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.automation_bindings (
    binding_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    automation_id UUID NOT NULL REFERENCES public.automations(automation_id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES basejump.accounts(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    match_strategy TEXT NOT NULL DEFAULT 'exact' CHECK (match_strategy IN ('exact', 'prefix', 'jsonpath')),
    match_value JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_bindings_automation
    ON public.automation_bindings(automation_id);

CREATE INDEX IF NOT EXISTS idx_automation_bindings_account_active
    ON public.automation_bindings(account_id, is_active);

CREATE INDEX IF NOT EXISTS idx_automation_bindings_provider
    ON public.automation_bindings(provider);

CREATE TABLE IF NOT EXISTS public.provider_events (
    provider_event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NULL REFERENCES basejump.accounts(id) ON DELETE SET NULL,
    provider TEXT NOT NULL,
    external_event_id TEXT NULL,
    event_type TEXT NULL,
    signature_valid BOOLEAN NOT NULL DEFAULT TRUE,
    dedupe_key TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    headers JSONB NOT NULL DEFAULT '{}'::jsonb,
    processing_status TEXT NOT NULL DEFAULT 'received' CHECK (
        processing_status IN ('received', 'dispatched', 'ignored', 'failed')
    ),
    processing_error TEXT NULL,
    dispatched_at TIMESTAMPTZ NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_provider_events_dedupe_key
    ON public.provider_events(dedupe_key);

CREATE INDEX IF NOT EXISTS idx_provider_events_status_received
    ON public.provider_events(processing_status, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_provider_events_provider_received
    ON public.provider_events(provider, received_at DESC);

CREATE TABLE IF NOT EXISTS public.automation_runs (
    run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    automation_id UUID NOT NULL REFERENCES public.automations(automation_id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES basejump.accounts(id) ON DELETE CASCADE,
    provider_event_id UUID NULL REFERENCES public.provider_events(provider_event_id) ON DELETE SET NULL,
    trigger_source TEXT NOT NULL CHECK (trigger_source IN ('schedule', 'event', 'manual')),
    triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status TEXT NOT NULL DEFAULT 'queued' CHECK (
        status IN ('queued', 'running', 'completed', 'failed', 'cancelled', 'dead_lettered')
    ),
    retry_count INT NOT NULL DEFAULT 0,
    max_retries INT NOT NULL DEFAULT 5,
    external_run_key TEXT NULL,
    agent_run_id UUID NULL REFERENCES public.agent_runs(id) ON DELETE SET NULL,
    error_code TEXT NULL,
    error_message TEXT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT automation_runs_retry_bounds_ck CHECK (retry_count >= 0 AND max_retries >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_automation_runs_event_once
    ON public.automation_runs(automation_id, provider_event_id)
    WHERE provider_event_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_automation_runs_external_run_key
    ON public.automation_runs(automation_id, external_run_key)
    WHERE external_run_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_automation_runs_automation_triggered
    ON public.automation_runs(automation_id, triggered_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_runs_status_triggered
    ON public.automation_runs(status, triggered_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_runs_account_triggered
    ON public.automation_runs(account_id, triggered_at DESC);

CREATE TABLE IF NOT EXISTS public.automation_run_attempts (
    attempt_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES public.automation_runs(run_id) ON DELETE CASCADE,
    attempt_no INT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ NULL,
    error_code TEXT NULL,
    error_message TEXT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT automation_run_attempts_no_ck CHECK (attempt_no > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_automation_run_attempt_no
    ON public.automation_run_attempts(run_id, attempt_no);

CREATE INDEX IF NOT EXISTS idx_automation_run_attempts_run_started
    ON public.automation_run_attempts(run_id, started_at DESC);

CREATE OR REPLACE FUNCTION update_automation_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_automations_updated_at ON public.automations;
CREATE TRIGGER trigger_automations_updated_at
    BEFORE UPDATE ON public.automations
    FOR EACH ROW
    EXECUTE FUNCTION update_automation_updated_at();

DROP TRIGGER IF EXISTS trigger_automation_bindings_updated_at ON public.automation_bindings;
CREATE TRIGGER trigger_automation_bindings_updated_at
    BEFORE UPDATE ON public.automation_bindings
    FOR EACH ROW
    EXECUTE FUNCTION update_automation_updated_at();

DROP TRIGGER IF EXISTS trigger_automation_runs_updated_at ON public.automation_runs;
CREATE TRIGGER trigger_automation_runs_updated_at
    BEFORE UPDATE ON public.automation_runs
    FOR EACH ROW
    EXECUTE FUNCTION update_automation_updated_at();

ALTER TABLE public.automations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_run_attempts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'automations'
          AND policyname = 'service_role_all_automations'
    ) THEN
        CREATE POLICY "service_role_all_automations"
            ON public.automations
            FOR ALL
            TO service_role
            USING (true)
            WITH CHECK (true);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'automation_bindings'
          AND policyname = 'service_role_all_automation_bindings'
    ) THEN
        CREATE POLICY "service_role_all_automation_bindings"
            ON public.automation_bindings
            FOR ALL
            TO service_role
            USING (true)
            WITH CHECK (true);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'provider_events'
          AND policyname = 'service_role_all_provider_events'
    ) THEN
        CREATE POLICY "service_role_all_provider_events"
            ON public.provider_events
            FOR ALL
            TO service_role
            USING (true)
            WITH CHECK (true);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'automation_runs'
          AND policyname = 'service_role_all_automation_runs'
    ) THEN
        CREATE POLICY "service_role_all_automation_runs"
            ON public.automation_runs
            FOR ALL
            TO service_role
            USING (true)
            WITH CHECK (true);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'automation_run_attempts'
          AND policyname = 'service_role_all_automation_run_attempts'
    ) THEN
        CREATE POLICY "service_role_all_automation_run_attempts"
            ON public.automation_run_attempts
            FOR ALL
            TO service_role
            USING (true)
            WITH CHECK (true);
    END IF;
END $$;

COMMIT;
