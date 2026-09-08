-- Migration: Track worker identity + heartbeat for agent runs
-- Adds nullable columns for reliability monitoring and reaping.

BEGIN;

ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS worker_instance_id TEXT;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS worker_heartbeat_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_agent_runs_worker_heartbeat ON agent_runs (worker_heartbeat_at);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status_worker_heartbeat ON agent_runs (status, worker_heartbeat_at);

COMMENT ON COLUMN agent_runs.worker_instance_id IS 'Instance identifier that executed the run (worker process).';
COMMENT ON COLUMN agent_runs.worker_heartbeat_at IS 'Last heartbeat timestamp from the worker executing the run.';

COMMIT;
