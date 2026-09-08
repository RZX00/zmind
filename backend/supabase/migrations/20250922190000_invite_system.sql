BEGIN;

-- Invite codes table
CREATE TABLE IF NOT EXISTS public.invite_codes (
    id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    code TEXT NOT NULL,
    reward_amount DECIMAL(12, 2), -- NULL = use backend default
    expires_at TIMESTAMPTZ,
    max_redemptions INTEGER NOT NULL DEFAULT 1 CHECK (max_redemptions >= 1),
    redeemed_count INTEGER NOT NULL DEFAULT 0 CHECK (redeemed_count >= 0),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    campaign TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Case-insensitive uniqueness on code
CREATE UNIQUE INDEX IF NOT EXISTS idx_invite_codes_code_unique 
    ON public.invite_codes (lower(code));

CREATE INDEX IF NOT EXISTS idx_invite_codes_active_expires 
    ON public.invite_codes (active, expires_at);

-- Invite redemptions table
CREATE TABLE IF NOT EXISTS public.invite_redemptions (
    id UUID PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    code_id UUID NOT NULL REFERENCES public.invite_codes(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reward_amount DECIMAL(12, 2),
    credit_expires_at TIMESTAMPTZ,
    ip TEXT,
    ua TEXT
);

-- Prevent same account redeeming multiple times across codes
CREATE UNIQUE INDEX IF NOT EXISTS idx_invite_redemptions_account_unique 
    ON public.invite_redemptions (account_id);

-- Prevent same code being used by multiple accounts (even if max_redemptions is 1)
CREATE UNIQUE INDEX IF NOT EXISTS idx_invite_redemptions_code_unique 
    ON public.invite_redemptions (code_id);

-- Also keep (code_id, account_id) pair unique for safety
CREATE UNIQUE INDEX IF NOT EXISTS idx_invite_redemptions_code_account_unique 
    ON public.invite_redemptions (code_id, account_id);

-- Enable RLS and allow service role to manage
ALTER TABLE public.invite_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invite_redemptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service role can manage invite codes" ON public.invite_codes;
CREATE POLICY "service role can manage invite codes" ON public.invite_codes
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service role can manage invite redemptions" ON public.invite_redemptions;
CREATE POLICY "service role can manage invite redemptions" ON public.invite_redemptions
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

GRANT ALL ON public.invite_codes TO service_role;
GRANT ALL ON public.invite_redemptions TO service_role;

-- Extend credit_accounts with an invite access expiry marker
ALTER TABLE public.credit_accounts 
    ADD COLUMN IF NOT EXISTS invite_access_expires_at TIMESTAMPTZ;

-- Seed initial 20 invite codes (6-8 chars, uppercase, max once)
INSERT INTO public.invite_codes (code, reward_amount, max_redemptions, active, campaign)
VALUES
('K4Z7M9', NULL, 1, TRUE, 'beta'),
('H8Q2N7', NULL, 1, TRUE, 'beta'),
('P1X9D3', NULL, 1, TRUE, 'beta'),
('R7M8T2', NULL, 1, TRUE, 'beta'),
('B6C4Y8', NULL, 1, TRUE, 'beta'),
('T9F1L6', NULL, 1, TRUE, 'beta'),
('N3J7K5', NULL, 1, TRUE, 'beta'),
('W2Q8S4', NULL, 1, TRUE, 'beta'),
('M5V9H1', NULL, 1, TRUE, 'beta'),
('G8L2P7', NULL, 1, TRUE, 'beta'),
('D4R6X9', NULL, 1, TRUE, 'beta'),
('S7K1N3', NULL, 1, TRUE, 'beta'),
('U2H5B8', NULL, 1, TRUE, 'beta'),
('Y9T3C6', NULL, 1, TRUE, 'beta'),
('Q6M8V2', NULL, 1, TRUE, 'beta'),
('L1P7G4', NULL, 1, TRUE, 'beta'),
('V8D2R5', NULL, 1, TRUE, 'beta'),
('C3N6W9', NULL, 1, TRUE, 'beta'),
('F5X1T7', NULL, 1, TRUE, 'beta'),
('J2H8M4', NULL, 1, TRUE, 'beta')
ON CONFLICT DO NOTHING;

COMMIT;

