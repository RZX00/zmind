-- Add argument_hint to user_skills (Claude Code official field)
-- Date: 2026-02-05

BEGIN;

ALTER TABLE user_skills
    ADD COLUMN IF NOT EXISTS argument_hint TEXT;

COMMENT ON COLUMN user_skills.argument_hint IS
    'Optional argument hint shown in the UI (Claude Code official field).';

COMMIT;
