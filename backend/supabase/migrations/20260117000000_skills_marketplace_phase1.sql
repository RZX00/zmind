-- Skills Marketplace Phase 1: Add marketplace-related fields to user_skills table
-- Migration: 20260117000000_skills_marketplace_phase1.sql
-- Purpose: Extend user_skills table to support external skill installation and management

BEGIN;

-- Add marketplace-specific columns to user_skills table
-- Note: 'enabled' column already exists from original table
DO $$
BEGIN
    -- Source tracking
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_skills' AND column_name='source_url') THEN
        ALTER TABLE user_skills ADD COLUMN source_url TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_skills' AND column_name='source_type') THEN
        ALTER TABLE user_skills ADD COLUMN source_type VARCHAR(20) DEFAULT 'user';
        ALTER TABLE user_skills ADD CONSTRAINT user_skills_source_type_check
            CHECK (source_type IN ('github', 'manual', 'marketplace', 'builtin', 'user'));
    END IF;

    -- Compatibility detection
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_skills' AND column_name='compatibility_status') THEN
        ALTER TABLE user_skills ADD COLUMN compatibility_status VARCHAR(20) DEFAULT 'unknown';
        ALTER TABLE user_skills ADD CONSTRAINT user_skills_compatibility_status_check
            CHECK (compatibility_status IN ('compatible', 'partial', 'incompatible', 'unknown'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_skills' AND column_name='compatibility_reason') THEN
        ALTER TABLE user_skills ADD COLUMN compatibility_reason TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_skills' AND column_name='compatibility_details') THEN
        ALTER TABLE user_skills ADD COLUMN compatibility_details JSONB DEFAULT '{}'::jsonb;
    END IF;

    -- Marketplace metadata
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_skills' AND column_name='installed_at') THEN
        ALTER TABLE user_skills ADD COLUMN installed_at TIMESTAMPTZ DEFAULT NOW();
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_skills' AND column_name='last_sync_at') THEN
        ALTER TABLE user_skills ADD COLUMN last_sync_at TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_skills' AND column_name='marketplace_metadata') THEN
        ALTER TABLE user_skills ADD COLUMN marketplace_metadata JSONB DEFAULT '{}'::jsonb;
    END IF;

    -- Official Claude Code Skills fields
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_skills' AND column_name='allowed_tools') THEN
        ALTER TABLE user_skills ADD COLUMN allowed_tools TEXT[];
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_skills' AND column_name='model') THEN
        ALTER TABLE user_skills ADD COLUMN model TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_skills' AND column_name='context') THEN
        ALTER TABLE user_skills ADD COLUMN context TEXT;
        ALTER TABLE user_skills ADD CONSTRAINT user_skills_context_check CHECK (context IN ('fork'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_skills' AND column_name='agent') THEN
        ALTER TABLE user_skills ADD COLUMN agent TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_skills' AND column_name='hooks') THEN
        ALTER TABLE user_skills ADD COLUMN hooks JSONB;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_skills' AND column_name='user_invocable') THEN
        ALTER TABLE user_skills ADD COLUMN user_invocable BOOLEAN DEFAULT TRUE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_skills' AND column_name='disable_model_invocation') THEN
        ALTER TABLE user_skills ADD COLUMN disable_model_invocation BOOLEAN DEFAULT FALSE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_skills' AND column_name='license') THEN
        ALTER TABLE user_skills ADD COLUMN license TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_skills' AND column_name='metadata') THEN
        ALTER TABLE user_skills ADD COLUMN metadata JSONB DEFAULT '{}'::jsonb;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_skills' AND column_name='source') THEN
        ALTER TABLE user_skills ADD COLUMN source VARCHAR(20) DEFAULT 'user';
        ALTER TABLE user_skills ADD CONSTRAINT user_skills_source_check
            CHECK (source IN ('builtin', 'file', 'user'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_skills' AND column_name='location') THEN
        ALTER TABLE user_skills ADD COLUMN location TEXT;
    END IF;
END $$;

-- Create indexes for efficient querying (only if table and columns exist)
DO $$
BEGIN
    -- Check if 'enabled' column exists before creating index
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_skills' AND column_name='enabled') THEN
        CREATE INDEX IF NOT EXISTS idx_user_skills_account_enabled
            ON user_skills(account_id, enabled) WHERE enabled = TRUE;
    END IF;
END $$;

-- Create remaining indexes (conditionally)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_skills' AND column_name='source_type') THEN
        CREATE INDEX IF NOT EXISTS idx_user_skills_source_type
            ON user_skills(account_id, source_type);
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_skills' AND column_name='compatibility_status') THEN
        CREATE INDEX IF NOT EXISTS idx_user_skills_compatibility
            ON user_skills(account_id, compatibility_status);
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_skills' AND column_name='installed_at') THEN
        CREATE INDEX IF NOT EXISTS idx_user_skills_installed_at
            ON user_skills(account_id, installed_at DESC);
    END IF;
END $$;

-- Add comments to explain the schema (conditionally)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_skills' AND column_name='source_url') THEN
        COMMENT ON COLUMN user_skills.source_url IS 'Original URL where the skill was imported from (GitHub, marketplace, etc.)';
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_skills' AND column_name='source_type') THEN
        COMMENT ON COLUMN user_skills.source_type IS 'Type of skill source: github, manual, marketplace, builtin, user';
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_skills' AND column_name='compatibility_status') THEN
        COMMENT ON COLUMN user_skills.compatibility_status IS 'Compatibility status with Zmind platform: compatible, partial, incompatible, unknown';
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_skills' AND column_name='compatibility_reason') THEN
        COMMENT ON COLUMN user_skills.compatibility_reason IS 'Human-readable explanation of compatibility status';
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_skills' AND column_name='compatibility_details') THEN
        COMMENT ON COLUMN user_skills.compatibility_details IS 'Detailed compatibility information (incompatible tools, suggestions, etc.)';
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_skills' AND column_name='installed_at') THEN
        COMMENT ON COLUMN user_skills.installed_at IS 'Timestamp when the skill was first installed';
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_skills' AND column_name='last_sync_at') THEN
        COMMENT ON COLUMN user_skills.last_sync_at IS 'Timestamp of last sync with external source';
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_skills' AND column_name='marketplace_metadata') THEN
        COMMENT ON COLUMN user_skills.marketplace_metadata IS 'Additional metadata from marketplace (author, stars, downloads, etc.)';
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_skills' AND column_name='allowed_tools') THEN
        COMMENT ON COLUMN user_skills.allowed_tools IS 'List of tool names the skill is allowed to use (official Claude Code field)';
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_skills' AND column_name='hooks') THEN
        COMMENT ON COLUMN user_skills.hooks IS 'Lifecycle hooks configuration (official Claude Code 3-layer structure)';
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_skills' AND column_name='user_invocable') THEN
        COMMENT ON COLUMN user_skills.user_invocable IS 'Whether users can invoke this skill directly via slash command';
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_skills' AND column_name='disable_model_invocation') THEN
        COMMENT ON COLUMN user_skills.disable_model_invocation IS 'Whether to disable model invocation for this skill';
    END IF;
END $$;

-- Backfill existing skills with default values (conditionally)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_skills' AND column_name='source_type') THEN
        UPDATE user_skills
        SET
            source_type = 'user',
            compatibility_status = 'unknown',
            installed_at = COALESCE(created_at, NOW()),
            source = 'user'
        WHERE source_type IS NULL;
    END IF;
END $$;

-- Create a view for marketplace-installed skills (only if source_type column exists)
-- Note: View will dynamically include only columns that exist in the table
DO $$
DECLARE
    view_sql TEXT;
    column_list TEXT := '';
BEGIN
    -- Only create view if source_type column exists (marker for marketplace features)
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_skills' AND column_name='source_type') THEN

        -- Build column list dynamically based on existing columns
        SELECT string_agg(column_name, ', ')
        INTO column_list
        FROM (
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'user_skills'
            AND column_name IN (
                'id', 'account_id', 'skill_id', 'name', 'description',
                'allowed_tools', 'tools_allowlist', 'prompt', 'enabled',
                'source_url', 'source_type', 'compatibility_status',
                'compatibility_reason', 'compatibility_details',
                'installed_at', 'last_sync_at', 'marketplace_metadata',
                'model', 'context', 'agent', 'hooks', 'user_invocable',
                'disable_model_invocation', 'license', 'metadata',
                'source', 'location', 'created_at', 'updated_at'
            )
            ORDER BY ordinal_position
        ) cols;

        -- Create view with dynamic column list
        IF column_list IS NOT NULL AND column_list != '' THEN
            view_sql := 'CREATE OR REPLACE VIEW marketplace_skills AS ' ||
                       'SELECT ' || column_list || ' ' ||
                       'FROM user_skills ' ||
                       'WHERE source_type IN (''github'', ''marketplace'', ''manual'')';

            EXECUTE view_sql;

            -- Grant permissions on the view
            GRANT SELECT ON marketplace_skills TO authenticated, service_role;

            RAISE NOTICE 'Created marketplace_skills view with columns: %', column_list;
        ELSE
            RAISE NOTICE 'No matching columns found for marketplace_skills view';
        END IF;
    ELSE
        RAISE NOTICE 'source_type column does not exist, skipping view creation';
    END IF;
END $$;

COMMIT;
