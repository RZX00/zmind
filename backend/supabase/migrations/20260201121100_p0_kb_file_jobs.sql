BEGIN;

CREATE TABLE IF NOT EXISTS kb_file_jobs (
    job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES basejump.accounts(id) ON DELETE CASCADE,
    entry_id UUID REFERENCES knowledge_base_entries(entry_id) ON DELETE SET NULL,
    action TEXT NOT NULL CHECK (action IN ('delete', 'move')),
    storage_provider TEXT,
    storage_bucket TEXT,
    storage_path TEXT,
    target_path TEXT,
    target_folder_id UUID,
    file_id UUID REFERENCES public.file_uploads(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'retry', 'failed', 'completed')),
    attempts INT NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kb_file_jobs_status ON kb_file_jobs(status);
CREATE INDEX IF NOT EXISTS idx_kb_file_jobs_entry_id ON kb_file_jobs(entry_id);

DROP TRIGGER IF EXISTS update_kb_file_jobs_updated_at ON kb_file_jobs;
CREATE TRIGGER update_kb_file_jobs_updated_at
    BEFORE UPDATE ON kb_file_jobs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMIT;
