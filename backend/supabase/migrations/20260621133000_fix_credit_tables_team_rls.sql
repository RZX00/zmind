-- backend/supabase/migrations/20260621133000_fix_credit_tables_team_rls.sql
-- SPEC §14.6:团队计费(20251230090000)把 credit_accounts/credit_ledger 的 FK 重指向
-- basejump.accounts 后,旧 SELECT 策略 auth.uid()=account_id 对团队账户失效(account_id 是
-- 团队 id,非成员 uid)→ 团队成员读不到团队信用。改用 basejump.has_role_on_account(account_id)。
-- 纯 RLS:不动数据/列/service_role 写策略。
BEGIN;

-- credit_accounts:成员可读所属账户(个人或团队)的信用账户
DROP POLICY IF EXISTS "Users can view own credit account" ON credit_accounts;
CREATE POLICY "Members can view account credit account" ON credit_accounts
    FOR SELECT USING (basejump.has_role_on_account(account_id));

-- credit_ledger:成员可读所属账户的信用流水
DROP POLICY IF EXISTS "Users can view own ledger" ON credit_ledger;
CREATE POLICY "Members can view account ledger" ON credit_ledger
    FOR SELECT USING (basejump.has_role_on_account(account_id));

COMMIT;
