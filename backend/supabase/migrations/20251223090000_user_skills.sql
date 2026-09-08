BEGIN;

CREATE TABLE IF NOT EXISTS user_skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES basejump.accounts(id) ON DELETE CASCADE,
    skill_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    intent_tags TEXT[],
    tools_allowlist TEXT[],
    output_schema JSONB,
    prompt TEXT NOT NULL,
    enabled BOOLEAN DEFAULT TRUE,
    version TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT user_skills_skill_id_not_empty CHECK (LENGTH(TRIM(skill_id)) > 0),
    CONSTRAINT user_skills_name_not_empty CHECK (LENGTH(TRIM(name)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_skills_account_skill ON user_skills(account_id, skill_id);
CREATE INDEX IF NOT EXISTS idx_user_skills_account_id ON user_skills(account_id);

ALTER TABLE user_skills ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'user_skills_account_access' AND tablename = 'user_skills') THEN
        CREATE POLICY user_skills_account_access ON user_skills
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
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'user_skills_updated_at') THEN
        CREATE TRIGGER user_skills_updated_at
            BEFORE UPDATE ON user_skills
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

GRANT ALL ON user_skills TO authenticated, service_role;

COMMIT;
