BEGIN;

ALTER TABLE public.openclaw_workspace_settings
    ALTER COLUMN allowed_capabilities
    SET DEFAULT '["canvas.read","canvas.create","canvas.write","doc.read","doc.create","doc.write","rollback.execute"]'::jsonb;

UPDATE public.openclaw_workspace_settings
SET allowed_capabilities = COALESCE(allowed_capabilities, '[]'::jsonb) || '["rollback.execute"]'::jsonb
WHERE NOT COALESCE(allowed_capabilities, '[]'::jsonb) @> '["rollback.execute"]'::jsonb;

COMMIT;
