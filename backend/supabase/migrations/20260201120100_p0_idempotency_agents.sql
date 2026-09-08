BEGIN;

ALTER TABLE agents
    ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_agents_account_idempotency
    ON agents(account_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

COMMIT;
