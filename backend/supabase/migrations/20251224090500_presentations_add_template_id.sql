BEGIN;

ALTER TABLE presentations
    ADD COLUMN IF NOT EXISTS template_id UUID NULL REFERENCES presentation_templates(template_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_presentations_template_id ON presentations(template_id);

COMMIT;
