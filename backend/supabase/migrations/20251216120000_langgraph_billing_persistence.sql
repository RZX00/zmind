-- WS-D (Billing & Persistence): Idempotent billing + message persistence + shadow flags
-- This migration is additive and backward compatible (new nullable columns + partial indexes).

BEGIN;

-- ---------------------------------------------------------------------------
-- agent_runs: engine/shadow/checkpoint metadata (backward compatible additions)
-- ---------------------------------------------------------------------------

ALTER TABLE agent_runs
    ADD COLUMN IF NOT EXISTS engine TEXT NOT NULL DEFAULT 'agentpress',
    ADD COLUMN IF NOT EXISTS engine_version TEXT,
    ADD COLUMN IF NOT EXISTS is_shadow BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS shadow_parent_run_id UUID,
    ADD COLUMN IF NOT EXISTS checkpoint_id TEXT,
    ADD COLUMN IF NOT EXISTS checkpoint_thread_id TEXT,
    ADD COLUMN IF NOT EXISTS run_mode TEXT,
    ADD COLUMN IF NOT EXISTS side_effect_policy TEXT,
    ADD COLUMN IF NOT EXISTS shadow_report JSONB;

CREATE INDEX IF NOT EXISTS idx_agent_runs_is_shadow ON agent_runs(is_shadow);
CREATE INDEX IF NOT EXISTS idx_agent_runs_engine ON agent_runs(engine);

-- ---------------------------------------------------------------------------
-- messages: idempotency keys + engine/shadow/checkpoint metadata
-- ---------------------------------------------------------------------------

ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS engine TEXT,
    ADD COLUMN IF NOT EXISTS engine_version TEXT,
    ADD COLUMN IF NOT EXISTS llm_response_id TEXT,
    ADD COLUMN IF NOT EXISTS billing_dedup_key TEXT,
    ADD COLUMN IF NOT EXISTS message_dedup_key TEXT,
    ADD COLUMN IF NOT EXISTS checkpoint_id TEXT,
    ADD COLUMN IF NOT EXISTS is_shadow BOOLEAN NOT NULL DEFAULT FALSE;

-- Idempotent message write relies on a partial unique index (allows legacy rows with NULL).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_messages_message_dedup_key
    ON messages(message_dedup_key)
    WHERE message_dedup_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_llm_response_id
    ON messages(llm_response_id)
    WHERE llm_response_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_billing_dedup_key
    ON messages(billing_dedup_key)
    WHERE billing_dedup_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_is_shadow
    ON messages(is_shadow)
    WHERE is_shadow = TRUE;

-- ---------------------------------------------------------------------------
-- credit_ledger: idempotent billing key (partial unique index)
-- ---------------------------------------------------------------------------

ALTER TABLE credit_ledger
    ADD COLUMN IF NOT EXISTS billing_dedup_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_credit_ledger_billing_dedup_key
    ON credit_ledger(billing_dedup_key)
    WHERE billing_dedup_key IS NOT NULL;

-- ---------------------------------------------------------------------------
-- RPC: deduct_credits_idempotent (atomic: dedupe -> deduct -> ledger insert)
--
-- Contract:
-- - If billing_dedup_key already exists: return success=true, duplicate=true,
--   and the original transaction_id/balance_after (no additional deduction).
-- - Otherwise: lock credit_accounts row, validate balance, deduct expiring then
--   non-expiring credits, insert ledger row with billing_dedup_key.
-- ---------------------------------------------------------------------------

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

    v_credit_sum DECIMAL;
    v_diff DECIMAL;

    v_from_expiring DECIMAL;
    v_from_non_expiring DECIMAL;

    v_new_expiring DECIMAL;
    v_new_non_expiring DECIMAL;
    v_new_total DECIMAL;

    v_metadata JSONB;
BEGIN
    -- Basic input validation
    IF p_billing_dedup_key IS NULL OR length(trim(p_billing_dedup_key)) = 0 THEN
        RETURN QUERY SELECT FALSE, FALSE, NULL::DECIMAL, NULL::UUID, 'billing_dedup_key_required';
        RETURN;
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RETURN QUERY SELECT TRUE, FALSE, NULL::DECIMAL, NULL::UUID, NULL::TEXT;
        RETURN;
    END IF;

    -- Lock the account row to serialize deductions for this account.
    SELECT expiring_credits, non_expiring_credits, balance
    INTO v_current_expiring, v_current_non_expiring, v_current_total
    FROM credit_accounts
    WHERE account_id = p_account_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, FALSE, NULL::DECIMAL, NULL::UUID, 'no_credit_account';
        RETURN;
    END IF;

    -- Dedupe check AFTER taking the account lock (prevents concurrent double-deduct).
    SELECT id, balance_after
    INTO v_existing_id, v_existing_balance
    FROM credit_ledger
    WHERE billing_dedup_key = p_billing_dedup_key
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
        RETURN QUERY SELECT TRUE, TRUE, v_existing_balance, v_existing_id, NULL::TEXT;
        RETURN;
    END IF;

    -- Defensive: reconcile expiring/non-expiring breakdown with total balance.
    v_credit_sum := COALESCE(v_current_expiring, 0) + COALESCE(v_current_non_expiring, 0);
    v_diff := COALESCE(v_current_total, 0) - v_credit_sum;

    IF abs(v_diff) > 0.01 THEN
        IF v_diff > 0 THEN
            v_current_non_expiring := COALESCE(v_current_non_expiring, 0) + v_diff;
        ELSE
            IF COALESCE(v_current_expiring, 0) >= abs(v_diff) THEN
                v_current_expiring := COALESCE(v_current_expiring, 0) - abs(v_diff);
            ELSE
                v_current_non_expiring := GREATEST(
                    0,
                    COALESCE(v_current_non_expiring, 0) - (abs(v_diff) - COALESCE(v_current_expiring, 0))
                );
                v_current_expiring := 0;
            END IF;
        END IF;
        v_current_total := COALESCE(v_current_expiring, 0) + COALESCE(v_current_non_expiring, 0);
    END IF;

    IF v_current_total < p_amount THEN
        RETURN QUERY SELECT FALSE, FALSE, v_current_total, NULL::UUID, 'insufficient_credits';
        RETURN;
    END IF;

    v_from_expiring := LEAST(COALESCE(v_current_expiring, 0), p_amount);
    v_from_non_expiring := p_amount - v_from_expiring;

    v_new_expiring := COALESCE(v_current_expiring, 0) - v_from_expiring;
    v_new_non_expiring := COALESCE(v_current_non_expiring, 0) - v_from_non_expiring;
    v_new_total := v_new_expiring + v_new_non_expiring;

    UPDATE credit_accounts
    SET
        expiring_credits = v_new_expiring,
        non_expiring_credits = v_new_non_expiring,
        balance = v_new_total,
        updated_at = NOW()
    WHERE account_id = p_account_id;

    v_metadata := jsonb_build_object(
        'thread_id', p_thread_id,
        'message_id', p_message_id,
        'from_expiring', v_from_expiring,
        'from_non_expiring', v_from_non_expiring
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

GRANT EXECUTE ON FUNCTION public.deduct_credits_idempotent(UUID, DECIMAL, TEXT, TEXT, UUID, UUID, JSONB)
    TO service_role;

COMMIT;

