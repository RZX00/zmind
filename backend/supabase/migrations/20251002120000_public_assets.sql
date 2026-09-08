BEGIN;

-- Simple key-value table for public assets (e.g., WeChat QR code)
CREATE TABLE IF NOT EXISTS public.public_assets (
    key TEXT PRIMARY KEY,
    path TEXT NOT NULL,
    public_url TEXT NOT NULL,
    updated_by UUID,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_public_assets_key ON public.public_assets(key);

ALTER TABLE public.public_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service role can manage public assets" ON public.public_assets;
CREATE POLICY "service role can manage public assets" ON public.public_assets
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

GRANT ALL ON public.public_assets TO service_role;

COMMIT;
