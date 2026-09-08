from __future__ import annotations

from typing import Optional, Dict, Any

from core.domains.billing.ports.billing_repository import BillingRepository
from core.services.supabase import DBConnection


class SupabaseBillingRepository(BillingRepository):
    def __init__(self, db: Optional[DBConnection] = None) -> None:
        self._db = db or DBConnection()

    async def record_usage(
        self,
        *,
        account_id: str,
        ledger_entry: Dict[str, Any],
    ) -> Optional[str]:
        client = await self._db.client
        payload = dict(ledger_entry)
        payload["account_id"] = account_id
        result = await client.from_("credit_ledger").insert(payload).execute()
        if result.data:
            return str(result.data[0].get("id") or "") or None
        return None
