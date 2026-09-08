BEGIN;

CREATE OR REPLACE FUNCTION public.add_credits_idempotent(
    p_account_id UUID,
    p_amount DECIMAL,
    p_type TEXT DEFAULT NULL,
    p_description TEXT DEFAULT 'Credit added',
    p_is_expiring BOOLEAN DEFAULT true,
    p_expires_at TIMESTAMPTZ DEFAULT NULL,
    p_billing_dedup_key TEXT DEFAULT NULL
)
RETURNS TABLE (
    success BOOLEAN,
    duplicate BOOLEAN,
    expiring_credits DECIMAL,
    non_expiring_credits DECIMAL,
    new_balance DECIMAL,
    transaction_id UUID,
    error TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_existing_id UUID;
    v_existing_balance DECIMAL;
    v_current_expiring DECIMAL;
    v_current_non_expiring DECIMAL;
    v_current_total DECIMAL;
    v_new_expiring DECIMAL;
    v_new_non_expiring DECIMAL;
    v_new_total DECIMAL;
    v_tx_id UUID;
    v_type TEXT;
BEGIN
    IF p_billing_dedup_key IS NULL OR length(trim(p_billing_dedup_key)) = 0 THEN
        RETURN QUERY SELECT FALSE, FALSE, NULL::DECIMAL, NULL::DECIMAL, NULL::DECIMAL, NULL::UUID, 'billing_dedup_key_required';
        RETURN;
    END IF;

    -- Ensure account row exists to allow row locking.
    INSERT INTO credit_accounts (account_id, expiring_credits, non_expiring_credits, balance, tier)
    VALUES (p_account_id, 0, 0, 0, 'free')
    ON CONFLICT (account_id) DO NOTHING;

    SELECT ca.expiring_credits, ca.non_expiring_credits, ca.balance
    INTO v_current_expiring, v_current_non_expiring, v_current_total
    FROM credit_accounts ca
    WHERE ca.account_id = p_account_id
    FOR UPDATE;

    SELECT id, balance_after
    INTO v_existing_id, v_existing_balance
    FROM credit_ledger
    WHERE billing_dedup_key = p_billing_dedup_key
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
        RETURN QUERY SELECT TRUE, TRUE, v_current_expiring, v_current_non_expiring,
            COALESCE(v_existing_balance, v_current_total), v_existing_id, NULL::TEXT;
        RETURN;
    END IF;

    v_current_expiring := COALESCE(v_current_expiring, 0);
    v_current_non_expiring := COALESCE(v_current_non_expiring, 0);

    IF p_is_expiring THEN
        v_new_expiring := v_current_expiring + p_amount;
        v_new_non_expiring := v_current_non_expiring;
    ELSE
        v_new_expiring := v_current_expiring;
        v_new_non_expiring := v_current_non_expiring + p_amount;
    END IF;

    v_new_total := v_new_expiring + v_new_non_expiring;

    UPDATE credit_accounts
    SET expiring_credits = v_new_expiring,
        non_expiring_credits = v_new_non_expiring,
        balance = v_new_total,
        updated_at = NOW()
    WHERE account_id = p_account_id;

    v_type := COALESCE(p_type, CASE WHEN p_is_expiring THEN 'tier_grant' ELSE 'purchase' END);

    INSERT INTO credit_ledger (
        account_id,
        amount,
        balance_after,
        type,
        description,
        is_expiring,
        expires_at,
        billing_dedup_key
    )
    VALUES (
        p_account_id,
        p_amount,
        v_new_total,
        v_type,
        p_description,
        p_is_expiring,
        p_expires_at,
        p_billing_dedup_key
    )
    RETURNING id INTO v_tx_id;

    RETURN QUERY SELECT TRUE, FALSE, v_new_expiring, v_new_non_expiring, v_new_total, v_tx_id, NULL::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_credits_idempotent(
    UUID,
    DECIMAL,
    TEXT,
    TEXT,
    BOOLEAN,
    TIMESTAMPTZ,
    TEXT
) TO service_role;

COMMIT;
