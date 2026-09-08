-- Migration: Mark Zmind team templates
-- This migration marks templates created by the Zmind team as official

BEGIN;

-- Update templates to mark as Zmind team based on specific criteria
-- You can adjust the WHERE clause based on your actual Zmind team account IDs or template names

-- Option 1: Mark templates by specific names that are known Zmind team templates
UPDATE agent_templates
SET is_zmind_team = true
WHERE name IN (
    'Sheets Agent',
    'Slides Agent',
    'Data Analyst',
    'Web Dev Agent',
    'Research Assistant',
    'Code Review Agent',
    'Documentation Writer',
    'API Testing Agent'
) AND is_public = true;

-- Option 2: Mark templates by creator_id if you know the Zmind team account IDs
-- Uncomment and modify with actual Zmind team account IDs
-- UPDATE agent_templates
-- SET is_zmind_team = true
-- WHERE creator_id IN (
--     'zmind-team-account-id-1',
--     'zmind-team-account-id-2'
-- );

-- Option 3: Mark templates that have specific metadata indicating they're official
UPDATE agent_templates
SET is_zmind_team = true
WHERE metadata->>'is_zmind_default' = 'true'
   OR metadata->>'is_official' = 'true';

-- Log the update
DO $$
DECLARE
    updated_count INTEGER;
BEGIN
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RAISE NOTICE 'Marked % templates as Zmind team templates', updated_count;
END $$;
