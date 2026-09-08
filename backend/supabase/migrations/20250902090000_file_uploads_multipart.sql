BEGIN;

ALTER TABLE public.file_uploads
ADD COLUMN IF NOT EXISTS upload_method TEXT DEFAULT 'put',
ADD COLUMN IF NOT EXISTS multipart_upload_id TEXT,
ADD COLUMN IF NOT EXISTS multipart_part_size INTEGER,
ADD COLUMN IF NOT EXISTS multipart_part_count INTEGER;

COMMIT;
