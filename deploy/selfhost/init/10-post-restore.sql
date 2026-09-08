-- =============================================================================
-- 恢复完 Supabase dump 之后的收尾。幂等，可重复执行。
-- =============================================================================

\set ON_ERROR_STOP on

-- -----------------------------------------------------------------------------
-- 1. auth schema 交给 supabase_auth_admin
--
-- dump 用 --no-owner 恢复，所有对象归 postgres。但 GoTrue 是以
-- supabase_auth_admin 身份连库的，它启动时要读写 auth.schema_migrations、
-- 并对 auth.* 做 DDL/DML，不拥有这些对象会直接 permission denied。
-- -----------------------------------------------------------------------------

ALTER SCHEMA auth OWNER TO supabase_auth_admin;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'auth' LOOP
    EXECUTE format('ALTER TABLE auth.%I OWNER TO supabase_auth_admin', r.tablename);
  END LOOP;

  FOR r IN SELECT sequencename FROM pg_sequences WHERE schemaname = 'auth' LOOP
    EXECUTE format('ALTER SEQUENCE auth.%I OWNER TO supabase_auth_admin', r.sequencename);
  END LOOP;

  FOR r IN SELECT t.typname
           FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
           WHERE n.nspname = 'auth' AND t.typtype = 'e' LOOP
    EXECUTE format('ALTER TYPE auth.%I OWNER TO supabase_auth_admin', r.typname);
  END LOOP;

  -- auth.uid()/role()/jwt()/email() 被 public 的 193 条 RLS policy 引用
  -- （47 处 auth.uid()、15 处 auth.role()、12 处 auth.jwt()），必须保持可执行
  FOR r IN SELECT p.oid::regprocedure AS sig
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'auth' LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO supabase_auth_admin', r.sig);
  END LOOP;
END
$$;

-- -----------------------------------------------------------------------------
-- 2. 丢掉依赖 pg_cron / pg_net 的孤儿函数
--
-- 这两个函数在整个仓库里没有任何调用点、不在任何迁移文件里（是当初在 Supabase
-- SQL Editor 里手搓的），云端 cron.job 也是空表。真正的定时调度走 QStash
-- （backend/core/triggers/scheduling.py）。留着它们只会让目标库被迫依赖两个
-- 官方 postgres 镜像里没有的扩展。
-- -----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.schedule_trigger_http(text, text, text, jsonb, jsonb, integer);
DROP FUNCTION IF EXISTS public.unschedule_job_by_name(text);

-- -----------------------------------------------------------------------------
-- 3. 让 PostgREST 的 authenticator 能切到三个业务角色
--    （initdb 里已 GRANT 过一次，这里兜底，防止 dump 中的 REVOKE 把它收走）
-- -----------------------------------------------------------------------------

GRANT anon, authenticated, service_role TO authenticator;

ANALYZE;
