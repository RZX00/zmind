from __future__ import annotations
from pathlib import Path

_SQL = (Path(__file__).resolve().parents[1].parent / "supabase" / "migrations"
        / "20260621120000_drop_subscription_columns.sql")


def test_migration_drops_all_subscription_columns():
    text = _SQL.read_text(encoding="utf-8").lower()
    for col in ["billing_provider", "provider_customer_id", "provider_subscription_id",
                "provider_product_id", "last_processed_transaction_id", "stripe_subscription_id",
                "commitment_type", "commitment_start_date", "commitment_end_date",
                "commitment_price_id", "can_cancel_after"]:
        assert f"drop column if exists {col}" in text, f"missing drop for {col}"


def test_migration_keeps_tier_and_balance():
    text = _SQL.read_text(encoding="utf-8").lower()
    for kept in ["drop column if exists tier", "drop column if exists balance",
                 "drop column if exists expiring_credits", "drop column if exists non_expiring_credits"]:
        assert kept not in text, f"must NOT drop: {kept}"


def test_migration_drops_commitment_history_and_indexes():
    text = _SQL.read_text(encoding="utf-8").lower()
    assert "drop table if exists" in text and "commitment_history" in text
    assert "drop index if exists idx_credit_accounts_billing_provider" in text
    assert "drop index if exists idx_credit_accounts_provider_subscription_id" in text
