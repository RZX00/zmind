BEGIN;

ALTER TABLE public.invite_codes
  ADD COLUMN IF NOT EXISTS owner_account_id uuid,
  ADD COLUMN IF NOT EXISTS slot_index smallint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invite_codes_slot_index_range'
  ) THEN
    ALTER TABLE public.invite_codes
      ADD CONSTRAINT invite_codes_slot_index_range
      CHECK (slot_index IS NULL OR (slot_index >= 1 AND slot_index <= 3));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_invite_codes_owner_account_id
  ON public.invite_codes(owner_account_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_invite_codes_owner_slot_unique
  ON public.invite_codes(owner_account_id, slot_index);

COMMIT;
