BEGIN;

CREATE TABLE IF NOT EXISTS public.openclaw_workspace_settings (
    workspace_id UUID PRIMARY KEY,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    allowed_roles JSONB NOT NULL DEFAULT '["owner"]'::jsonb,
    allowed_capabilities JSONB NOT NULL DEFAULT '["canvas.read","canvas.create","canvas.write","doc.read","doc.create","doc.write"]'::jsonb,
    linked_at TIMESTAMPTZ NULL,
    linked_by UUID NULL,
    last_verified_at TIMESTAMPTZ NULL,
    last_verified_by UUID NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by UUID NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_openclaw_workspace_settings_enabled
    ON public.openclaw_workspace_settings(enabled, updated_at DESC);

ALTER TABLE public.openclaw_workspace_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'openclaw_workspace_settings'
          AND policyname = 'service_role_all_openclaw_workspace_settings'
    ) THEN
        CREATE POLICY "service_role_all_openclaw_workspace_settings"
            ON public.openclaw_workspace_settings
            FOR ALL
            TO service_role
            USING (true)
            WITH CHECK (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'openclaw_workspace_settings'
          AND policyname = 'members_read_openclaw_workspace_settings'
    ) THEN
        CREATE POLICY "members_read_openclaw_workspace_settings"
            ON public.openclaw_workspace_settings
            FOR SELECT
            TO authenticated
            USING (basejump.has_role_on_account(workspace_id));
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'openclaw_workspace_settings'
          AND policyname = 'owners_manage_openclaw_workspace_settings'
    ) THEN
        CREATE POLICY "owners_manage_openclaw_workspace_settings"
            ON public.openclaw_workspace_settings
            FOR INSERT
            TO authenticated
            WITH CHECK (basejump.has_role_on_account(workspace_id, 'owner'));
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'openclaw_workspace_settings'
          AND policyname = 'owners_update_openclaw_workspace_settings'
    ) THEN
        CREATE POLICY "owners_update_openclaw_workspace_settings"
            ON public.openclaw_workspace_settings
            FOR UPDATE
            TO authenticated
            USING (basejump.has_role_on_account(workspace_id, 'owner'))
            WITH CHECK (basejump.has_role_on_account(workspace_id, 'owner'));
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.openclaw_activity_log (
    id TEXT PRIMARY KEY,
    workspace_id UUID NOT NULL,
    actor_id UUID NULL,
    client TEXT NULL,
    tool_name TEXT NULL,
    operation_key TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'succeeded' CHECK (status IN ('succeeded', 'rolled_back', 'failed')),
    summary TEXT NULL,
    request_id TEXT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    rollback_payload JSONB NULL,
    rollback_status TEXT NOT NULL DEFAULT 'not_supported' CHECK (rollback_status IN ('available', 'completed', 'failed', 'not_supported')),
    rollback_error TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    rolled_back_at TIMESTAMPTZ NULL,
    rolled_back_by UUID NULL
);

CREATE INDEX IF NOT EXISTS idx_openclaw_activity_workspace_created
    ON public.openclaw_activity_log(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_openclaw_activity_workspace_resource
    ON public.openclaw_activity_log(workspace_id, resource_type, resource_id, created_at DESC);

ALTER TABLE public.openclaw_activity_log ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'openclaw_activity_log'
          AND policyname = 'service_role_all_openclaw_activity_log'
    ) THEN
        CREATE POLICY "service_role_all_openclaw_activity_log"
            ON public.openclaw_activity_log
            FOR ALL
            TO service_role
            USING (true)
            WITH CHECK (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'openclaw_activity_log'
          AND policyname = 'members_read_openclaw_activity_log'
    ) THEN
        CREATE POLICY "members_read_openclaw_activity_log"
            ON public.openclaw_activity_log
            FOR SELECT
            TO authenticated
            USING (basejump.has_role_on_account(workspace_id));
    END IF;
END $$;

GRANT SELECT, INSERT, UPDATE ON TABLE public.openclaw_workspace_settings TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.openclaw_activity_log TO authenticated, service_role;

COMMIT;
