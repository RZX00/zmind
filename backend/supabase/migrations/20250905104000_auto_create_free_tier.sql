BEGIN;

SET LOCAL lock_timeout = '30s';

CREATE OR REPLACE FUNCTION initialize_free_tier_credits()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_initial_credits DECIMAL := 0.0; -- Disable auto free credits (set to 0)
    v_rowcount INT;
BEGIN
    IF NEW.personal_account = TRUE THEN
        INSERT INTO public.credit_accounts (
            user_id,
            balance,
            tier,
            last_grant_date
        ) VALUES (
            NEW.id,
            v_initial_credits,
            'none', -- keep user in 'none' tier
            NOW()
        )
        ON CONFLICT (user_id) DO NOTHING;

        GET DIAGNOSTICS v_rowcount = ROW_COUNT;
        -- Do NOT insert into credit_ledger to keep account eligible for invite redemption
    END IF;
    
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auto_create_free_tier_on_account ON basejump.accounts;

CREATE TRIGGER auto_create_free_tier_on_account
    AFTER INSERT ON basejump.accounts
    FOR EACH ROW
    EXECUTE FUNCTION initialize_free_tier_credits();

-- Backfill step: create credit_accounts rows without free credits or ledger entries
DO $$
DECLARE
    account_record RECORD;
    v_created_count INTEGER := 0;
BEGIN
    FOR account_record IN 
        SELECT a.id, a.created_at
        FROM basejump.accounts a
        LEFT JOIN public.credit_accounts ca ON ca.user_id = a.id
        WHERE a.personal_account = TRUE
        AND ca.user_id IS NULL
    LOOP
        INSERT INTO public.credit_accounts (
            user_id,
            balance,
            tier,
            last_grant_date
        ) VALUES (
            account_record.id,
            0.0,
            'none',
            account_record.created_at
        );
        v_created_count := v_created_count + 1;
    END LOOP;
    IF v_created_count > 0 THEN
        RAISE NOTICE 'Created zero-balance credit_accounts for % existing users', v_created_count;
    END IF;
END;
$$;

COMMIT;
