BEGIN;

ALTER TABLE agent_runs
    ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_agent_runs_thread_idempotency
    ON agent_runs(thread_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

COMMIT;
