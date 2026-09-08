-- backend/supabase/migrations/20260621130000_retire_legacy_credit_tables.sql
-- 退役 v1 信用表(credit_balance/credit_usage:唯一读者 core/services/billing.py 已删)
-- 弃用 credit_purchases(充值跟踪迁至 payment_orders + credit_ledger;读者已全删)。
-- 绝不动 live 表:credit_accounts / credit_ledger / payment_orders。
BEGIN;

-- v1 dormant 表
DROP TABLE IF EXISTS credit_balance CASCADE;
DROP TABLE IF EXISTS credit_usage CASCADE;

-- credit_purchases:充值跟踪已由 payment_orders 取代(D6/D7)。
-- 默认假定无需保留历史(D7 Step 0 已确认)→ 直接 drop。
-- 若需保留历史审计:删除下一行,改用 COMMENT 标注弃用。
DROP TABLE IF EXISTS credit_purchases CASCADE;

COMMIT;
