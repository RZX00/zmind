BEGIN;

-- Keep the default-agent metadata in one Zmind namespace for new installs.
UPDATE agents
SET metadata = jsonb_set(
    COALESCE(metadata, '{}'::jsonb),
    '{is_zmind_default}',
    COALESCE(metadata->'is_zmind_default', 'false'::jsonb),
    true
);

CREATE INDEX IF NOT EXISTS idx_agents_zmind_default
ON agents((metadata->>'is_zmind_default'))
WHERE metadata->>'is_zmind_default' = 'true';

CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_zmind_default_unique
ON agents(account_id)
WHERE metadata->>'is_zmind_default' = 'true';

COMMIT;
