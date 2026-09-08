-- backend/supabase/migrations/20260621120000_drop_subscription_columns.sql
-- 纯预付费收敛(D1/D7):移除 credit_accounts 的订阅/Creem/Stripe-订阅/commitment 列。
-- 保留:tier(驱动 entitlements 兼容层 + admin 视图)、balance、expiring/non_expiring、daily_login_remaining。
-- 前置:所有代码读者已删除(Plan 4 Task 2-8)。
BEGIN;

-- 索引先删(列删除会级联,但显式 drop 更清晰可回看)
DROP INDEX IF EXISTS idx_credit_accounts_billing_provider;
DROP INDEX IF EXISTS idx_credit_accounts_provider_subscription_id;
DROP INDEX IF EXISTS idx_credit_accounts_stripe_subscription_id;
DROP INDEX IF EXISTS idx_credit_accounts_commitment;

-- Creem/通用 provider 列(20251220090000_add_billing_provider_fields.sql)
ALTER TABLE credit_accounts DROP COLUMN IF EXISTS billing_provider;
ALTER TABLE credit_accounts DROP COLUMN IF EXISTS provider_customer_id;
ALTER TABLE credit_accounts DROP COLUMN IF EXISTS provider_subscription_id;
ALTER TABLE credit_accounts DROP COLUMN IF EXISTS provider_product_id;
ALTER TABLE credit_accounts DROP COLUMN IF EXISTS last_processed_transaction_id;

-- Stripe 订阅列(20250906100512_remove_redundant_stuff.sql 等)
ALTER TABLE credit_accounts DROP COLUMN IF EXISTS stripe_subscription_id;

-- commitment 列(20250923070217_commitment_tracking.sql)
ALTER TABLE credit_accounts DROP COLUMN IF EXISTS commitment_type;
ALTER TABLE credit_accounts DROP COLUMN IF EXISTS commitment_start_date;
ALTER TABLE credit_accounts DROP COLUMN IF EXISTS commitment_end_date;
ALTER TABLE credit_accounts DROP COLUMN IF EXISTS commitment_price_id;
ALTER TABLE credit_accounts DROP COLUMN IF EXISTS can_cancel_after;

-- commitment 历史表(无订阅后无用)
DROP TABLE IF EXISTS commitment_history CASCADE;

COMMIT;
