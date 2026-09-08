from __future__ import annotations
import pytest
from core.billing.payments import sweeper_task


async def test_run_reconcile_once_async(monkeypatch):
    class _Sweeper:
        async def run_once(self, **kw): return {"checked": 1, "settled": 1, "errors": 0}
    monkeypatch.setattr(sweeper_task, "_build_sweeper", lambda: _Sweeper())
    res = await sweeper_task.run_reconcile_once_async()
    assert res == {"checked": 1, "settled": 1, "errors": 0}
