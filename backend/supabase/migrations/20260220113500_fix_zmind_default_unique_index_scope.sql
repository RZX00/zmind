BEGIN;

-- Previous migration created a global unique index on (metadata->>'is_zmind_default'),
-- which allowed only one default agent in the entire table.
-- We need uniqueness per account: one Zmind default agent per account.
DROP INDEX IF EXISTS idx_agents_zmind_default_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_zmind_default_unique_account
ON agents(account_id)
WHERE COALESCE((metadata->>'is_zmind_default')::boolean, false) = true;

COMMIT;
