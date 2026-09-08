from __future__ import annotations
from pathlib import Path

_SQL = Path(__file__).resolve().parents[1].parent / "supabase" / "migrations" / "20260621090000_payment_orders.sql"


def test_migration_exists_and_defines_table():
    text = _SQL.read_text(encoding="utf-8")
    assert "create table" in text.lower() and "payment_orders" in text
    for col in ["account_id", "gateway", "status", "pay_currency", "pay_amount",
                "credit_amount_usd", "fx_rate_usd_cny", "catalog_id", "catalog_version",
                "price_snapshot", "gateway_payment_id", "trade_no", "gateway_status",
                "notify_payload", "credited_at", "fulfilled_at", "expires_at"]:
        assert col in text, f"missing column {col}"


def test_migration_has_indexes_and_rls():
    text = _SQL.read_text(encoding="utf-8").lower()
    assert "create index" in text
    assert "enable row level security" in text
    assert "has_role_on_account" in text  # 团队计费可读
