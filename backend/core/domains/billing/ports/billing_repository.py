from __future__ import annotations

from typing import Protocol, Dict, Any, Optional


class BillingRepository(Protocol):
    async def record_usage(
        self,
        *,
        account_id: str,
        ledger_entry: Dict[str, Any],
    ) -> Optional[str]:
        ...
