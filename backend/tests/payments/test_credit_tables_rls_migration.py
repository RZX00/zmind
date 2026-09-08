from __future__ import annotations
from pathlib import Path

_SQL = (Path(__file__).resolve().parents[1].parent / "supabase" / "migrations"
        / "20260621133000_fix_credit_tables_team_rls.sql")


def test_uses_has_role_on_account():
    low = _SQL.read_text(encoding="utf-8").lower()
    assert "has_role_on_account(account_id)" in low
    assert low.count("create policy") >= 2  # credit_accounts + credit_ledger 各一条 SELECT


def test_replaces_old_select_policies():
    low = _SQL.read_text(encoding="utf-8").lower()
    assert 'drop policy if exists "users can view own credit account" on credit_accounts' in low
    assert 'drop policy if exists "users can view own ledger" on credit_ledger' in low


def test_does_not_touch_service_role_or_drop_tables():
    low = _SQL.read_text(encoding="utf-8").lower()
    assert "service role manages" not in low
    assert "drop table" not in low
    assert "drop column" not in low
