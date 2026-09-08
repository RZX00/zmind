BEGIN;

SET LOCAL lock_timeout = '30s';

-- Align credit tables to basejump.accounts so team workspaces can be billed.
ALTER TABLE credit_accounts DROP CONSTRAINT IF EXISTS credit_accounts_user_id_fkey;
ALTER TABLE credit_accounts DROP CONSTRAINT IF EXISTS credit_accounts_account_id_fkey;
ALTER TABLE credit_accounts
    ADD CONSTRAINT credit_accounts_account_id_fkey
    FOREIGN KEY (account_id) REFERENCES basejump.accounts(id) ON DELETE CASCADE;

ALTER TABLE credit_ledger DROP CONSTRAINT IF EXISTS credit_ledger_user_id_fkey;
ALTER TABLE credit_ledger DROP CONSTRAINT IF EXISTS credit_ledger_account_id_fkey;
ALTER TABLE credit_ledger
    ADD CONSTRAINT credit_ledger_account_id_fkey
    FOREIGN KEY (account_id) REFERENCES basejump.accounts(id) ON DELETE CASCADE;

ALTER TABLE credit_purchases DROP CONSTRAINT IF EXISTS credit_purchases_user_id_fkey;
ALTER TABLE credit_purchases DROP CONSTRAINT IF EXISTS credit_purchases_account_id_fkey;
ALTER TABLE credit_purchases
    ADD CONSTRAINT credit_purchases_account_id_fkey
    FOREIGN KEY (account_id) REFERENCES basejump.accounts(id) ON DELETE CASCADE;

ALTER TABLE credit_balance DROP CONSTRAINT IF EXISTS credit_balance_user_id_fkey;
ALTER TABLE credit_balance DROP CONSTRAINT IF EXISTS credit_balance_account_id_fkey;
ALTER TABLE credit_balance
    ADD CONSTRAINT credit_balance_account_id_fkey
    FOREIGN KEY (account_id) REFERENCES basejump.accounts(id) ON DELETE CASCADE;

ALTER TABLE credit_usage DROP CONSTRAINT IF EXISTS credit_usage_user_id_fkey;
ALTER TABLE credit_usage DROP CONSTRAINT IF EXISTS credit_usage_account_id_fkey;
ALTER TABLE credit_usage
    ADD CONSTRAINT credit_usage_account_id_fkey
    FOREIGN KEY (account_id) REFERENCES basejump.accounts(id) ON DELETE CASCADE;

-- Ensure credit_accounts exists for every account (personal + team).
CREATE OR REPLACE FUNCTION initialize_free_tier_credits()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_initial_credits DECIMAL := 0.0;
BEGIN
    INSERT INTO public.credit_accounts (
        account_id,
        balance,
        tier,
        last_grant_date
    ) VALUES (
        NEW.id,
        v_initial_credits,
        'none',
        NOW()
    )
    ON CONFLICT (account_id) DO NOTHING;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auto_create_free_tier_on_account ON basejump.accounts;

CREATE TRIGGER auto_create_free_tier_on_account
    AFTER INSERT ON basejump.accounts
    FOR EACH ROW
    EXECUTE FUNCTION initialize_free_tier_credits();

-- Backfill missing credit_accounts rows for existing accounts.
INSERT INTO public.credit_accounts (
    account_id,
    balance,
    tier,
    last_grant_date
)
SELECT a.id,
       0.0,
       'none',
       a.created_at
FROM basejump.accounts a
LEFT JOIN public.credit_accounts ca ON ca.account_id = a.id
WHERE ca.account_id IS NULL;

COMMIT;
