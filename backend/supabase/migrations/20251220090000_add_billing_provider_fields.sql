BEGIN;

ALTER TABLE credit_accounts
ADD COLUMN IF NOT EXISTS billing_provider TEXT DEFAULT 'creem',
ADD COLUMN IF NOT EXISTS provider_customer_id TEXT,
ADD COLUMN IF NOT EXISTS provider_subscription_id TEXT,
ADD COLUMN IF NOT EXISTS provider_product_id TEXT,
ADD COLUMN IF NOT EXISTS last_processed_transaction_id TEXT;

CREATE INDEX IF NOT EXISTS idx_credit_accounts_billing_provider
    ON credit_accounts(billing_provider);

CREATE INDEX IF NOT EXISTS idx_credit_accounts_provider_subscription_id
    ON credit_accounts(provider_subscription_id);

ALTER TABLE credit_purchases
ADD COLUMN IF NOT EXISTS billing_provider TEXT DEFAULT 'creem',
ADD COLUMN IF NOT EXISTS provider_checkout_id TEXT,
ADD COLUMN IF NOT EXISTS provider_transaction_id TEXT,
ADD COLUMN IF NOT EXISTS provider_customer_id TEXT;

CREATE INDEX IF NOT EXISTS idx_credit_purchases_provider_checkout_id
    ON credit_purchases(provider_checkout_id);

ALTER TABLE trial_history
ADD COLUMN IF NOT EXISTS billing_provider TEXT DEFAULT 'creem',
ADD COLUMN IF NOT EXISTS provider_checkout_id TEXT;

ALTER TABLE IF EXISTS commitment_history
ADD COLUMN IF NOT EXISTS billing_provider TEXT DEFAULT 'creem',
ADD COLUMN IF NOT EXISTS provider_subscription_id TEXT;

UPDATE credit_accounts
SET billing_provider = 'stripe'
WHERE billing_provider IS NULL
  AND stripe_subscription_id IS NOT NULL;

UPDATE credit_accounts
SET billing_provider = 'creem'
WHERE billing_provider IS NULL;

UPDATE credit_accounts
SET provider_subscription_id = stripe_subscription_id
WHERE provider_subscription_id IS NULL
  AND stripe_subscription_id IS NOT NULL;

UPDATE basejump.billing_customers
SET provider = 'stripe'
WHERE provider IS NULL
  AND id LIKE 'cus_%';

UPDATE basejump.billing_customers
SET provider = 'creem'
WHERE provider IS NULL;

UPDATE basejump.billing_subscriptions
SET provider = 'stripe'
WHERE provider IS NULL
  AND id LIKE 'sub_%';

UPDATE basejump.billing_subscriptions
SET provider = 'creem'
WHERE provider IS NULL;

UPDATE credit_purchases
SET billing_provider = 'stripe'
WHERE billing_provider IS NULL
  AND (stripe_payment_intent_id IS NOT NULL OR stripe_charge_id IS NOT NULL);

UPDATE credit_purchases
SET billing_provider = 'creem'
WHERE billing_provider IS NULL;

UPDATE trial_history
SET billing_provider = 'stripe'
WHERE billing_provider IS NULL
  AND stripe_checkout_session_id IS NOT NULL;

UPDATE trial_history
SET billing_provider = 'creem'
WHERE billing_provider IS NULL;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'commitment_history'
    ) THEN
        UPDATE commitment_history
        SET billing_provider = 'stripe'
        WHERE billing_provider IS NULL
          AND stripe_subscription_id IS NOT NULL;

        UPDATE commitment_history
        SET billing_provider = 'creem'
        WHERE billing_provider IS NULL;
    END IF;
END $$;

UPDATE basejump.config
SET billing_provider = 'creem'
WHERE billing_provider IS NULL OR billing_provider = 'stripe';

UPDATE credit_accounts ca
SET provider_customer_id = bc.id
FROM basejump.billing_customers bc
WHERE bc.account_id = ca.account_id
  AND bc.provider IN ('stripe', 'creem')
  AND ca.provider_customer_id IS NULL;

COMMIT;
