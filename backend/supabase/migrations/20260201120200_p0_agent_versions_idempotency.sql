BEGIN;

ALTER TABLE agent_versions
    ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_agent_versions_agent_idempotency
    ON agent_versions(agent_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_agent_versions_agent_version_number
    ON agent_versions(agent_id, version_number);

COMMIT;
