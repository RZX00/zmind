BEGIN;

ALTER TABLE knowledge_base_entries
    ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_kb_entries_account_idempotency
    ON knowledge_base_entries(account_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS kb_upload_requests (
    request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES basejump.accounts(id) ON DELETE CASCADE,
    folder_id UUID NOT NULL REFERENCES knowledge_base_folders(folder_id) ON DELETE CASCADE,
    idempotency_key TEXT NOT NULL,
    entry_id UUID,
    status TEXT NOT NULL DEFAULT 'processing',
    error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(account_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_kb_upload_requests_account_id ON kb_upload_requests(account_id);
CREATE INDEX IF NOT EXISTS idx_kb_upload_requests_status ON kb_upload_requests(status);

DROP TRIGGER IF EXISTS update_kb_upload_requests_updated_at ON kb_upload_requests;
CREATE TRIGGER update_kb_upload_requests_updated_at
    BEFORE UPDATE ON kb_upload_requests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMIT;
