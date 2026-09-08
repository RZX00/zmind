BEGIN;

ALTER TABLE public.file_uploads
ADD COLUMN IF NOT EXISTS storage_provider TEXT DEFAULT 'supabase',
ADD COLUMN IF NOT EXISTS storage_bucket TEXT,
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'uploaded',
ADD COLUMN IF NOT EXISTS hash_sha256 TEXT,
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS source TEXT;

UPDATE public.file_uploads
SET storage_bucket = COALESCE(storage_bucket, bucket_name)
WHERE storage_bucket IS NULL;

CREATE TABLE IF NOT EXISTS public.file_links (
    id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    file_id UUID NOT NULL REFERENCES public.file_uploads(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT file_links_unique UNIQUE (file_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_file_links_file_id ON public.file_links(file_id);
CREATE INDEX IF NOT EXISTS idx_file_links_entity ON public.file_links(entity_type, entity_id);

COMMIT;
