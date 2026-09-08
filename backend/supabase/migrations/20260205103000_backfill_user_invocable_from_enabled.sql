-- Backfill user_invocable from legacy enabled column
-- Date: 2026-02-05

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'user_skills' AND column_name = 'user_invocable'
    ) THEN
        ALTER TABLE user_skills ADD COLUMN user_invocable BOOLEAN DEFAULT TRUE;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'user_skills' AND column_name = 'enabled'
    ) THEN
        UPDATE user_skills
        SET user_invocable = COALESCE(user_invocable, enabled)
        WHERE user_invocable IS NULL;
    END IF;
END $$;

COMMIT;
