from fastapi import APIRouter, HTTPException, Depends, Request, Query
from typing import Optional, Dict, List, Any
from decimal import Decimal
from datetime import datetime, timezone, timedelta
from pydantic import BaseModel
from core.services.supabase import DBConnection
from core.utils.auth_utils import resolve_user_and_workspace
from core.utils.config import config, EnvMode
from core.utils.logger import logger
from core.utils.cache import Cache
from core.services.cache_service import CacheService
from core.ai_models import model_manager
import secrets
from .config import (
    TOKEN_PRICE_MULTIPLIER, 
    get_tier_by_name,
    is_unlimited_tier,
    TIERS,
    get_daily_login_points
)
from .credit_manager import credit_manager
from . import entitlements
from .provider_policy_service import provider_policy_service
from core.ai_models.provider_policy import provider_display_name, is_sponsored_provider, SPONSORED_PROVIDER_BADGE
 
from fastapi.responses import PlainTextResponse
from .payments.bootstrap import get_order_service
from .payments.routing import route_gateway
from .payments.contract import PaymentGatewayId, PaymentSignatureError

router = APIRouter(prefix="/billing", tags=["billing"])

# Resolve workspace-aware account id (team or personal) from request headers
async def _get_workspace_account_id(request: Request) -> str:
    user_id, workspace_id = await resolve_user_and_workspace(request)
    return workspace_id


async def _ensure_workspace_owner(*, user_id: str, workspace_id: str) -> None:
    if workspace_id == user_id:
        return

    db = DBConnection()
    client = await db.client

    try:
        role_res = await (
            client.schema("basejump")
            .table("account_user")
            .select("account_role")
            .eq("user_id", user_id)
            .eq("account_id", workspace_id)
            .limit(1)
            .execute()
        )
        role = (role_res.data or [{}])[0].get("account_role")
        if role == "owner":
            return

        account_res = await (
            client.schema("basejump")
            .table("accounts")
            .select("primary_owner_user_id")
            .eq("id", workspace_id)
            .limit(1)
            .execute()
        )
        if account_res.data and account_res.data[0].get("primary_owner_user_id") == user_id:
            return
    except Exception as exc:
        logger.warning(f"[billing] workspace owner check failed: {exc}")
        raise HTTPException(status_code=500, detail="Failed to verify workspace role")

    raise HTTPException(status_code=403, detail="Only workspace owners can manage team billing")


async def _get_workspace_owner_account_id(request: Request) -> str:
    user_id, workspace_id = await resolve_user_and_workspace(request)
    await _ensure_workspace_owner(user_id=user_id, workspace_id=workspace_id)
    return workspace_id


class CreateCheckoutSessionRequest(BaseModel):
    price_id: str
    success_url: str
    cancel_url: str
    provider: Optional[str] = None

class CreatePortalSessionRequest(BaseModel):
    return_url: str
    provider: Optional[str] = None
 
class PurchaseCreditsRequest(BaseModel):
    amount: Optional[Decimal] = None
    success_url: str
    cancel_url: str
    provider: Optional[str] = None

class TokenUsageRequest(BaseModel):
    prompt_tokens: int
    completion_tokens: int
    model: str
    thread_id: Optional[str] = None
    message_id: Optional[str] = None

class CancelSubscriptionRequest(BaseModel):
    feedback: Optional[str] = None

class RedeemInviteRequest(BaseModel):
    code: str


class UpdateProviderPolicyRequest(BaseModel):
    enabled_providers: Optional[List[str]] = None
    default_provider: Optional[str] = None
    priority_order: Optional[List[str]] = None
    fallback_mode: Optional[str] = None

USER_INVITE_SLOTS = (1, 2, 3)
USER_INVITE_CODE_LENGTH = 6
USER_INVITE_CAMPAIGN = "user_referral"
USER_INVITE_MAX_RETRIES = 5

def _generate_user_invite_code(length: int = USER_INVITE_CODE_LENGTH) -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(length))

async def _ensure_user_invite_codes(client, account_id: str) -> List[dict]:
    res = await client.from_("invite_codes")\
        .select("id, code, max_redemptions, redeemed_count, active, slot_index, created_at")\
        .eq("owner_account_id", account_id)\
        .execute()

    rows = res.data or []
    by_slot = {
        int(row["slot_index"]): row
        for row in rows
        if row.get("slot_index") is not None
    }
    missing_slots = [slot for slot in USER_INVITE_SLOTS if slot not in by_slot]

    for slot in missing_slots:
        created = False
        for _ in range(USER_INVITE_MAX_RETRIES):
            code = _generate_user_invite_code()
            payload = {
                "code": code,
                "owner_account_id": account_id,
                "slot_index": slot,
                "max_redemptions": 1,
                "active": True,
                "campaign": USER_INVITE_CAMPAIGN,
            }
            try:
                insert = await client.from_("invite_codes").insert(payload).execute()
                saved = insert.data[0] if insert.data else None
                if saved:
                    by_slot[slot] = saved
                    created = True
                    break
            except Exception as e:
                err = str(e).lower()
                if "duplicate" in err or "unique" in err:
                    continue
                logger.error(f"Failed to create user invite code for {account_id}: {e}")
                break
        if not created:
            logger.warning(f"Failed to fill invite slot {slot} for {account_id}")

    return [by_slot[s] for s in sorted(by_slot.keys())]

from .pricing import calculate_token_cost  # re-export: 旧调用方 api.calculate_token_cost 不变



async def calculate_credit_breakdown(account_id: str, client) -> Dict:
    current_balance = await credit_manager.get_cached_balance(account_id)
    current_balance = float(current_balance)
    
    purchase_result = await client.from_('credit_ledger')\
        .select('amount, created_at, description')\
        .eq('account_id', account_id)\
        .eq('type', 'purchase')\
        .execute()
    
    total_purchased = sum(float(row['amount']) for row in purchase_result.data) if purchase_result.data else 0
    
    logger.info(f"🔍 Credit breakdown for user {account_id}:")
    logger.info(f"  Current balance: ${current_balance}")
    logger.info(f"  Total purchased (topups): ${total_purchased}")
    if purchase_result.data:
        for purchase in purchase_result.data:
            logger.info(f"    Purchase: ${purchase['amount']} - {purchase['description']}")
    
    topup_credits = total_purchased
    subscription_credits = max(0, current_balance - topup_credits)
    
    return {
        'total_balance': current_balance,
        'topup_credits': topup_credits,
        'subscription_credits': subscription_credits,
        'total_purchased': total_purchased
    }

@router.post("/check")
async def check_billing_status(
    account_id: str = Depends(_get_workspace_account_id)
) -> Dict:
    if config.ENV_MODE == EnvMode.LOCAL:
        return {'can_run': True, 'message': 'Local mode', 'balance': 999999}
    
    balance = await credit_manager.get_cached_balance(account_id)
    tier = await entitlements.get_user_subscription_tier(account_id)

    if is_unlimited_tier(tier.get('name')):
        return {
            'can_run': True,
            'balance': float(balance),
            'tier': tier['name'],
            'message': 'Unlimited credits'
        }

    return {
        'can_run': balance > 0,
        'balance': float(balance),
        'tier': tier['name'],
        'message': 'Sufficient credits' if balance > 0 else 'Insufficient credits'
    }

@router.get("/check-status")
async def check_status(
    account_id: str = Depends(_get_workspace_account_id)
) -> Dict:
    try:
        if config.ENV_MODE == EnvMode.LOCAL:
            return {
                "can_run": True,
                "message": "Local development mode",
                "subscription": {
                    "price_id": "local_dev",
                    "plan_name": "Local Development"
                },
                "credit_balance": 999999,
                "can_purchase_credits": False
            }
        
        balance = await credit_manager.get_cached_balance(account_id)
        summary = await credit_manager.get_account_summary(account_id)
        tier = await entitlements.get_user_subscription_tier(account_id)
        
        can_run = balance >= Decimal('0.01')
        display_name = tier.get('display_name', tier['name'])

        if is_unlimited_tier(tier.get('name')):
            can_run = True
        
        subscription = {
            "price_id": "credit_based",
            "plan_name": tier['name'],
            "display_name": display_name,
            "tier": tier['name']
        }
        
        return {
            "can_run": can_run,
            "message": "Unlimited credits" if is_unlimited_tier(tier.get('name')) else ("Sufficient credits" if can_run else "Insufficient credits - please add more credits"),
            "subscription": subscription,
            "credit_balance": float(balance),
            "can_purchase_credits": tier.get('can_purchase_credits', False),
            "tier_info": tier,
            "credits_summary": {
                "balance": float(balance),
                "lifetime_granted": summary['lifetime_granted'],
                "lifetime_purchased": summary['lifetime_purchased'],
                "lifetime_used": summary['lifetime_used']
            }
        }
        
    except Exception as e:
        logger.error(f"Error checking billing status: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/claim-daily-login")
async def claim_daily_login_bonus(
    account_id: str = Depends(_get_workspace_account_id)
) -> Dict:
    try:
        if config.ENV_MODE == EnvMode.LOCAL:
            return {
                "granted": False,
                "points": 0,
                "message": "Local development mode"
            }

        db = DBConnection()
        client = await db.client

        tier_info = await entitlements.get_user_subscription_tier(account_id)
        tier_name = tier_info.get('name') if tier_info else 'free'
        points = get_daily_login_points(tier_name)

        if points <= 0:
            return {
                "granted": False,
                "points": 0,
                "message": "No daily bonus for tier"
            }

        now = datetime.now(timezone.utc)
        day_key = now.date().isoformat()
        description = f"Daily login reset {day_key}"

        await credit_manager.ensure_welcome_bonus(account_id)

        amount = Decimal(points) / Decimal('100')
        rpc_result = await client.rpc('refresh_daily_login_credits', {
            'p_account_id': account_id,
            'p_amount': str(amount),
            'p_day_key': day_key,
            'p_description': description,
        }).execute()
        row = rpc_result.data[0] if rpc_result.data else None
        if not row or not row.get('success'):
            raise HTTPException(status_code=500, detail=row.get('error') if row else 'Failed to refresh daily login credits')

        if row.get('duplicate'):
            return {
                "granted": False,
                "points": 0,
                "already_claimed": True
            }

        await Cache.invalidate(f"credit_balance:{account_id}")
        await Cache.invalidate(f"credit_summary:{account_id}")

        return {
            "granted": True,
            "points": points,
            "new_balance": float(row.get('new_balance', 0))
        }

    except Exception as e:
        logger.error(f"Failed to claim daily login bonus for account {account_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to claim daily login bonus")

@router.get("/project-limits")
async def get_project_limits(account_id: str = Depends(_get_workspace_account_id)):
    try:
        async with DBConnection() as db:
            credit_result = await db.client.table('credit_accounts').select('tier').eq('account_id', account_id).execute()
            tier = credit_result.data[0].get('tier', 'none') if credit_result.data else 'none'
            
            projects_result = await db.client.table('projects').select('project_id').eq('account_id', account_id).execute()
            current_count = len(projects_result.data or [])
            
            from .config import get_project_limit, get_tier_by_name
            project_limit = get_project_limit(tier)
            tier_info = get_tier_by_name(tier)
            
            return {
                'tier': tier,
                'tier_display_name': tier_info.display_name if tier_info else 'Free',
                'current_count': current_count,
                'limit': project_limit,
                'can_create': current_count < project_limit,
                'percent_used': round((current_count / project_limit) * 100, 2) if project_limit > 0 else 0
            }
    except Exception as e:
        logger.error(f"Error getting project limits: {e}")
        return {
            'tier': 'none',
            'tier_display_name': 'No Plan',
            'current_count': 0,
            'limit': 3,
            'can_create': True,
            'percent_used': 0
        }

@router.post("/deduct")
async def deduct_token_usage(
    usage: TokenUsageRequest,
    account_id: str = Depends(_get_workspace_account_id)
) -> Dict:
    if config.ENV_MODE == EnvMode.LOCAL:
        return {'success': True, 'cost': 0, 'new_balance': 999999}
    
    cost = calculate_token_cost(usage.prompt_tokens, usage.completion_tokens, usage.model)
    
    if cost <= 0:
        balance = await credit_manager.get_balance(account_id)
        return {'success': True, 'cost': 0, 'new_balance': balance['total']}

    result = await credit_manager.use_credits(
        account_id=account_id,
        amount=cost,
        description=f"Usage: {usage.model} ({usage.prompt_tokens}+{usage.completion_tokens} tokens)",
        thread_id=usage.thread_id,
        message_id=usage.message_id,
        extra_metadata={
            'model': usage.model,
            'prompt_tokens': int(usage.prompt_tokens),
            'completion_tokens': int(usage.completion_tokens),
        },
    )
    
    if not result.get('success'):
        raise HTTPException(status_code=402, detail=result.get('error', 'Insufficient credits'))
    
    return {
        'success': True,
        'cost': float(cost),
        'new_balance': result['new_total'],
        'from_expiring': result['from_expiring'],
        'from_non_expiring': result['from_non_expiring']
    }

@router.get("/balance")
async def get_credit_balance(
    account_id: str = Depends(_get_workspace_account_id)
) -> Dict:
    db = DBConnection()
    client = await db.client
    
    result = await client.from_('credit_accounts').select(
        'balance, expiring_credits, non_expiring_credits, tier, next_credit_grant'
    ).eq('account_id', account_id).execute()
    
    if result.data and len(result.data) > 0:
        account = result.data[0]
        tier_name = account.get('tier', 'none')
        tier_info = get_tier_by_name(tier_name)
        
        return {
            'balance': float(account.get('balance', 0)),
            'expiring_credits': float(account.get('expiring_credits', 0)),
            'non_expiring_credits': float(account.get('non_expiring_credits', 0)),
            'tier': tier_name,
            'tier_display_name': tier_info.display_name if tier_info else 'No Plan',
            'can_purchase_credits': tier_info.can_purchase_credits if tier_info else False,
            'next_credit_grant': account.get('next_credit_grant'),
            'breakdown': {
                'expiring': float(account.get('expiring_credits', 0)),
                'non_expiring': float(account.get('non_expiring_credits', 0)),
                'total': float(account.get('balance', 0))
            }
        }
    
    return {
        'balance': 0.0,
        'expiring_credits': 0.0,
        'non_expiring_credits': 0.0,
        'tier': 'none',
        'tier_display_name': 'No Plan',
        'can_purchase_credits': False,
        'next_credit_grant': None,
        'breakdown': {
            'expiring': 0.0,
            'non_expiring': 0.0,
            'total': 0.0
        }
    }

class CreateOrderRequest(BaseModel):
    currency: str                       # "CNY" | "USD"
    amount: Decimal
    offer_id: Optional[str] = None
    gateway: Optional[str] = None       # 显式覆盖;否则按地区/币种路由
    public_base_url: Optional[str] = None
    flow: str = "redirect"
    return_url: Optional[str] = None


@router.post("/orders/checkout")
async def create_topup_order(
    request: CreateOrderRequest,
    http_request: Request,
    account_id: str = Depends(_get_workspace_owner_account_id),
) -> Dict:
    gateway_id = route_gateway(
        currency_hint=request.currency,
        accept_language=http_request.headers.get("accept-language"),
        explicit=request.gateway,
    )
    base_url = request.public_base_url or config.PAYMENT_PUBLIC_BASE_URL or config.SITE_URL
    try:
        order_id, checkout = await get_order_service().create_order(
            account_id=account_id, gateway_id=gateway_id, currency=request.currency,  # type: ignore[arg-type]
            amount=request.amount, offer_id=request.offer_id, public_base_url=base_url,
            flow=request.flow, return_url=request.return_url,
            notify_base_url=config.PAYMENT_PUBLIC_BASE_URL,
        )
    except Exception as e:
        logger.error(f"[payments] create order failed: {e}", exc_info=True)
        raise HTTPException(status_code=400, detail=str(e))
    return {"order_id": order_id, "gateway": str(gateway_id),
            "checkout_url": checkout.checkout_url, "qr_payload": checkout.qr_payload,
            "gateway_payment_id": checkout.gateway_payment_id}


@router.get("/orders/{order_id}")
async def get_topup_order(
    order_id: str, account_id: str = Depends(_get_workspace_account_id),
) -> Dict:
    order = await get_order_service().store.get(order_id)
    if not order or order.get("account_id") != account_id:
        raise HTTPException(status_code=404, detail="Order not found")
    return {"order_id": order_id, "status": order.get("status"),
            "credit_amount_usd": order.get("credit_amount_usd"),
            "credited_at": order.get("credited_at")}


@router.post("/webhook/stripe")
async def stripe_webhook(request: Request):
    raw = await request.body()
    sig = request.headers.get("stripe-signature")
    svc = get_order_service()
    gateway = svc.resolver.resolve(PaymentGatewayId.STRIPE)
    try:
        notif = await gateway.verify_notification({"raw_body": raw, "signature": sig})
    except PaymentSignatureError:
        raise HTTPException(status_code=400, detail="invalid signature")
    if notif is None:
        return {"received": True}
    try:
        await svc.settle(notif)
    except Exception as e:  # 5xx → Stripe 重试,避免"已付未到账"
        logger.error(f"[payments] stripe settle failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="settle failed")
    return {"received": True}


@router.post("/notify/alipay")
async def alipay_notify(request: Request):
    form = await request.form()
    params = {k: v for k, v in form.items()}
    svc = get_order_service()
    gateway = svc.resolver.resolve(PaymentGatewayId.ALIPAY)
    notif = await gateway.verify_notification(params)
    if notif is None:
        return PlainTextResponse("failure")
    try:
        await svc.settle(notif)
    except Exception as e:  # 非 success → Alipay 重试
        logger.error(f"[payments] alipay settle failed: {e}", exc_info=True)
        return PlainTextResponse("failure")
    return PlainTextResponse("success")


@router.get("/subscription")
async def get_subscription(account_id: str = Depends(_get_workspace_account_id)) -> Dict:
    """纯预付费下的精简订阅视图:统一 'standard' tier + 钱包余额(无 Creem/订阅状态)。
    保留此 GET 端点是为兼容前端 SubscriptionContext 的读取契约(D1 收敛后语义=entitlements+balance)。"""
    tier_info = await entitlements.get_user_subscription_tier(account_id)
    summary = await credit_manager.get_account_summary(account_id)
    try:
        balance = float(summary.get('balance') or 0)
    except (TypeError, ValueError):
        balance = 0.0
    return {
        "status": "active",
        "plan_name": tier_info["name"],
        "display_plan_name": tier_info["display_name"],
        "price_id": "",
        "subscription": None,
        "tier": {"name": tier_info["name"], "credits": 0},
        "credits": {
            "balance": balance,
            "tier_credits": 0,
            "lifetime_granted": float(summary.get('lifetime_granted') or 0),
            "lifetime_purchased": float(summary.get('lifetime_purchased') or 0),
            "lifetime_used": float(summary.get('lifetime_used') or 0),
            "can_purchase_credits": True,
        },
        "has_purchase_qualification": True,
    }


@router.post("/invite/redeem")
async def redeem_invite_code(
    request: RedeemInviteRequest,
    account_id: str = Depends(_get_workspace_account_id)
) -> Dict:
    """
    Redeem a one-time invite code for credit. Enforces:
    - Code must be active and not expired
    - Code not already used by another account (unique per code)
    - Each account can redeem at most once across all codes
    - Only new accounts may redeem (no prior ledger, zero balance, no subscription)
    """
    try:
        code_input = (request.code or "").strip().upper()
        if not code_input or len(code_input) < 6 or len(code_input) > 8:
            raise HTTPException(status_code=400, detail="Invalid invite code")

        db = DBConnection()
        client = await db.client

        # 1) Lookup the code (exact match in uppercase)
        code_res = await client.from_(
            'invite_codes'
        ).select(
            'id, code, reward_amount, expires_at, max_redemptions, redeemed_count, active'
        ).eq('code', code_input).execute()

        if not code_res.data:
            raise HTTPException(status_code=404, detail="Invite code not found")

        code_row = code_res.data[0]
        if not code_row.get('active', False):
            raise HTTPException(status_code=400, detail="Invite code is inactive")

        # Check code-level expiry if set
        expires_at_code = code_row.get('expires_at')
        if expires_at_code:
            try:
                from datetime import datetime, timezone
                code_exp = datetime.fromisoformat(expires_at_code.replace('Z', '+00:00'))
                if datetime.now(timezone.utc) >= code_exp:
                    raise HTTPException(status_code=400, detail="Invite code has expired")
            except ValueError:
                # Ignore parse issues and proceed
                pass

        # Check redemption capacity (best-effort; enforced also by unique index on code_id)
        max_redemptions = int(code_row.get('max_redemptions') or 1)
        redeemed_count = int(code_row.get('redeemed_count') or 0)
        if redeemed_count >= max_redemptions:
            raise HTTPException(status_code=400, detail="Invite code has already been used")

        # 2) Enforce account can redeem only once across all codes
        prior_redemption = await client.from_('invite_redemptions').select('id').eq('account_id', account_id).execute()
        if prior_redemption.data:
            raise HTTPException(status_code=409, detail="This account has already redeemed an invite code")

        # 3) Optional: Enforce new-account only (no prior usage, no balance, no subscription)
        if config.INVITE_ONLY_NEW_ACCOUNTS:
            ledger_check = await client.from_('credit_ledger').select('id', count='exact').eq('account_id', account_id).limit(1).execute()
            has_ledger = (getattr(ledger_check, 'count', None) or 0) > 0

            acct_res = await client.from_('credit_accounts')\
                .select('balance, tier, stripe_subscription_id, provider_subscription_id')\
                .eq('account_id', account_id)\
                .execute()
            balance_zero = True
            tier_ok = True
            no_subscription = True
            if acct_res.data:
                row = acct_res.data[0]
                try:
                    balance_zero = float(row.get('balance', 0) or 0) == 0.0
                except Exception:
                    balance_zero = False
                tier_ok = (row.get('tier') in (None, 'none', 'free'))
                no_subscription = (
                    row.get('stripe_subscription_id') in (None, '') and
                    row.get('provider_subscription_id') in (None, '')
                )

            if has_ledger or (not balance_zero) or (not tier_ok) or (not no_subscription):
                raise HTTPException(status_code=403, detail="Only new accounts are eligible to redeem the invite code")

        # 4) Determine reward and expiry window
        from decimal import Decimal
        from datetime import datetime, timezone, timedelta
        reward = code_row.get('reward_amount')
        if reward is None:
            reward_default = config.INVITE_REWARD_POST_STRIPE_USD if config.CREEM_API_KEY else config.INVITE_REWARD_PRE_STRIPE_USD
            reward = Decimal(str(reward_default))
        else:
            reward = Decimal(str(reward))

        expire_days = int(config.INVITE_CREDIT_EXPIRE_DAYS or 30)
        credit_expires_at = datetime.now(timezone.utc) + timedelta(days=expire_days)

        # 5) Insert redemption first to claim the code (unique constraints prevent races)
        try:
            await client.from_('invite_redemptions').insert({
                'code_id': code_row['id'],
                'account_id': account_id,
                'reward_amount': float(reward),
                'credit_expires_at': credit_expires_at.isoformat()
            }).execute()
        except Exception as e:
            # Likely unique violation on code or account
            logger.error(f"Invite redemption insert failed: {e}")
            raise HTTPException(status_code=400, detail="Invite code already used or account already redeemed")

        # 6) Grant credits (reward only)
        await credit_manager.add_credits(
            account_id=account_id,
            amount=reward,
            is_expiring=True,
            description=f"Invite code {code_input}",
            expires_at=credit_expires_at
        )

        # 7) Best-effort increment redeemed_count for stats (unique index already prevents reuse)
        try:
            await client.from_('invite_codes').update({
                'redeemed_count': redeemed_count + 1
            }).eq('id', code_row['id']).execute()
        except Exception as e:
            logger.debug(f"Redeemed count update failed (non-fatal): {e}")

        # 7.5) Ensure redeemed users get their personal invite codes (best-effort)
        try:
            await _ensure_user_invite_codes(client, account_id)
        except Exception as e:
            logger.error(f"Failed to ensure user invite codes for {account_id}: {e}")

        # 8) Invalidate caches
        await Cache.invalidate(f"credit_balance:{account_id}")
        await Cache.invalidate(f"subscription_tier:{account_id}")
        # Also clear allowed models + available models caches to avoid stale gating
        try:
            await Cache.invalidate(f"allowed_models_for_user:{account_id}")
        except Exception:
            pass
        try:
            from core.services.cache_service import CacheService
            env = getattr(config.ENV_MODE, 'value', str(config.ENV_MODE))
            cache = CacheService()
            await cache.delete(f"available_models:ewo-v1:{account_id}:{env}")
        except Exception as e:
            logger.debug(f"Available models cache purge failed: {e}")

        balance_info = await credit_manager.get_balance(account_id)
        return {
            'success': True,
            'message': f"Invite redeemed. ${float(reward):.2f} credits added (expires in {expire_days} days).",
            'new_balance': balance_info['total'],
            'credit_expires_at': credit_expires_at.isoformat(),
            'invite_access_expires_at': None
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error redeeming invite code: {e}", exc_info=True)
        # 将底层错误透出到 detail，便于前端/日志快速定位
        raise HTTPException(status_code=500, detail=f"Failed to redeem invite code: {str(e)}")


@router.get("/invite/codes")
async def list_user_invite_codes(
    account_id: str = Depends(_get_workspace_account_id)
) -> Dict:
    try:
        db = DBConnection()
        client = await db.client

        redemption = await client.from_('invite_redemptions')\
            .select('id')\
            .eq('account_id', account_id)\
            .limit(1)\
            .execute()
        if not redemption.data:
            return {
                'eligible': False,
                'total': len(USER_INVITE_SLOTS),
                'remaining': 0,
                'codes': [],
            }

        rows = await _ensure_user_invite_codes(client, account_id)
        codes: List[Dict] = []
        remaining_total = 0
        for row in rows:
            max_redemptions = int(row.get('max_redemptions') or 1)
            redeemed_count = int(row.get('redeemed_count') or 0)
            remaining = max(max_redemptions - redeemed_count, 0)
            if row.get('active') is False:
                remaining = 0
            if remaining > 0:
                remaining_total += 1
            codes.append({
                'id': row.get('id'),
                'code': row.get('code'),
                'redeemed_count': redeemed_count,
                'max_redemptions': max_redemptions,
                'status': 'available' if remaining > 0 else 'used',
                'created_at': row.get('created_at'),
            })

        return {
            'eligible': True,
            'total': len(USER_INVITE_SLOTS),
            'remaining': remaining_total,
            'codes': codes,
        }
    except Exception as e:
        logger.error(f"Failed to load user invite codes for {account_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to load invite codes")


@router.get("/transactions")
async def get_my_transactions(
    account_id: str = Depends(_get_workspace_account_id),
    limit: int = Query(50, ge=1, le=100, description="Number of transactions to fetch"),
    offset: int = Query(0, ge=0, description="Offset for pagination"),
    type_filter: Optional[str] = Query(None, description="Filter by transaction type")
) -> Dict:
    try:
        db = DBConnection()
        client = await db.client
        
        query = client.from_('credit_ledger').select('*').eq('account_id', account_id).order('created_at', desc=True)
        
        if type_filter:
            query = query.eq('type', type_filter)

        if offset:
            query = query.range(offset, offset + limit - 1)
        else:
            query = query.limit(limit)
        
        result = await query.execute()

        total_count = None
        try:
            count_query = client.from_('credit_ledger').select('id', count='exact').eq('account_id', account_id)
            if type_filter:
                count_query = count_query.eq('type', type_filter)
            count_result = await count_query.execute()
            total_count = count_result.count
        except Exception as e:
            logger.warning(f"Failed to count transactions for account {account_id}: {e}")

        try:
            balance_info = await credit_manager.get_balance(account_id)
        except Exception as e:
            logger.warning(f"Failed to load balance summary for account {account_id}: {e}")
            balance_info = {
                'total': 0,
                'expiring': 0,
                'non_expiring': 0,
                'tier': 'none'
            }
        
        transactions = []
        for tx in result.data or []:
            transactions.append({
                'id': tx.get('id'),
                'created_at': tx.get('created_at'),
                'amount': float(tx.get('amount', 0)),
                'balance_after': float(tx.get('balance_after', 0)),
                'type': tx.get('type'),
                'description': tx.get('description'),
                'is_expiring': tx.get('is_expiring', False),
                'expires_at': tx.get('expires_at'),
                'metadata': tx.get('metadata', {})
            })
        
        has_more = False
        if total_count is not None:
            has_more = offset + limit < total_count
        else:
            has_more = len(result.data or []) == limit

        return {
            'transactions': transactions,
            'pagination': {
                'total': total_count if total_count is not None else len(transactions) + offset,
                'limit': limit,
                'offset': offset,
                'has_more': has_more
            },
            'current_balance': balance_info
        }
        
    except Exception as e:
        logger.error(f"Failed to get transactions for account {account_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to retrieve transactions")

@router.get("/transactions/summary")
async def get_transactions_summary(
    account_id: str = Depends(_get_workspace_account_id),
    days: int = Query(30, ge=1, le=365, description="Number of days to look back")
) -> Dict:
    try:
        db = DBConnection()
        client = await db.client
        
        since_date = (datetime.utcnow() - timedelta(days=days)).isoformat()
        
        result = await client.from_('credit_ledger').select('*').eq('account_id', account_id).gte('created_at', since_date).execute()
        
        total_added = Decimal('0')
        total_used = Decimal('0')
        total_refunded = Decimal('0')
        total_expired = Decimal('0')
        
        transaction_counts = {}
        
        for tx in result.data or []:
            amount = Decimal(str(tx.get('amount', 0)))
            tx_type = tx.get('type', 'unknown')
            
            transaction_counts[tx_type] = transaction_counts.get(tx_type, 0) + 1
            
            if amount > 0:
                if tx_type == 'refund':
                    total_refunded += amount
                else:
                    total_added += amount
            else:
                if tx_type == 'expired':
                    total_expired += abs(amount)
                else:
                    total_used += abs(amount)
        
        balance_info = await credit_manager.get_balance(account_id)
        
        return {
            'period_days': days,
            'since_date': since_date,
            'current_balance': balance_info,
            'summary': {
                'total_added': float(total_added),
                'total_used': float(total_used),
                'total_refunded': float(total_refunded),
                'total_expired': float(total_expired),
                'net_change': float(total_added - total_used - total_expired)
            },
            'transaction_counts': transaction_counts,
            'total_transactions': len(result.data or [])
        }
        
    except Exception as e:
        logger.error(f"Failed to get transaction summary for account {account_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to retrieve transaction summary")

@router.get("/credit-breakdown")
async def get_credit_breakdown(
    account_id: str = Depends(_get_workspace_account_id)
) -> Dict:
    db = DBConnection()
    client = await db.client
    
    account_result = await client.from_('credit_accounts')\
        .select('balance, expiring_credits, non_expiring_credits, tier, next_credit_grant')\
        .eq('account_id', account_id)\
        .execute()
    
    if not account_result.data:
        return {
            'total_balance': 0,
            'expiring_credits': 0,
            'non_expiring_credits': 0,
            'tier': 'none',
            'next_credit_grant': None,
            'message': 'No credit account found'
        }
    
    account = account_result.data[0]
    total = float(account.get('balance', 0))
    expiring = float(account.get('expiring_credits', 0))
    non_expiring = float(account.get('non_expiring_credits', 0))
    
    purchase_result = await client.from_('credit_ledger')\
        .select('amount, created_at, description')\
        .eq('account_id', account_id)\
        .eq('type', 'purchase')\
        .order('created_at', desc=True)\
        .limit(5)\
        .execute()
    
    recent_purchases = [
        {
            'amount': float(p['amount']),
            'date': p['created_at'],
            'description': p['description']
        }
        for p in purchase_result.data
    ] if purchase_result.data else []
    
    return {
        'total_balance': total,
        'expiring_credits': expiring,
        'non_expiring_credits': non_expiring,
        'tier': account.get('tier', 'none'),
        'next_credit_grant': account.get('next_credit_grant'),
        'recent_purchases': recent_purchases,
        'message': f"Your ${total:.2f} balance includes ${expiring:.2f} expiring (plan) credits and ${non_expiring:.2f} non-expiring (purchased) credits"
    }

@router.get("/usage-history")
async def get_usage_history(
    days: int = 30,
    account_id: str = Depends(_get_workspace_account_id)
) -> Dict:
    try:
        db = DBConnection()
        client = await db.client
        
        start_date = datetime.now(timezone.utc) - timedelta(days=days)
        
        result = await client.from_('credit_ledger').select('created_at, amount, type, description').eq('account_id', account_id).gte('created_at', start_date.isoformat()).order('created_at', desc=True).execute()
        
        daily_usage = {}
        for entry in result.data:
            date_key = entry['created_at'][:10]
            if date_key not in daily_usage:
                daily_usage[date_key] = {'credits': 0, 'debits': 0, 'count': 0}
            
            amount = float(entry['amount'])
            if entry['type'] == 'debit':
                daily_usage[date_key]['debits'] += amount
                daily_usage[date_key]['count'] += 1
            else:
                daily_usage[date_key]['credits'] += amount
        
        return {
            'daily_usage': daily_usage,
            'total_period_usage': sum(day['debits'] for day in daily_usage.values()),
            'total_period_credits': sum(day['credits'] for day in daily_usage.values())
        }
        
    except Exception as e:
        logger.error(f"Error getting usage history: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e)) 


@router.get("/available-models")
async def get_available_models(
    account_id: str = Depends(_get_workspace_account_id)
) -> Dict:
    try:
        import time
        from core.ai_models import model_manager
        from core.services.supabase import DBConnection

        request_start = time.time()
        cache = CacheService()
        env = getattr(config.ENV_MODE, 'value', str(config.ENV_MODE))
        cache_key = f"available_models:ewo-v1:{account_id}:{env}"

        def _build_model_payload(
            model_data: Dict[str, Any],
            allowed_ids: set[str],
            enabled_providers: set[str],
            local_mode: bool,
        ) -> Dict[str, Any]:
            model_id = str(model_data.get("id") or "")
            provider_id = str(model_data.get("provider") or "").strip().lower()
            provider_enabled = provider_id in enabled_providers if provider_id else True
            requires_subscription = (not local_mode) and (model_id not in allowed_ids)
            is_available = (not requires_subscription) and provider_enabled
            sponsored = is_sponsored_provider(provider_id)

            return {
                "id": model_id,
                "model_key": model_id,
                "display_name": model_data["name"],
                # Keep compatibility with legacy frontends while avoiding provider/model flattening.
                "short_name": model_id,
                "provider_id": provider_id,
                "provider_display_name": provider_display_name(provider_id),
                "provider_enabled": provider_enabled,
                "is_sponsored": sponsored,
                "sponsor_badge": SPONSORED_PROVIDER_BADGE if sponsored else None,
                "requires_subscription": requires_subscription,
                "provider_blocked": not provider_enabled,
                "is_available": is_available,
                "input_cost_per_million_tokens": model_data["pricing"]["input_per_million"] if model_data["pricing"] else None,
                "output_cost_per_million_tokens": model_data["pricing"]["output_per_million"] if model_data["pricing"] else None,
                "audio_cost_per_million_tokens": model_data["pricing"]["audio_per_million"] if model_data["pricing"] else None,
                "context_window": model_data["context_window"],
                "capabilities": model_data["capabilities"],
                "recommended": model_data["recommended"],
                "priority": model_data["priority"],
            }

        if config.ENV_MODE == EnvMode.LOCAL:
            logger.debug("Running in local development mode - all models available")
            all_models = model_manager.list_available_models(include_disabled=False)
            policy_bundle = await provider_policy_service.get_policy_bundle(account_id, use_cache=False)
            policy = policy_bundle["policy"]
            enabled_providers = set(policy.get("enabled_providers", []))
            allowed_ids = {str(model.get("id")) for model in all_models if model.get("id")}
            model_info = [
                _build_model_payload(model, allowed_ids=allowed_ids, enabled_providers=enabled_providers, local_mode=True)
                for model in all_models
            ]
            model_info.sort(key=lambda item: (-item["priority"], item["display_name"]))

            result = {
                "models": model_info,
                "providers": policy_bundle["providers"],
                "provider_policy": policy,
                "subscription_tier": "Local Development",
                "total_models": len(model_info),
                "allowed_models_count": len([m for m in model_info if m["is_available"]]),
                "cache_hit": False,
                "response_time_ms": round((time.time() - request_start) * 1000, 2),
            }

            await cache.set(cache_key, result, ttl=3600)
            return result

        db = DBConnection()
        client = await db.client
        account_result = await client.from_('credit_accounts').select('tier').eq('account_id', account_id).execute()

        tier_name = 'none'
        if account_result.data and len(account_result.data) > 0:
            tier_name = account_result.data[0].get('tier', 'none')

        tier = await entitlements.get_user_subscription_tier(account_id)

        all_models = model_manager.list_available_models(tier=None, include_disabled=False)
        logger.debug(f"Found {len(all_models)} total models available")

        # D4:去 tier 模型门控,allowed = 全部启用模型(provider-policy 过滤在下方保留)。
        allowed_models = [m["id"] for m in all_models if m.get("id")]
        allowed_model_ids = set(allowed_models)
        logger.debug(f"User {account_id} allowed models: {allowed_models}")
        logger.debug(f"User tier: {tier['name']}")

        policy_bundle = await provider_policy_service.get_policy_bundle(account_id, client=client)
        policy = policy_bundle["policy"]
        enabled_providers = set(policy.get("enabled_providers", []))

        model_info = [
            _build_model_payload(model, allowed_ids=allowed_model_ids, enabled_providers=enabled_providers, local_mode=False)
            for model in all_models
        ]
        model_info.sort(key=lambda item: (-item["priority"], item["display_name"]))

        result = {
            "models": model_info,
            "providers": policy_bundle["providers"],
            "provider_policy": policy,
            "subscription_tier": tier_name,
            "total_models": len(model_info),
            "allowed_models_count": len([m for m in model_info if m["is_available"]]),
            "cache_hit": False,
            "response_time_ms": round((time.time() - request_start) * 1000, 2),
        }

        await cache.set(cache_key, result, ttl=3600)
        logger.info(f"💾 Available models 缓存已设置 user={account_id}")
        return result
        
    except Exception as e:
        logger.error(f"Error getting available models: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/provider-policy")
async def get_provider_policy(
    account_id: str = Depends(_get_workspace_account_id)
) -> Dict[str, Any]:
    try:
        bundle = await provider_policy_service.get_policy_bundle(account_id)
        bundle["account_id"] = account_id
        return bundle
    except Exception as e:
        logger.error(f"Error getting provider policy for {account_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/provider-policy")
async def update_provider_policy(
    payload: UpdateProviderPolicyRequest,
    request: Request,
    account_id: str = Depends(_get_workspace_owner_account_id),
) -> Dict[str, Any]:
    try:
        user_id, _workspace_id = await resolve_user_and_workspace(request)
        patch = (
            payload.model_dump(exclude_unset=True)
            if hasattr(payload, "model_dump")
            else payload.dict(exclude_unset=True)
        )
        result = await provider_policy_service.update_policy(
            account_id=account_id,
            patch=patch,
            updated_by=user_id,
        )

        # Invalidate cached available models response.
        env = getattr(config.ENV_MODE, 'value', str(config.ENV_MODE))
        cache_key = f"available_models:ewo-v1:{account_id}:{env}"
        cache = CacheService()
        await cache.delete(cache_key)

        result["account_id"] = account_id
        return result
    except Exception as e:
        logger.error(f"Error updating provider policy for {account_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

