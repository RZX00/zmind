BEGIN;

CREATE TABLE IF NOT EXISTS presentation_templates (
    template_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES basejump.accounts(id) ON DELETE CASCADE,
    template_key TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    file_id UUID REFERENCES public.file_uploads(id) ON DELETE SET NULL,
    storage_path TEXT,
    preview_storage_path TEXT,
    tags TEXT[],
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT presentation_templates_template_key_not_empty CHECK (LENGTH(TRIM(template_key)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_presentation_templates_account_key
    ON presentation_templates(account_id, template_key);
CREATE INDEX IF NOT EXISTS idx_presentation_templates_account_id
    ON presentation_templates(account_id);
CREATE INDEX IF NOT EXISTS idx_presentation_templates_default
    ON presentation_templates(account_id, is_default);

ALTER TABLE presentation_templates ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE policyname = 'presentation_templates_account_access'
          AND tablename = 'presentation_templates'
    ) THEN
        CREATE POLICY presentation_templates_account_access ON presentation_templates
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
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'presentation_templates_updated_at') THEN
        CREATE TRIGGER presentation_templates_updated_at
            BEFORE UPDATE ON presentation_templates
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

GRANT ALL ON presentation_templates TO authenticated, service_role;

COMMIT;
