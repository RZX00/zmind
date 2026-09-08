from typing import Dict, Optional
from decimal import Decimal
from datetime import datetime, timezone
from core.services.supabase import DBConnection
from core.application.use_cases.billing.record_usage import RecordUsageUseCase
from core.infrastructure.billing.supabase_billing_repository import SupabaseBillingRepository
from core.utils.logger import logger
from core.utils.cache import Cache
from core.utils.config import config, EnvMode
from .config import FREE_TIER_INITIAL_CREDITS


class CreditManager:
    def __init__(self):
        self.db = DBConnection()

    async def add_credits(
        self,
        account_id: str,
        amount: Decimal,
        is_expiring: bool = True,
        description: str = "Credit added",
        expires_at: Optional[datetime] = None,
        type: Optional[str] = None,
        billing_dedup_key: Optional[str] = None
    ) -> Dict:
        if not billing_dedup_key:
            logger.error(f"[CREDITS] add_credits called without billing_dedup_key for {account_id}")
            return {'success': False, 'error': 'billing_dedup_key required'}

        client = await self.db.client
        amount = Decimal(str(amount))

        rpc_result = await client.rpc('add_credits_idempotent', {
            'p_account_id': account_id,
            'p_amount': str(amount),
            'p_type': type,
            'p_description': description,
            'p_is_expiring': is_expiring,
            'p_expires_at': expires_at.isoformat() if expires_at else None,
            'p_billing_dedup_key': billing_dedup_key
        }).execute()
        row = rpc_result.data[0] if rpc_result.data else {}
        if not row.get('success'):
            return {'success': False, 'error': row.get('error') or 'Failed to add credits'}

        await Cache.invalidate(f"credit_balance:{account_id}")
        await Cache.invalidate(f"credit_summary:{account_id}")

        return {
            'success': True,
            'duplicate_prevented': bool(row.get('duplicate', False)),
            'expiring_credits': float(row.get('expiring_credits') or 0),
            'non_expiring_credits': float(row.get('non_expiring_credits') or 0),
            'total_balance': float(row.get('new_balance') or 0),
            'transaction_id': row.get('transaction_id')
        }

    async def use_credits(
        self,
        account_id: str,
        amount: Decimal,
        description: Optional[str] = None,
        thread_id: Optional[str] = None,
        message_id: Optional[str] = None,
        extra_metadata: Optional[dict] = None,
    ) -> Dict:
        client = await self.db.client
        amount = Decimal(str(amount))

        result = await client.from_('credit_accounts').select(
            'expiring_credits, non_expiring_credits, balance, daily_login_remaining'
        ).eq('account_id', account_id).execute()

        if not result.data:
            return {
                'success': False,
                'error': 'No credit account found',
                'required': float(amount),
                'available': 0,
            }

        current = result.data[0]
        current_expiring = Decimal(str(current.get('expiring_credits', 0)))
        current_non_expiring = Decimal(str(current.get('non_expiring_credits', 0)))
        current_total = Decimal(str(current.get('balance', 0)))
        current_daily_login_remaining = Decimal(str(current.get('daily_login_remaining', 0) or 0))

        if current_total < amount:
            return {
                'success': False,
                'error': 'Insufficient credits',
                'required': float(amount),
                'available': float(current_total),
            }

        if current_expiring >= amount:
            amount_from_expiring = amount
            amount_from_non_expiring = Decimal('0')
        else:
            amount_from_expiring = current_expiring
            amount_from_non_expiring = amount - current_expiring

        new_expiring = current_expiring - amount_from_expiring
        new_non_expiring = current_non_expiring - amount_from_non_expiring
        new_total = new_expiring + new_non_expiring
        from_daily_login = min(current_daily_login_remaining, amount_from_non_expiring)
        new_daily_login_remaining = max(Decimal('0'), current_daily_login_remaining - from_daily_login)

        await client.from_('credit_accounts').update({
            'expiring_credits': float(new_expiring),
            'non_expiring_credits': float(new_non_expiring),
            'balance': float(new_total),
            'daily_login_remaining': float(new_daily_login_remaining),
            'updated_at': datetime.now(timezone.utc).isoformat()
        }).eq('account_id', account_id).execute()

        metadata = {
            'thread_id': thread_id,
            'message_id': message_id,
            'from_expiring': float(amount_from_expiring),
            'from_non_expiring': float(amount_from_non_expiring),
            'from_daily_login': float(from_daily_login),
        }
        if extra_metadata:
            try:
                metadata.update(extra_metadata)
            except Exception:
                pass

        ledger_entry = {
            'amount': float(-amount),
            'balance_after': float(new_total),
            'type': 'usage',
            'description': description,
            'reference_id': thread_id or message_id,
            'metadata': metadata,
        }
        use_case = RecordUsageUseCase(SupabaseBillingRepository(self.db))
        await use_case.execute(
            account_id=account_id,
            ledger_entry=ledger_entry,
            subscription_id=None,
            actor_id=account_id,
        )

        await Cache.invalidate(f"credit_balance:{account_id}")

        return {
            'success': True,
            'amount_deducted': float(amount),
            'from_expiring': float(amount_from_expiring),
            'from_non_expiring': float(amount_from_non_expiring),
            'new_expiring': float(new_expiring),
            'new_non_expiring': float(new_non_expiring),
            'new_total': float(new_total)
        }

    async def reset_expiring_credits(
        self,
        account_id: str,
        new_credits: Decimal,
        description: str = "Monthly credit renewal"
    ) -> Dict:
        # D1 纯预付费:无订阅 → 无月度续费。保留方法签名仅为兼容尚存的
        # Creem/订阅 webhook 调用方(Plan 4 随 Creem 一并删除);此处不写库。
        logger.info(
            f"[RENEWAL] reset_expiring_credits is a no-op under prepaid (D1) for {account_id}; "
            f"requested new_credits={new_credits}, description='{description}'"
        )
        return {
            'success': False,
            'skipped': True,
            'reason': 'prepaid_no_renewal',
            'new_expiring': 0.0,
            'non_expiring': 0.0,
            'total_balance': 0.0,
        }

    async def get_balance(self, account_id: str) -> Dict:
        client = await self.db.client

        result = await client.from_('credit_accounts').select(
            'balance, expiring_credits, non_expiring_credits, tier'
        ).eq('account_id', account_id).execute()

        if result.data:
            data = result.data[0]
            return {
                'total': float(data.get('balance', 0)),
                'expiring': float(data.get('expiring_credits', 0)),
                'non_expiring': float(data.get('non_expiring_credits', 0)),
                'tier': data.get('tier', 'none')
            }

        return {
            'total': 0.0,
            'expiring': 0.0,
            'non_expiring': 0.0,
            'tier': 'none'
        }

    async def ensure_welcome_bonus(self, account_id: str) -> Optional[Decimal]:
        """首充欢迎金:幂等(billing_dedup_key=welcome_bonus:{id}),仅对空账户/未发过的发放。"""
        if config.ENV_MODE == EnvMode.LOCAL:
            return None
        if FREE_TIER_INITIAL_CREDITS <= 0:
            return None

        client = await self.db.client
        result = await client.from_('credit_accounts').select(
            'balance, tier'
        ).eq('account_id', account_id).execute()
        row = result.data[0] if result.data else {}
        balance = Decimal(str(row.get('balance', 0) or 0))
        tier = row.get('tier')

        if balance > 0:
            return None
        if tier not in (None, 'none', 'free'):
            return None

        ledger_check = await client.from_('credit_ledger').select(
            'id'
        ).eq('account_id', account_id).limit(1).execute()
        if ledger_check.data:
            return None

        res = await self.add_credits(
            account_id=account_id,
            amount=FREE_TIER_INITIAL_CREDITS,
            is_expiring=False,
            description='Welcome bonus',
            type='welcome_bonus',
            billing_dedup_key=f"welcome_bonus:{account_id}",
        )
        if res.get('success'):
            total = res.get('total_balance')
            return Decimal(str(total)) if total is not None else FREE_TIER_INITIAL_CREDITS
        return None

    async def get_cached_balance(self, account_id: str, use_cache: bool = True) -> Decimal:
        """缓存读余额 + 首访触发 welcome bonus。替代 core.credits.CreditService.get_balance。"""
        cache_key = f"credit_balance:{account_id}"
        if use_cache:
            cached = await Cache.get(cache_key)
            if cached is not None:
                return Decimal(str(cached))

        starter = await self.ensure_welcome_bonus(account_id)
        if starter is not None:
            await Cache.set(cache_key, str(starter), ttl=300)
            return starter

        balance_info = await self.get_balance(account_id)
        balance = Decimal(str(balance_info.get('total', 0)))
        await Cache.set(cache_key, str(balance), ttl=300)
        return balance

    async def get_account_summary(self, account_id: str) -> Dict:
        """聚合余额 + lifetime 统计(替代 core.credits.CreditService.get_account_summary)。

        形状对齐旧 CreditService.get_account_summary,/check-status 等调用点依赖
        balance / lifetime_granted / lifetime_purchased / lifetime_used 等字段。
        """
        client = await self.db.client
        account_result = await client.from_('credit_accounts').select('*').eq(
            'account_id', account_id
        ).execute()

        if not account_result.data:
            await self.get_balance(account_id)
            return {
                'balance': str(FREE_TIER_INITIAL_CREDITS),
                'tier': 'free',
                'lifetime_granted': float(FREE_TIER_INITIAL_CREDITS),
                'lifetime_purchased': 0.0,
                'lifetime_used': 0.0,
                'last_grant_date': datetime.now(timezone.utc).isoformat(),
            }

        ledger_result = await client.from_('credit_ledger').select(
            'type, amount, description'
        ).eq('account_id', account_id).execute()

        lifetime_granted = Decimal('0')
        lifetime_purchased = Decimal('0')
        lifetime_used = Decimal('0')
        for entry in (ledger_result.data or []):
            amount = Decimal(str(entry['amount']))
            if entry['type'] in ('tier_grant', 'admin_grant', 'tier_upgrade'):
                lifetime_granted += amount
            elif entry['type'] == 'purchase':
                lifetime_purchased += amount
            elif entry['type'] == 'usage':
                lifetime_used += abs(amount)

        account = account_result.data[0]
        return {
            'balance': str(account['balance']),
            'tier': account.get('tier'),
            'lifetime_granted': float(lifetime_granted),
            'lifetime_purchased': float(lifetime_purchased),
            'lifetime_used': float(lifetime_used),
            'last_grant_date': account.get('last_grant_date'),
        }


credit_manager = CreditManager()
