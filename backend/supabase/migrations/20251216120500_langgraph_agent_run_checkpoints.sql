-- WS-A/WS-D: Checkpoint storage table for LangGraph engine
-- Contract: unique (agent_run_id, checkpoint_id), stores serialized GraphState JSON.

BEGIN;

CREATE TABLE IF NOT EXISTS agent_run_checkpoints (
    agent_run_id TEXT NOT NULL,
    checkpoint_id TEXT NOT NULL,
    state_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    PRIMARY KEY (agent_run_id, checkpoint_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_run_checkpoints_agent_run_id
    ON agent_run_checkpoints(agent_run_id, created_at DESC);

COMMIT;
