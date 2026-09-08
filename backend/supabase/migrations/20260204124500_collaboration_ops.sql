BEGIN;

CREATE TABLE IF NOT EXISTS public.collaboration_sessions (
    session_id TEXT PRIMARY KEY,
    canvas_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    user_id TEXT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_collaboration_sessions_canvas
    ON public.collaboration_sessions(canvas_id);

CREATE INDEX IF NOT EXISTS idx_collaboration_sessions_workspace
    ON public.collaboration_sessions(workspace_id);

CREATE TABLE IF NOT EXISTS public.collaboration_ops (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id TEXT NOT NULL,
    canvas_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    user_id TEXT NULL,
    operations JSONB NOT NULL DEFAULT '[]'::jsonb,
    op_count INT NOT NULL DEFAULT 0,
    idempotency_key TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_collaboration_ops_canvas
    ON public.collaboration_ops(canvas_id);

CREATE INDEX IF NOT EXISTS idx_collaboration_ops_session
    ON public.collaboration_ops(session_id);

CREATE INDEX IF NOT EXISTS idx_collaboration_ops_created_at
    ON public.collaboration_ops(created_at);

CREATE UNIQUE INDEX IF NOT EXISTS ux_collaboration_ops_session_idempotency
    ON public.collaboration_ops(session_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.collaboration_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaboration_ops ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'collaboration_sessions'
          AND policyname = 'service_role_all_collaboration_sessions'
    ) THEN
        CREATE POLICY "service_role_all_collaboration_sessions"
            ON public.collaboration_sessions
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
          AND tablename = 'collaboration_ops'
          AND policyname = 'service_role_all_collaboration_ops'
    ) THEN
        CREATE POLICY "service_role_all_collaboration_ops"
            ON public.collaboration_ops
            FOR ALL
            TO service_role
            USING (true)
            WITH CHECK (true);
    END IF;
END $$;

COMMIT;
