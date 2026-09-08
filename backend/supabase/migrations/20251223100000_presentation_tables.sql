BEGIN;

CREATE TABLE IF NOT EXISTS presentations (
    presentation_id TEXT PRIMARY KEY,
    account_id UUID NOT NULL REFERENCES basejump.accounts(id) ON DELETE CASCADE,
    project_id UUID NULL REFERENCES projects(project_id) ON DELETE SET NULL,
    thread_id UUID NULL REFERENCES threads(thread_id) ON DELETE SET NULL,
    canvas_id TEXT NULL REFERENCES public.canvases(id) ON DELETE SET NULL,
    title TEXT,
    status TEXT DEFAULT 'draft',
    latest_snapshot_id UUID NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_presentations_account_id ON presentations(account_id);
CREATE INDEX IF NOT EXISTS idx_presentations_thread_id ON presentations(thread_id);
CREATE INDEX IF NOT EXISTS idx_presentations_canvas_id ON presentations(canvas_id);

CREATE TABLE IF NOT EXISTS presentation_snapshots (
    snapshot_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    presentation_id TEXT NOT NULL REFERENCES presentations(presentation_id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES basejump.accounts(id) ON DELETE CASCADE,
    canvas_id TEXT NULL REFERENCES public.canvases(id) ON DELETE SET NULL,
    canvas_version TEXT,
    outline_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    slides_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE presentations
    ADD CONSTRAINT presentations_latest_snapshot_fk
    FOREIGN KEY (latest_snapshot_id) REFERENCES presentation_snapshots(snapshot_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_presentation_snapshots_presentation_id ON presentation_snapshots(presentation_id);
CREATE INDEX IF NOT EXISTS idx_presentation_snapshots_account_id ON presentation_snapshots(account_id);

CREATE TABLE IF NOT EXISTS presentation_runs (
    run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    presentation_id TEXT NOT NULL REFERENCES presentations(presentation_id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES basejump.accounts(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'queued',
    total_slides INTEGER DEFAULT 0,
    completed_slides INTEGER DEFAULT 0,
    failed_slides INTEGER DEFAULT 0,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_presentation_runs_presentation_id ON presentation_runs(presentation_id);
CREATE INDEX IF NOT EXISTS idx_presentation_runs_account_id ON presentation_runs(account_id);

ALTER TABLE presentations ENABLE ROW LEVEL SECURITY;
ALTER TABLE presentation_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE presentation_runs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'presentations_account_access' AND tablename = 'presentations') THEN
        CREATE POLICY presentations_account_access ON presentations
            FOR ALL USING (basejump.has_role_on_account(account_id) = true);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'presentation_snapshots_account_access' AND tablename = 'presentation_snapshots') THEN
        CREATE POLICY presentation_snapshots_account_access ON presentation_snapshots
            FOR ALL USING (basejump.has_role_on_account(account_id) = true);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'presentation_runs_account_access' AND tablename = 'presentation_runs') THEN
        CREATE POLICY presentation_runs_account_access ON presentation_runs
            FOR ALL USING (basejump.has_role_on_account(account_id) = true);
    END IF;
END $$;

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'presentations_updated_at') THEN
        CREATE TRIGGER presentations_updated_at
            BEFORE UPDATE ON presentations
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'presentation_snapshots_updated_at') THEN
        CREATE TRIGGER presentation_snapshots_updated_at
            BEFORE UPDATE ON presentation_snapshots
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'presentation_runs_updated_at') THEN
        CREATE TRIGGER presentation_runs_updated_at
            BEFORE UPDATE ON presentation_runs
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

GRANT ALL ON presentations TO authenticated, service_role;
GRANT ALL ON presentation_snapshots TO authenticated, service_role;
GRANT ALL ON presentation_runs TO authenticated, service_role;

COMMIT;
