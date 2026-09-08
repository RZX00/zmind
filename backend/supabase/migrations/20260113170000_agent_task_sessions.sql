BEGIN;

-- Task sessions for checkpoint-backed subtask runs.
-- Each task session stores metadata and uses task_run_id as the checkpoint key.
CREATE TABLE IF NOT EXISTS agent_task_sessions (
    task_run_id TEXT PRIMARY KEY,
    account_id UUID NOT NULL REFERENCES basejump.accounts(id) ON DELETE CASCADE,
    thread_id UUID NOT NULL REFERENCES threads(thread_id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(project_id) ON DELETE CASCADE,
    description TEXT,
    subagent_type TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    last_checkpoint_id TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_agent_task_sessions_thread_created_at
    ON agent_task_sessions(thread_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_task_sessions_account_created_at
    ON agent_task_sessions(account_id, created_at DESC);

ALTER TABLE agent_task_sessions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE policyname = 'agent_task_sessions_account_access'
          AND tablename = 'agent_task_sessions'
    ) THEN
        CREATE POLICY agent_task_sessions_account_access ON agent_task_sessions
            FOR ALL USING (basejump.has_role_on_account(account_id) = true);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'agent_task_sessions_updated_at') THEN
        CREATE TRIGGER agent_task_sessions_updated_at
            BEFORE UPDATE ON agent_task_sessions
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

GRANT ALL ON agent_task_sessions TO authenticated, service_role;

COMMIT;

