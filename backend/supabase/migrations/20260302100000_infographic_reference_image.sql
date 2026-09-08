BEGIN;

ALTER TABLE public.infographic_preferences
    ADD COLUMN IF NOT EXISTS default_reference_image_file_id TEXT NULL;

ALTER TABLE public.infographic_generations
    ADD COLUMN IF NOT EXISTS reference_image_file_id TEXT NULL;

ALTER TABLE public.infographic_preferences
    ALTER COLUMN default_merge_mode SET DEFAULT 'prepend';

ALTER TABLE public.infographic_preferences
    ALTER COLUMN default_style_lock SET DEFAULT 'strict';

COMMIT;
