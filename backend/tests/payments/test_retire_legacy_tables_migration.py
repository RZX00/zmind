from __future__ import annotations
from pathlib import Path

_SQL = (Path(__file__).resolve().parents[1].parent / "supabase" / "migrations"
        / "20260621130000_retire_legacy_credit_tables.sql")


def test_drops_v1_tables():
    low = _SQL.read_text(encoding="utf-8").lower()
    assert "drop table if exists credit_balance" in low
    assert "drop table if exists credit_usage" in low


def test_handles_credit_purchases():
    low = _SQL.read_text(encoding="utf-8").lower()
    assert ("drop table if exists credit_purchases" in low
            or "deprecated" in low and "credit_purchases" in low)


def test_keeps_live_tables():
    low = _SQL.read_text(encoding="utf-8").lower()
    for kept in ["drop table if exists credit_accounts",
                 "drop table if exists credit_ledger",
                 "drop table if exists payment_orders"]:
        assert kept not in low, f"must NOT drop live table: {kept}"
