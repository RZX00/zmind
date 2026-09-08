BEGIN;

ALTER TABLE credit_accounts
    ADD COLUMN IF NOT EXISTS daily_login_remaining DECIMAL(12, 4) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS daily_login_last_reset_date DATE;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'credit_accounts_daily_login_remaining_check'
    ) THEN
        ALTER TABLE credit_accounts
            ADD CONSTRAINT credit_accounts_daily_login_remaining_check
            CHECK (daily_login_remaining >= 0);
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.refresh_daily_login_credits(
    p_account_id UUID,
    p_amount DECIMAL,
    p_day_key DATE,
    p_description TEXT DEFAULT NULL
)
RETURNS TABLE (
    success BOOLEAN,
    duplicate BOOLEAN,
    new_balance DECIMAL,
    delta DECIMAL,
    error TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_day_key DATE;
    v_current_expiring DECIMAL;
    v_current_non_expiring DECIMAL;
    v_current_total DECIMAL;
    v_current_daily_login_remaining DECIMAL;
    v_last_reset_date DATE;
    v_new_non_expiring DECIMAL;
    v_new_total DECIMAL;
    v_delta DECIMAL;
    v_target_daily_remaining DECIMAL;
    v_desc TEXT;
BEGIN
    IF p_amount IS NULL OR p_amount < 0 THEN
        RETURN QUERY SELECT FALSE, FALSE, NULL::DECIMAL, NULL::DECIMAL, 'invalid_amount';
        RETURN;
    END IF;

    v_day_key := COALESCE(p_day_key, (NOW() AT TIME ZONE 'UTC')::DATE);

    SELECT
        COALESCE(expiring_credits, 0),
        COALESCE(non_expiring_credits, 0),
        COALESCE(balance, 0),
        COALESCE(daily_login_remaining, 0),
        daily_login_last_reset_date
    INTO
        v_current_expiring,
        v_current_non_expiring,
        v_current_total,
        v_current_daily_login_remaining,
        v_last_reset_date
    FROM credit_accounts
    WHERE account_id = p_account_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, FALSE, NULL::DECIMAL, NULL::DECIMAL, 'no_credit_account';
        RETURN;
    END IF;

    IF v_last_reset_date = v_day_key THEN
        RETURN QUERY SELECT TRUE, TRUE, v_current_total, 0::DECIMAL, NULL::TEXT;
        RETURN;
    END IF;

    v_delta := p_amount - v_current_daily_login_remaining;
    v_new_non_expiring := v_current_non_expiring + v_delta;
    IF v_new_non_expiring < 0 THEN
        v_new_non_expiring := 0;
    END IF;

    v_target_daily_remaining := p_amount;
    IF v_target_daily_remaining > v_new_non_expiring THEN
        v_target_daily_remaining := v_new_non_expiring;
    END IF;

    -- Recompute delta after normalization for full consistency.
    v_delta := v_new_non_expiring - v_current_non_expiring;
    v_new_total := v_current_expiring + v_new_non_expiring;
    v_desc := COALESCE(NULLIF(TRIM(p_description), ''), 'Daily login reset ' || v_day_key::TEXT);

    UPDATE credit_accounts
    SET
        non_expiring_credits = v_new_non_expiring,
        balance = v_new_total,
        daily_login_remaining = v_target_daily_remaining,
        daily_login_last_reset_date = v_day_key,
        updated_at = NOW()
    WHERE account_id = p_account_id;

    IF v_delta <> 0 THEN
        INSERT INTO credit_ledger (
            account_id,
            amount,
            balance_after,
            type,
            description,
            is_expiring,
            metadata
        )
        VALUES (
            p_account_id,
            v_delta,
            v_new_total,
            'daily_login',
            v_desc,
            FALSE,
            jsonb_build_object(
                'source', 'daily_login_reset',
                'refresh_date', v_day_key::TEXT,
                'target_amount', p_amount,
                'previous_daily_login_remaining', v_current_daily_login_remaining,
                'new_daily_login_remaining', v_target_daily_remaining,
                'reset_mode', 'fixed_non_cumulative'
            )
        );
    END IF;

    RETURN QUERY SELECT TRUE, FALSE, v_new_total, v_delta, NULL::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_daily_login_credits(
    UUID,
    DECIMAL,
    DATE,
    TEXT
) TO service_role;

CREATE OR REPLACE FUNCTION public.deduct_credits_idempotent(
    p_account_id UUID,
    p_amount DECIMAL,
    p_description TEXT,
    p_billing_dedup_key TEXT,
    p_thread_id UUID DEFAULT NULL,
    p_message_id UUID DEFAULT NULL,
    p_extra_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (
    success BOOLEAN,
    duplicate BOOLEAN,
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
    v_current_daily_login_remaining DECIMAL;

    v_credit_sum DECIMAL;
    v_diff DECIMAL;

    v_from_expiring DECIMAL;
    v_from_non_expiring DECIMAL;
    v_from_daily_login DECIMAL;

    v_new_expiring DECIMAL;
    v_new_non_expiring DECIMAL;
    v_new_total DECIMAL;
    v_new_daily_login_remaining DECIMAL;

    v_metadata JSONB;
BEGIN
    IF p_billing_dedup_key IS NULL OR length(trim(p_billing_dedup_key)) = 0 THEN
        RETURN QUERY SELECT FALSE, FALSE, NULL::DECIMAL, NULL::UUID, 'billing_dedup_key_required';
        RETURN;
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RETURN QUERY SELECT TRUE, FALSE, NULL::DECIMAL, NULL::UUID, NULL::TEXT;
        RETURN;
    END IF;

    SELECT
        COALESCE(expiring_credits, 0),
        COALESCE(non_expiring_credits, 0),
        COALESCE(balance, 0),
        COALESCE(daily_login_remaining, 0)
    INTO
        v_current_expiring,
        v_current_non_expiring,
        v_current_total,
        v_current_daily_login_remaining
    FROM credit_accounts
    WHERE account_id = p_account_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, FALSE, NULL::DECIMAL, NULL::UUID, 'no_credit_account';
        RETURN;
    END IF;

    SELECT id, balance_after
    INTO v_existing_id, v_existing_balance
    FROM credit_ledger
    WHERE billing_dedup_key = p_billing_dedup_key
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
        RETURN QUERY SELECT TRUE, TRUE, v_existing_balance, v_existing_id, NULL::TEXT;
        RETURN;
    END IF;

    v_credit_sum := v_current_expiring + v_current_non_expiring;
    v_diff := v_current_total - v_credit_sum;

    IF abs(v_diff) > 0.01 THEN
        IF v_diff > 0 THEN
            v_current_non_expiring := v_current_non_expiring + v_diff;
        ELSE
            IF v_current_expiring >= abs(v_diff) THEN
                v_current_expiring := v_current_expiring - abs(v_diff);
            ELSE
                v_current_non_expiring := GREATEST(
                    0,
                    v_current_non_expiring - (abs(v_diff) - v_current_expiring)
                );
                v_current_expiring := 0;
            END IF;
        END IF;
        v_current_total := v_current_expiring + v_current_non_expiring;
    END IF;

    IF v_current_total < p_amount THEN
        RETURN QUERY SELECT FALSE, FALSE, v_current_total, NULL::UUID, 'insufficient_credits';
        RETURN;
    END IF;

    v_from_expiring := LEAST(v_current_expiring, p_amount);
    v_from_non_expiring := p_amount - v_from_expiring;
    v_from_daily_login := LEAST(v_current_daily_login_remaining, v_from_non_expiring);

    v_new_expiring := v_current_expiring - v_from_expiring;
    v_new_non_expiring := v_current_non_expiring - v_from_non_expiring;
    v_new_total := v_new_expiring + v_new_non_expiring;
    v_new_daily_login_remaining := GREATEST(0, v_current_daily_login_remaining - v_from_non_expiring);

    UPDATE credit_accounts
    SET
        expiring_credits = v_new_expiring,
        non_expiring_credits = v_new_non_expiring,
        balance = v_new_total,
        daily_login_remaining = v_new_daily_login_remaining,
        updated_at = NOW()
    WHERE account_id = p_account_id;

    v_metadata := jsonb_build_object(
        'thread_id', p_thread_id,
        'message_id', p_message_id,
        'from_expiring', v_from_expiring,
        'from_non_expiring', v_from_non_expiring,
        'from_daily_login', v_from_daily_login
    );

    IF p_extra_metadata IS NOT NULL THEN
        v_metadata := v_metadata || p_extra_metadata;
    END IF;

    INSERT INTO credit_ledger (
        account_id,
        amount,
        balance_after,
        type,
        description,
        reference_id,
        metadata,
        billing_dedup_key
    )
    VALUES (
        p_account_id,
        -p_amount,
        v_new_total,
        'usage',
        p_description,
        COALESCE(p_thread_id, p_message_id),
        v_metadata,
        p_billing_dedup_key
    )
    RETURNING id INTO transaction_id;

    RETURN QUERY SELECT TRUE, FALSE, v_new_total, transaction_id, NULL::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.deduct_credits_idempotent(
    UUID,
    DECIMAL,
    TEXT,
    TEXT,
    UUID,
    UUID,
    JSONB
) TO service_role;

COMMIT;
