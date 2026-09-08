-- Mark any previously deleted one_time invite handling obsolete: migrate to used_at workflow
-- For existing invitations, ensure used_at is null (pending) and leave rows intact.
alter table if exists basejump.invitations
    add column if not exists used_at timestamp with time zone default null;

-- no backfill needed for deletions; this migration is placeholder to ensure column exists on older schemas
