BEGIN;

CREATE TABLE IF NOT EXISTS public.public_canvas_shares (
    canvas_id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    is_public BOOLEAN NOT NULL DEFAULT FALSE,
    is_listed BOOLEAN NOT NULL DEFAULT FALSE,
    timeline_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    public_shows_timeline BOOLEAN NOT NULL DEFAULT FALSE,
    listed_at TIMESTAMPTZ NULL,
    author_display_name TEXT NULL,
    author_avatar_url TEXT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_public_canvas_shares_workspace
    ON public.public_canvas_shares(workspace_id);

CREATE INDEX IF NOT EXISTS idx_public_canvas_shares_listed
    ON public.public_canvas_shares(is_listed);

ALTER TABLE public.public_canvas_shares ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'public_canvas_shares'
          AND policyname = 'service_role_all_public_canvas_shares'
    ) THEN
        CREATE POLICY "service_role_all_public_canvas_shares"
            ON public.public_canvas_shares
            FOR ALL
            TO service_role
            USING (true)
            WITH CHECK (true);
    END IF;
END $$;

COMMIT;
