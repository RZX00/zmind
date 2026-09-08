BEGIN;

CREATE TABLE IF NOT EXISTS public.projection_offsets (
    projection_name TEXT PRIMARY KEY,
    last_processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.projection_offsets ENABLE ROW LEVEL SECURITY;

COMMIT;
