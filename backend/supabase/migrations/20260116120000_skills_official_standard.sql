-- Skills Official Standard Migration
-- Aligns user_skills table with Claude Code Skills official specification
--
-- Changes:
-- - Remove custom fields: skill_id, intent_tags, output_schema, enabled, version
-- - Add official fields: allowed_tools, model, context, agent, hooks, user_invocable
-- - Update name to be the primary identifier (unique per account)
-- - Add official validation constraints
--
-- Date: 2026-01-16

BEGIN;

-- Step 1: Add new official fields (NULL allowed initially for migration)
ALTER TABLE user_skills
    ADD COLUMN IF NOT EXISTS allowed_tools TEXT[],
    ADD COLUMN IF NOT EXISTS model TEXT,
    ADD COLUMN IF NOT EXISTS context TEXT,
    ADD COLUMN IF NOT EXISTS agent TEXT,
    ADD COLUMN IF NOT EXISTS hooks JSONB,
    ADD COLUMN IF NOT EXISTS user_invocable BOOLEAN DEFAULT TRUE;

-- Step 2: Migrate data from old fields to new fields
-- Migrate tools_allowlist -> allowed_tools
UPDATE user_skills
SET allowed_tools = tools_allowlist
WHERE allowed_tools IS NULL AND tools_allowlist IS NOT NULL;

-- Step 3: Drop old custom fields
ALTER TABLE user_skills
    DROP COLUMN IF EXISTS skill_id,
    DROP COLUMN IF EXISTS intent_tags,
    DROP COLUMN IF EXISTS tools_allowlist,
    DROP COLUMN IF EXISTS output_schema,
    DROP COLUMN IF EXISTS enabled,
    DROP COLUMN IF EXISTS version;

-- Step 4: Update name field constraints (official standard)
-- Name is the unique identifier in official standard
ALTER TABLE user_skills
    DROP CONSTRAINT IF EXISTS user_skills_name_not_empty;

ALTER TABLE user_skills
    ADD CONSTRAINT user_skills_name_format CHECK (
        name ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    ),
    ADD CONSTRAINT user_skills_name_length CHECK (
        LENGTH(name) >= 1 AND LENGTH(name) <= 64
    );

-- Step 5: Add description length constraint (official: 1-1024 chars)
ALTER TABLE user_skills
    ALTER COLUMN description SET NOT NULL,
    ADD CONSTRAINT user_skills_description_length CHECK (
        LENGTH(description) >= 1 AND LENGTH(description) <= 1024
    );

-- Step 6: Add context field validation (only 'fork' allowed)
ALTER TABLE user_skills
    ADD CONSTRAINT user_skills_context_valid CHECK (
        context IS NULL OR context = 'fork'
    );

-- Step 7: Drop old unique index and create new one using name
DROP INDEX IF EXISTS idx_user_skills_account_skill;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_skills_account_name
    ON user_skills(account_id, name);

-- Step 8: Add index for enabled skills (user_invocable = true)
CREATE INDEX IF NOT EXISTS idx_user_skills_invocable
    ON user_skills(account_id, user_invocable)
    WHERE user_invocable = TRUE;

-- Step 9: Add comments for documentation
COMMENT ON TABLE user_skills IS
    'User-defined skills following Claude Code Skills official standard. See: https://docs.claude.com/claude-code/skills';

COMMENT ON COLUMN user_skills.name IS
    'Skill name (unique identifier). Must be lowercase, numbers, hyphens only. Example: my-skill-name';

COMMENT ON COLUMN user_skills.description IS
    'Brief skill description (1-1024 chars). Required field.';

COMMENT ON COLUMN user_skills.prompt IS
    'Skill system prompt. Required field.';

COMMENT ON COLUMN user_skills.allowed_tools IS
    'Array of allowed tool names for this skill. Empty = all tools allowed.';

COMMENT ON COLUMN user_skills.model IS
    'Model override for skill execution (e.g., "claude-opus-4", "claude-sonnet-4"). NULL = use default model.';

COMMENT ON COLUMN user_skills.context IS
    'Execution context mode. Only "fork" is supported (isolated execution). NULL = normal execution.';

COMMENT ON COLUMN user_skills.agent IS
    'Agent configuration override. NULL = use default agent config.';

COMMENT ON COLUMN user_skills.hooks IS
    'Lifecycle hooks configuration (JSON). Example: {"PreToolUse": {"command": "echo test", "once": true}}';

COMMENT ON COLUMN user_skills.user_invocable IS
    'Whether skill can be invoked by users via /skill-name. Default: true.';

-- Step 10: Update RLS policy if needed (keep existing policy)
-- Policy already exists: user_skills_account_access

-- Step 11: Verify schema integrity
DO $$
DECLARE
    missing_columns TEXT[];
    extra_columns TEXT[];
BEGIN
    -- Check for required columns
    SELECT ARRAY_AGG(column_name)
    INTO missing_columns
    FROM (
        SELECT unnest(ARRAY[
            'id', 'account_id', 'name', 'description', 'prompt',
            'allowed_tools', 'model', 'context', 'agent', 'hooks', 'user_invocable',
            'created_at', 'updated_at'
        ])::TEXT AS column_name
    ) expected
    WHERE column_name NOT IN (
        SELECT column_name::TEXT
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'user_skills'
    );

    IF ARRAY_LENGTH(missing_columns, 1) > 0 THEN
        RAISE EXCEPTION 'Missing required columns: %', ARRAY_TO_STRING(missing_columns, ', ');
    END IF;

    -- Check for disallowed custom columns
    SELECT ARRAY_AGG(column_name)
    INTO extra_columns
    FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'user_skills'
    AND column_name NOT IN (
        'id', 'account_id', 'name', 'description', 'prompt',
        'allowed_tools', 'model', 'context', 'agent', 'hooks', 'user_invocable',
        'created_at', 'updated_at'
    );

    IF ARRAY_LENGTH(extra_columns, 1) > 0 THEN
        RAISE WARNING 'Unexpected columns found (consider removing): %', ARRAY_TO_STRING(extra_columns, ', ');
    END IF;

    RAISE NOTICE 'Schema migration completed successfully. All official fields present.';
END $$;

COMMIT;
