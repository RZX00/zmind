#!/usr/bin/env python3
"""
独立的数据库引导脚本
从setup.py中提取的数据库设置功能
"""

import os
import sys
import subprocess
import re
import platform

IS_WINDOWS = platform.system() == "Windows"

class Colors:
    HEADER = "\033[95m"
    BLUE = "\033[94m"
    CYAN = "\033[96m"
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    RED = "\033[91m"
    ENDC = "\033[0m"
    BOLD = "\033[1m"
    UNDERLINE = "\033[4m"

def print_info(message):
    print(f"{Colors.CYAN}ℹ️  {message}{Colors.ENDC}")

def print_success(message):
    print(f"{Colors.GREEN}✅  {message}{Colors.ENDC}")

def print_warning(message):
    print(f"{Colors.YELLOW}⚠️  {message}{Colors.ENDC}")

def print_error(message):
    print(f"{Colors.RED}❌  {message}{Colors.ENDC}")

def parse_env_file(filepath):
    """解析.env文件"""
    env_vars = {}
    if not os.path.exists(filepath):
        return env_vars

    try:
        with open(filepath, "r") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" in line:
                    key, value = line.split("=", 1)
                    key = key.strip()
                    value = value.strip()
                    if value.startswith('"') and value.endswith('"'):
                        value = value[1:-1]
                    elif value.startswith("'") and value.endswith("'"):
                        value = value[1:-1]
                    env_vars[key] = value
    except Exception as e:
        print_warning(f"Could not parse {filepath}: {e}")

    return env_vars

def clear_supabase_cache():
    """清除Supabase CLI缓存"""
    print_info("清除Supabase CLI缓存...")

    # 清除可能的缓存文件
    cache_files = [
        ".setup_progress",
        ".setup_env.json",
        "backend/.git",
        "backend/supabase/.gitignore",
        "backend/supabase/config.toml"
    ]

    for cache_file in cache_files:
        if os.path.exists(cache_file):
            try:
                if os.path.isdir(cache_file):
                    import shutil
                    shutil.rmtree(cache_file)
                else:
                    os.remove(cache_file)
                print_info(f"已删除缓存: {cache_file}")
            except Exception as e:
                print_warning(f"无法删除 {cache_file}: {e}")

def setup_supabase_database():
    """应用数据库迁移。

    历史上这里跑 `npx supabase link` + `npx supabase db push`——那要求登录
    supabase.com 并绑定一个云项目。项目已完全去 Supabase 化，改为调用
    backend/scripts/migrate.py，只依赖一个 Postgres 连接串。

    连接串取自 ZMIND_DATABASE_URL（或 backend/.env 里的同名项）。注意这里要用
    有 DDL 权限的角色（如 postgres 超级用户），不要用应用角色 zmind_app——
    应用角色刻意不具备建 schema 的权限。
    """
    print_info("开始应用数据库迁移...")

    backend_env = parse_env_file(os.path.join("backend", ".env"))
    dsn = os.environ.get("ZMIND_DATABASE_URL") or backend_env.get("ZMIND_DATABASE_URL", "")

    if not dsn:
        print_error("未找到 ZMIND_DATABASE_URL（环境变量或 backend/.env）")
        print_info("形如: postgres://postgres:<password>@<host>:5432/postgres")
        return False

    env = dict(os.environ, ZMIND_DATABASE_URL=dsn)

    try:
        # 先看有什么待办，让使用者对将要发生的变更有数
        subprocess.run(
            [sys.executable, os.path.join("scripts", "migrate.py"), "status"],
            cwd="backend", check=True, env=env,
        )
        subprocess.run(
            [sys.executable, os.path.join("scripts", "migrate.py"), "up"],
            cwd="backend", check=True, env=env,
        )
        print_success("数据库迁移应用成功!")
        return True

    except subprocess.SubprocessError as e:
        print_error(f"应用数据库迁移失败: {e}")
        return False

def create_initial_data():
    """创建初始数据"""
    print_info("创建初始数据...")
    print_info("请在Supabase SQL Editor中执行以下SQL:")

    sql_script = '''
-- 创建默认账户和初始数据
INSERT INTO accounts (id, name, slug, personal_account)
VALUES (
    gen_random_uuid(),
    'Default Account',
    'default',
    true
) ON CONFLICT (slug) DO NOTHING;

-- 创建初始数据
DO $$
DECLARE
    default_account_id UUID;
    current_user_id UUID;
BEGIN
    SELECT id INTO default_account_id FROM accounts WHERE slug = 'default';
    SELECT auth.uid() INTO current_user_id;

    IF current_user_id IS NOT NULL THEN
        INSERT INTO account_user (account_id, user_id, account_role)
        VALUES (default_account_id, current_user_id, 'owner')
        ON CONFLICT (account_id, user_id) DO NOTHING;
    END IF;

    INSERT INTO projects (project_id, account_id, name, description)
    VALUES (
        gen_random_uuid(),
        default_account_id,
        'Default Project',
        'Your first project'
    );

    INSERT INTO threads (thread_id, project_id, name)
    SELECT
        gen_random_uuid(),
        p.project_id,
        'Welcome Thread'
    FROM projects p
    WHERE p.account_id = default_account_id
    LIMIT 1;

    INSERT INTO agents (agent_id, account_id, name, description, config)
    VALUES (
        gen_random_uuid(),
        default_account_id,
        'Default Agent',
        'Your first AI agent',
        '{"model": "gpt-4", "tools": []}'::jsonb
    );
END $$;
'''

    print(f"{Colors.CYAN}{sql_script}{Colors.ENDC}")
    input("执行完SQL后按Enter继续...")

def main():
    """主函数"""
    print(f"{Colors.BLUE}{Colors.BOLD}")
    print("=" * 50)
    print("     Supabase 数据库引导脚本")
    print("=" * 50)
    print(f"{Colors.ENDC}")

    if not os.path.exists("backend/.env"):
        print_error("未找到backend/.env文件")
        print_info("请先运行setup.py或手动创建.env文件")
        sys.exit(1)

    # 步骤1: 清除缓存
    print_info("步骤1: 清除缓存")
    clear_supabase_cache()

    # 步骤2: 设置数据库
    print_info("步骤2: 设置Supabase数据库")
    if not setup_supabase_database():
        sys.exit(1)

    # 步骤3: 创建初始数据
    print_info("步骤3: 创建初始数据")
    create_initial_data()

    print_success("数据库引导完成!")
    print_info("现在可以重启后端服务器了")

if __name__ == "__main__":
    main()