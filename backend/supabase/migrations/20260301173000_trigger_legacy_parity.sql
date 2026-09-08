BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DO $$
BEGIN
    CREATE TYPE public.agent_trigger_type AS ENUM (
        'telegram',
        'slack',
        'webhook',
        'schedule',
        'email',
        'github',
        'discord',
        'teams',
        'event'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

ALTER TYPE public.agent_trigger_type ADD VALUE IF NOT EXISTS 'telegram';
ALTER TYPE public.agent_trigger_type ADD VALUE IF NOT EXISTS 'slack';
ALTER TYPE public.agent_trigger_type ADD VALUE IF NOT EXISTS 'webhook';
ALTER TYPE public.agent_trigger_type ADD VALUE IF NOT EXISTS 'schedule';
ALTER TYPE public.agent_trigger_type ADD VALUE IF NOT EXISTS 'email';
ALTER TYPE public.agent_trigger_type ADD VALUE IF NOT EXISTS 'github';
ALTER TYPE public.agent_trigger_type ADD VALUE IF NOT EXISTS 'discord';
ALTER TYPE public.agent_trigger_type ADD VALUE IF NOT EXISTS 'teams';
ALTER TYPE public.agent_trigger_type ADD VALUE IF NOT EXISTS 'event';

CREATE TABLE IF NOT EXISTS public.agent_triggers (
    trigger_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES public.agents(agent_id) ON DELETE CASCADE,
    trigger_type public.agent_trigger_type NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.trigger_events (
    event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trigger_id UUID NOT NULL REFERENCES public.agent_triggers(trigger_id) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES public.agents(agent_id) ON DELETE CASCADE,
    trigger_type public.agent_trigger_type NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    success BOOLEAN NOT NULL,
    should_execute_agent BOOLEAN NOT NULL DEFAULT FALSE,
    error_message TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS public.trigger_event_logs (
    log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trigger_id UUID NOT NULL REFERENCES public.agent_triggers(trigger_id) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES public.agents(agent_id) ON DELETE CASCADE,
    trigger_type public.agent_trigger_type NOT NULL,
    event_data TEXT,
    success BOOLEAN NOT NULL,
    should_execute_agent BOOLEAN NOT NULL DEFAULT FALSE,
    agent_prompt TEXT,
    execution_variables JSONB NOT NULL DEFAULT '{}'::jsonb,
    error_message TEXT,
    event_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.custom_trigger_providers (
    provider_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    trigger_type TEXT NOT NULL,
    provider_class TEXT,
    config_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
    webhook_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    webhook_config JSONB,
    response_template JSONB,
    field_mappings JSONB,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES basejump.accounts(id)
);

CREATE TABLE IF NOT EXISTS public.oauth_installations (
    installation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trigger_id UUID NOT NULL REFERENCES public.agent_triggers(trigger_id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expires_in INTEGER,
    scope TEXT,
    provider_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_triggers_agent_id ON public.agent_triggers(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_triggers_trigger_type ON public.agent_triggers(trigger_type);
CREATE INDEX IF NOT EXISTS idx_agent_triggers_is_active ON public.agent_triggers(is_active);
CREATE INDEX IF NOT EXISTS idx_agent_triggers_updated_at ON public.agent_triggers(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_trigger_events_trigger_id ON public.trigger_events(trigger_id);
CREATE INDEX IF NOT EXISTS idx_trigger_events_agent_id ON public.trigger_events(agent_id);
CREATE INDEX IF NOT EXISTS idx_trigger_events_timestamp ON public.trigger_events(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_trigger_event_logs_trigger_id ON public.trigger_event_logs(trigger_id);
CREATE INDEX IF NOT EXISTS idx_trigger_event_logs_agent_id ON public.trigger_event_logs(agent_id);
CREATE INDEX IF NOT EXISTS idx_trigger_event_logs_logged_at ON public.trigger_event_logs(logged_at DESC);

CREATE INDEX IF NOT EXISTS idx_custom_trigger_providers_trigger_type ON public.custom_trigger_providers(trigger_type);
CREATE INDEX IF NOT EXISTS idx_custom_trigger_providers_is_active ON public.custom_trigger_providers(is_active);

CREATE INDEX IF NOT EXISTS idx_oauth_installations_trigger_id ON public.oauth_installations(trigger_id);
CREATE INDEX IF NOT EXISTS idx_oauth_installations_provider ON public.oauth_installations(provider);

CREATE OR REPLACE FUNCTION public.update_agent_triggers_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_agent_triggers_updated_at ON public.agent_triggers;
CREATE TRIGGER trigger_agent_triggers_updated_at
    BEFORE UPDATE ON public.agent_triggers
    FOR EACH ROW
    EXECUTE FUNCTION public.update_agent_triggers_updated_at();

DROP TRIGGER IF EXISTS trigger_custom_trigger_providers_updated_at ON public.custom_trigger_providers;
CREATE TRIGGER trigger_custom_trigger_providers_updated_at
    BEFORE UPDATE ON public.custom_trigger_providers
    FOR EACH ROW
    EXECUTE FUNCTION public.update_agent_triggers_updated_at();

DROP TRIGGER IF EXISTS trigger_oauth_installations_updated_at ON public.oauth_installations;
CREATE TRIGGER trigger_oauth_installations_updated_at
    BEFORE UPDATE ON public.oauth_installations
    FOR EACH ROW
    EXECUTE FUNCTION public.update_agent_triggers_updated_at();

ALTER TABLE public.agent_triggers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trigger_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trigger_event_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_trigger_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oauth_installations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'agent_triggers' AND policyname = 'agent_triggers_select_policy'
    ) THEN
        CREATE POLICY agent_triggers_select_policy ON public.agent_triggers
            FOR SELECT USING (
                EXISTS (
                    SELECT 1
                    FROM public.agents
                    WHERE agents.agent_id = agent_triggers.agent_id
                      AND basejump.has_role_on_account(agents.account_id)
                )
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'agent_triggers' AND policyname = 'agent_triggers_insert_policy'
    ) THEN
        CREATE POLICY agent_triggers_insert_policy ON public.agent_triggers
            FOR INSERT WITH CHECK (
                EXISTS (
                    SELECT 1
                    FROM public.agents
                    WHERE agents.agent_id = agent_triggers.agent_id
                      AND basejump.has_role_on_account(agents.account_id, 'owner')
                )
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'agent_triggers' AND policyname = 'agent_triggers_update_policy'
    ) THEN
        CREATE POLICY agent_triggers_update_policy ON public.agent_triggers
            FOR UPDATE USING (
                EXISTS (
                    SELECT 1
                    FROM public.agents
                    WHERE agents.agent_id = agent_triggers.agent_id
                      AND basejump.has_role_on_account(agents.account_id, 'owner')
                )
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'agent_triggers' AND policyname = 'agent_triggers_delete_policy'
    ) THEN
        CREATE POLICY agent_triggers_delete_policy ON public.agent_triggers
            FOR DELETE USING (
                EXISTS (
                    SELECT 1
                    FROM public.agents
                    WHERE agents.agent_id = agent_triggers.agent_id
                      AND basejump.has_role_on_account(agents.account_id, 'owner')
                )
            );
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'trigger_events' AND policyname = 'trigger_events_select_policy'
    ) THEN
        CREATE POLICY trigger_events_select_policy ON public.trigger_events
            FOR SELECT USING (
                EXISTS (
                    SELECT 1
                    FROM public.agents
                    WHERE agents.agent_id = trigger_events.agent_id
                      AND basejump.has_role_on_account(agents.account_id)
                )
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'trigger_events' AND policyname = 'trigger_events_insert_policy'
    ) THEN
        CREATE POLICY trigger_events_insert_policy ON public.trigger_events
            FOR INSERT WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'trigger_event_logs' AND policyname = 'trigger_event_logs_select_policy'
    ) THEN
        CREATE POLICY trigger_event_logs_select_policy ON public.trigger_event_logs
            FOR SELECT USING (
                EXISTS (
                    SELECT 1
                    FROM public.agents
                    WHERE agents.agent_id = trigger_event_logs.agent_id
                      AND basejump.has_role_on_account(agents.account_id)
                )
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'trigger_event_logs' AND policyname = 'trigger_event_logs_insert_policy'
    ) THEN
        CREATE POLICY trigger_event_logs_insert_policy ON public.trigger_event_logs
            FOR INSERT WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'custom_trigger_providers' AND policyname = 'custom_trigger_providers_select_policy'
    ) THEN
        CREATE POLICY custom_trigger_providers_select_policy ON public.custom_trigger_providers
            FOR SELECT USING (is_active = TRUE);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'custom_trigger_providers' AND policyname = 'custom_trigger_providers_insert_policy'
    ) THEN
        CREATE POLICY custom_trigger_providers_insert_policy ON public.custom_trigger_providers
            FOR INSERT WITH CHECK (basejump.has_role_on_account(created_by));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'custom_trigger_providers' AND policyname = 'custom_trigger_providers_update_policy'
    ) THEN
        CREATE POLICY custom_trigger_providers_update_policy ON public.custom_trigger_providers
            FOR UPDATE USING (basejump.has_role_on_account(created_by, 'owner'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'custom_trigger_providers' AND policyname = 'custom_trigger_providers_delete_policy'
    ) THEN
        CREATE POLICY custom_trigger_providers_delete_policy ON public.custom_trigger_providers
            FOR DELETE USING (basejump.has_role_on_account(created_by, 'owner'));
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'oauth_installations' AND policyname = 'oauth_installations_select_policy'
    ) THEN
        CREATE POLICY oauth_installations_select_policy ON public.oauth_installations
            FOR SELECT USING (
                EXISTS (
                    SELECT 1
                    FROM public.agent_triggers
                    JOIN public.agents ON agents.agent_id = agent_triggers.agent_id
                    WHERE agent_triggers.trigger_id = oauth_installations.trigger_id
                      AND basejump.has_role_on_account(agents.account_id)
                )
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'oauth_installations' AND policyname = 'oauth_installations_insert_policy'
    ) THEN
        CREATE POLICY oauth_installations_insert_policy ON public.oauth_installations
            FOR INSERT WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'oauth_installations' AND policyname = 'oauth_installations_update_policy'
    ) THEN
        CREATE POLICY oauth_installations_update_policy ON public.oauth_installations
            FOR UPDATE USING ((auth.jwt() ->> 'role') = 'service_role');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'oauth_installations' AND policyname = 'oauth_installations_delete_policy'
    ) THEN
        CREATE POLICY oauth_installations_delete_policy ON public.oauth_installations
            FOR DELETE USING ((auth.jwt() ->> 'role') = 'service_role');
    END IF;
END $$;

GRANT ALL PRIVILEGES ON TABLE public.agent_triggers TO authenticated, service_role;
GRANT ALL PRIVILEGES ON TABLE public.custom_trigger_providers TO authenticated, service_role;
GRANT ALL PRIVILEGES ON TABLE public.oauth_installations TO service_role;
GRANT SELECT ON TABLE public.oauth_installations TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.trigger_events TO service_role;
GRANT SELECT ON TABLE public.trigger_events TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.trigger_event_logs TO service_role;
GRANT SELECT ON TABLE public.trigger_event_logs TO authenticated;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'automations'
    ) THEN
        INSERT INTO public.agent_triggers (
            trigger_id,
            agent_id,
            trigger_type,
            name,
            description,
            is_active,
            config,
            created_at,
            updated_at
        )
        SELECT
            a.automation_id,
            a.agent_id,
            CASE
                WHEN a.trigger_type = 'schedule' THEN 'schedule'::public.agent_trigger_type
                ELSE 'webhook'::public.agent_trigger_type
            END AS trigger_type,
            a.name,
            a.description,
            a.is_active,
            (
                COALESCE(a.config, '{}'::jsonb)
                || jsonb_build_object(
                    'provider_id',
                    COALESCE(a.provider, CASE WHEN a.trigger_type = 'schedule' THEN 'schedule' ELSE 'webhook' END)
                )
                || CASE
                    WHEN a.provider = 'composio'
                         AND a.provider_binding_key IS NOT NULL
                         AND NOT (COALESCE(a.config, '{}'::jsonb) ? 'composio_trigger_id')
                    THEN jsonb_build_object('composio_trigger_id', a.provider_binding_key)
                    ELSE '{}'::jsonb
                END
            ) AS config,
            a.created_at,
            a.updated_at
        FROM public.automations a
        WHERE a.agent_id IS NOT NULL
        ON CONFLICT (trigger_id) DO NOTHING;
    END IF;
END $$;

COMMENT ON TABLE public.agent_triggers IS 'Legacy trigger configuration store restored for trigger parity';
COMMENT ON TABLE public.trigger_events IS 'Legacy trigger events audit table';
COMMENT ON TABLE public.trigger_event_logs IS 'Execution logs written by trigger_service._log_trigger_event';

COMMIT;
