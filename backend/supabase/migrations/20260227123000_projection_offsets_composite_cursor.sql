BEGIN;

ALTER TABLE public.projection_offsets
    ADD COLUMN IF NOT EXISTS last_event_id TEXT NULL;

COMMENT ON COLUMN public.projection_offsets.last_event_id
    IS 'Tie-breaker for events sharing identical occurred_at. Used with last_processed_at as a composite cursor.';

COMMIT;
