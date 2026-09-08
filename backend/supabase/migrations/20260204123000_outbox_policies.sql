BEGIN;

ALTER TABLE public.domain_outbox ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'domain_outbox'
          AND policyname = 'service_role_all_domain_outbox'
    ) THEN
        CREATE POLICY "service_role_all_domain_outbox"
            ON public.domain_outbox
            FOR ALL
            TO service_role
            USING (true)
            WITH CHECK (true);
    END IF;
END $$;

ALTER TABLE public.projection_offsets ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'projection_offsets'
          AND policyname = 'service_role_all_projection_offsets'
    ) THEN
        CREATE POLICY "service_role_all_projection_offsets"
            ON public.projection_offsets
            FOR ALL
            TO service_role
            USING (true)
            WITH CHECK (true);
    END IF;
END $$;

COMMIT;
