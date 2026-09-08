from __future__ import annotations
from pathlib import Path

_DIR = Path(__file__).resolve().parents[1].parent / "supabase" / "migrations"
_SQL = _DIR / "20260621123000_add_credits_idempotent_no_tier.sql"


def test_migration_exists_and_redefines_rpc():
    text = _SQL.read_text(encoding="utf-8")
    low = text.lower()
    assert "create or replace function" in low
    assert "add_credits_idempotent" in text
    for p in ["p_account_id", "p_amount", "p_type", "p_description",
              "p_is_expiring", "p_expires_at", "p_billing_dedup_key"]:
        assert p in text, f"missing param {p}"


def test_insert_no_longer_writes_tier():
    low = _SQL.read_text(encoding="utf-8").lower()
    assert "for update" in low, "row lock must be preserved"
    idx = low.find("insert into credit_accounts (account_id")  # 真实 SQL 语句(非头部注释)
    assert idx != -1
    cols = low[idx: idx + 200]
    assert "tier" not in cols, "INSERT into credit_accounts must NOT set tier"
