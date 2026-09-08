-- =============================================================================
-- 自建 Postgres 的首次初始化：角色 + schema + 扩展
--
-- 由同目录的 00-init.sh 用 psql -v 注入两个密码后执行；只在容器第一次启动
-- （数据目录为空）时跑一次。
--
-- 为什么要照抄 Supabase 的角色模型：从云端 pg_dump 出来的 RLS policy 和 GRANT
-- 直接引用 anon / authenticated / service_role。保留同名角色 = 那 193 条 policy
-- 和全部授权语句一行都不用改，迁移的出错面小一个数量级。
-- =============================================================================

\set ON_ERROR_STOP on

-- -----------------------------------------------------------------------------
-- 1. 角色
-- -----------------------------------------------------------------------------

-- PostgREST 用 authenticator 登录，再按 JWT 的 role claim SET ROLE 切到下面三个。
-- 三个业务角色都是 NOLOGIN：只能被切换过去，不能直接连。
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;

  -- service_role 要 BYPASSRLS：后端拿 service_role key 直连，语义上等同 Supabase 云
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;

  -- 下面两个角色我们不用它们干活，但云端 dump 里引用了，必须存在否则 restore 报错：
  --   dashboard_user      —— 31 条 GRANT ... TO dashboard_user（Supabase 控制台角色）
  --   supabase_admin      —— ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_user') THEN
    CREATE ROLE dashboard_user NOLOGIN NOINHERIT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    CREATE ROLE supabase_admin NOLOGIN NOINHERIT;
  END IF;
END
$$;

-- authenticator / supabase_auth_admin 需要密码，用 psql 变量注入（见 00-init.sh）
CREATE ROLE authenticator LOGIN NOINHERIT PASSWORD :'authenticator_password';

-- GoTrue 用这个身份连库并拥有 auth schema
CREATE ROLE supabase_auth_admin LOGIN NOINHERIT CREATEROLE PASSWORD :'auth_admin_password';

GRANT anon, authenticated, service_role TO authenticator;

-- -----------------------------------------------------------------------------
-- 2. extensions schema
--
-- 云端把 uuid-ossp / pgcrypto 装在 extensions schema 下，dump 里 19 处
-- extensions.gen_random_uuid()、5 处 extensions.uuid_generate_v4()、
-- 1 处 extensions.gen_random_bytes() 是列默认值，必须先存在才能建表。
-- -----------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role, authenticator;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto  SCHEMA extensions;

-- pg_trgm 在云端装在 public（索引用 gin_trgm_ops），位置必须一致
CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public;

-- 让 extensions 里的函数无需限定名也能解析
ALTER DATABASE postgres SET search_path TO "$user", public, extensions;

-- -----------------------------------------------------------------------------
-- 3. 刻意不装的东西
--
-- pg_cron / pg_net：云端装了，但 cron.job 是空表，唯二使用者
-- public.schedule_trigger_http() 和 public.unschedule_job_by_name() 在整个仓库里
-- 没有任何调用点，也不在任何迁移文件里（是当初在 SQL Editor 手搓的孤儿函数）。
-- 真正的定时调度走 QStash（core/triggers/scheduling.py）。装它们只会把目标库
-- 绑死在非官方镜像上，所以 restore 时直接丢掉这两个函数。
--
-- supabase_vault：vault.secrets 是空的，没有任何密钥存在里面。
-- storage schema：文件早已全量迁到 R2，storage.objects 只有 568kB 残留。
-- realtime schema：前端只有 1 个 postgres_changes 订阅，改走自建 canvas-realtime。
-- =============================================================================
