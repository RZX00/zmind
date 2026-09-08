from __future__ import annotations
from pathlib import Path

_SQL = (Path(__file__).resolve().parents[1].parent / "supabase" / "migrations"
        / "20260621093000_payment_settings.sql")


def test_migration_creates_single_row_table_default_7():
    low = _SQL.read_text(encoding="utf-8").lower()
    assert "create table" in low and "payment_settings" in low
    assert "usd_cny_rate" in low
    assert "default 7" in low                 # 默认汇率 7
    assert "primary key" in low               # 单行守卫(id boolean primary key)
    assert "enable row level security" in low
