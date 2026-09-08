from fastapi import APIRouter, HTTPException, Depends
from typing import Optional, List
from decimal import Decimal
from datetime import datetime, timezone, timedelta
from pydantic import BaseModel, Field
from fastapi import HTTPException
from core.auth import require_admin, require_super_admin
from core.billing.credit_manager import credit_manager
from core.billing.payments.settings import get_usd_cny_rate, set_usd_cny_rate
from core.services.supabase import DBConnection
from core.utils.logger import logger

router = APIRouter(prefix="/admin/billing", tags=["admin-billing"])

class CreditAdjustmentRequest(BaseModel):
    account_id: str
    amount: Decimal = Field(..., description="Amount to add (positive) or remove (negative)")
    reason: str
    is_expiring: bool = Field(True, description="Whether credits expire at end of billing cycle")
    notify_user: bool = True

class RefundRequest(BaseModel):
    account_id: str
    amount: Decimal
    reason: str
    is_expiring: bool = Field(False, description="Refunds typically give non-expiring credits")

class UserSearchRequest(BaseModel):
    email: Optional[str] = None
    account_id: Optional[str] = None

class GrantCreditsRequest(BaseModel):
    account_ids: List[str]
    amount: Decimal
    reason: str
    is_expiring: bool = Field(True, description="Whether credits expire at end of billing cycle")
    notify_users: bool = True


# =========================
# Invite Codes Admin APIs
# =========================

class InviteCreateRequest(BaseModel):
    # Create one or many invite codes.
    code: Optional[str] = None
    count: int = 1
    reward_amount: Optional[Decimal] = None  # None -> backend default
    max_redemptions: int = 1
    active: bool = True
    expires_in_days: Optional[int] = 30  # null -> never expires
    campaign: Optional[str] = None

class InviteListResponse(BaseModel):
    id: str
    code: str
    reward_amount: Optional[float]
    max_redemptions: int
    redeemed_count: int
    active: bool
    expires_at: Optional[str]
    campaign: Optional[str]
    created_at: Optional[str]

class InviteRedemptionResponse(BaseModel):
    id: str
    code: str
    account_id: str
    email: Optional[str] = None
    redeemed_at: str
    reward_amount: Optional[float]
    credit_expires_at: Optional[str]
    campaign: Optional[str] = None

@router.post("/credits/adjust")
async def adjust_user_credits(
    request: CreditAdjustmentRequest,
    admin: dict = Depends(require_admin)
):
    if abs(request.amount) > 1000 and admin.get('role') != 'super_admin':
        raise HTTPException(status_code=403, detail="Adjustments over $1000 require super_admin role")
    
    try:
        if request.amount > 0:
            result = await credit_manager.add_credits(
                account_id=request.account_id,
                amount=request.amount,
                is_expiring=request.is_expiring,
                description=f"Admin adjustment: {request.reason}",
                expires_at=datetime.now(timezone.utc) + timedelta(days=30) if request.is_expiring else None
            )
            if result.get('duplicate_prevented'):
                logger.info(f"[ADMIN] Duplicate credit adjustment prevented for {request.account_id}")
                balance_info = await credit_manager.get_balance(request.account_id)
                return {
                    'success': True,
                    'message': 'Credit adjustment already processed (duplicate prevented)',
                    'new_balance': float(balance_info.get('total', 0)),
                    'adjustment_amount': float(request.amount),
                    'is_expiring': request.is_expiring,
                    'duplicate_prevented': True
                }
            else:
                new_balance = result.get('total_balance', 0)
        else:
            result = await credit_manager.use_credits(
                account_id=request.account_id,
                amount=abs(request.amount),
                description=f"Admin deduction: {request.reason}"
            )
            if not result['success']:
                raise HTTPException(status_code=400, detail=result.get('error', 'Insufficient balance'))
            new_balance = result['new_total']
        
        db = DBConnection()
        client = await db.client
        await client.table('admin_audit_log').insert({
            'admin_account_id': admin['user_id'],
            'action': 'credit_adjustment',
            'target_account_id': request.account_id,
            'details': {
                'amount': float(request.amount),
                'reason': request.reason,
                'is_expiring': request.is_expiring,
                'new_balance': float(new_balance)
            }
        }).execute()
        
        logger.info(f"[ADMIN] Admin {admin['user_id']} adjusted credits for {request.account_id} by {request.amount} (expiring: {request.is_expiring})")
        
        return {
            'success': True,
            'new_balance': float(new_balance),
            'adjustment_amount': float(request.amount),
            'is_expiring': request.is_expiring
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to adjust credits: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/credits/grant")
async def grant_credits_to_users(
    request: GrantCreditsRequest,
    admin: dict = Depends(require_admin)
):
    if request.amount > 100 and admin.get('role') != 'super_admin':
        admin = await require_super_admin(admin)
    
    results = []
    for account_id in request.account_ids:
        try:
            result = await credit_manager.add_credits(
                account_id=account_id,
                amount=request.amount,
                is_expiring=request.is_expiring,
                description=f"Admin grant: {request.reason}",
                expires_at=datetime.now(timezone.utc) + timedelta(days=30) if request.is_expiring else None
            )
            if result.get('duplicate_prevented'):
                balance_info = await credit_manager.get_balance(account_id)
                new_balance = balance_info.get('total', 0)
            else:
                new_balance = result.get('total_balance', 0)
            results.append({
                'account_id': account_id,
                'success': True,
                'new_balance': new_balance
            })
        except Exception as e:
            results.append({
                'account_id': account_id,
                'success': False,
                'error': str(e)
            })
    
    successful = sum(1 for r in results if r['success'])
    logger.info(f"[ADMIN] Admin {admin['user_id']} granted {request.amount} credits (expiring: {request.is_expiring}) to {successful}/{len(request.account_ids)} users")
    
    return {
        'results': results,
        'summary': {
            'total_users': len(request.account_ids),
            'successful': successful,
            'failed': len(request.account_ids) - successful
        }
    }

@router.post("/refund")
async def process_refund(
    request: RefundRequest,
    admin: dict = Depends(require_super_admin)
):
    result = await credit_manager.add_credits(
        account_id=request.account_id,
        amount=request.amount,
        is_expiring=request.is_expiring,
        description=f"Refund: {request.reason}",
        type='admin_grant'
    )
    
    if result.get('duplicate_prevented'):
        balance_info = await credit_manager.get_balance(request.account_id)
        new_balance = balance_info.get('total_balance', 0)
    else:
        new_balance = result.get('total_balance', 0)
    
    logger.info(f"[ADMIN] Admin {admin['user_id']} processed refund of {request.amount} for user {request.account_id} (expiring: {request.is_expiring})")
    
    return {
        'success': True,
        'new_balance': float(new_balance),
        'refund_amount': float(request.amount),
        'is_expiring': request.is_expiring
    }


@router.get("/invites", response_model=List[InviteListResponse])
async def list_invite_codes(
    active: Optional[bool] = None,
    campaign: Optional[str] = None,
    admin: dict = Depends(require_admin)
):
    db = DBConnection()
    client = await db.client
    query = client.from_('invite_codes').select('*').order('created_at', desc=True)
    if active is not None:
        query = query.eq('active', active)
    if campaign:
        query = query.eq('campaign', campaign)
    result = await query.execute()
    rows = result.data or []
    # Normalize decimals to float for Pydantic
    def to_float(v):
        try:
            return float(v) if v is not None else None
        except Exception:
            return None
    resp = []
    for r in rows:
        resp.append({
            'id': r.get('id'),
            'code': r.get('code'),
            'reward_amount': to_float(r.get('reward_amount')),
            'max_redemptions': r.get('max_redemptions') or 1,
            'redeemed_count': r.get('redeemed_count') or 0,
            'active': r.get('active') is True,
            'expires_at': r.get('expires_at'),
            'campaign': r.get('campaign'),
            'created_at': r.get('created_at'),
        })
    return resp


@router.get("/invites/redemptions", response_model=List[InviteRedemptionResponse])
async def list_invite_redemptions(
    admin: dict = Depends(require_admin)
):
    db = DBConnection()
    client = await db.client
    # Join redemptions with codes and customer email if available
    red = await client.from_('invite_redemptions').select('*').order('redeemed_at', desc=True).execute()
    rows = red.data or []
    resp: List[InviteRedemptionResponse] = []
    for r in rows:
        # Get code and campaign
        code_row = None
        try:
            cr = await client.from_('invite_codes').select('code, campaign').eq('id', r['code_id']).single().execute()
            code_row = cr.data
        except Exception:
            code_row = None
        # Try get email from basejump.billing_customers
        email = None
        try:
            er = await client.schema('basejump').from_('billing_customers').select('email').eq('account_id', r['account_id']).single().execute()
            email = (er.data or {}).get('email')
        except Exception:
            email = None
        resp.append({
            'id': r.get('id'),
            'code': (code_row or {}).get('code'),
            'campaign': (code_row or {}).get('campaign'),
            'account_id': r.get('account_id'),
            'email': email,
            'redeemed_at': r.get('redeemed_at'),
            'reward_amount': float(r.get('reward_amount')) if r.get('reward_amount') is not None else None,
            'credit_expires_at': r.get('credit_expires_at'),
        })
    return resp


def _generate_code() -> str:
    import random, string
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))


@router.post("/invites")
async def create_invite_codes(
    req: InviteCreateRequest,
    admin: dict = Depends(require_admin)
):
    if req.count < 1 or req.count > 500:
        raise HTTPException(status_code=400, detail="count must be between 1 and 500")
    if req.code and req.count != 1:
        raise HTTPException(status_code=400, detail="When specifying code, count must be 1")

    db = DBConnection()
    client = await db.client
    from datetime import datetime, timezone, timedelta
    expires_at = None
    if req.expires_in_days is not None:
        expires_at = (datetime.now(timezone.utc) + timedelta(days=int(req.expires_in_days))).isoformat()

    payloads = []
    if req.code:
        payloads.append({
            'code': req.code,
            'reward_amount': float(req.reward_amount) if req.reward_amount is not None else None,
            'max_redemptions': req.max_redemptions,
            'active': req.active,
            'expires_at': expires_at,
            'campaign': req.campaign,
        })
    else:
        for _ in range(req.count):
            payloads.append({
                'code': _generate_code(),
                'reward_amount': float(req.reward_amount) if req.reward_amount is not None else None,
                'max_redemptions': req.max_redemptions,
                'active': req.active,
                'expires_at': expires_at,
                'campaign': req.campaign,
            })

    try:
        res = await client.from_('invite_codes').insert(payloads).execute()
        return {
            'success': True,
            'created': len(payloads),
            'codes': [p['code'] for p in payloads]
        }
    except Exception as e:
        logger.error(f"[ADMIN] Failed to create invite codes: {e}")
        raise HTTPException(status_code=500, detail="Failed to create invite codes")

@router.delete("/invites/{invite_id}")
async def delete_invite_code(
    invite_id: str,
    admin: dict = Depends(require_admin)
):
    """
    Delete an invite code by ID
    """
    try:
        db = DBConnection()
        client = await db.client
        
        # First check if invite exists
        check_result = await client.from_('invite_codes').select('id').eq('id', invite_id).execute()
        
        if not check_result.data:
            raise HTTPException(status_code=404, detail="Invite code not found")
        
        # Delete the invite code (cascade will handle redemptions)
        await client.from_('invite_codes').delete().eq('id', invite_id).execute()
        
        return {
            'success': True,
            'message': f"Invite code {invite_id} deleted successfully"
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[ADMIN] Failed to delete invite code {invite_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete invite code")

@router.get("/user/{account_id}/summary")
async def get_user_billing_summary(
    account_id: str,
    admin: dict = Depends(require_admin)
):
    balance_info = await credit_manager.get_balance(account_id)
    db = DBConnection()
    client = await db.client
    
    transactions_result = await client.from_('credit_ledger').select('*').eq('account_id', account_id).order('created_at', desc=True).limit(20).execute()
    
    subscription_result = await client.schema('basejump').from_('billing_subscriptions').select('*').eq('account_id', account_id).order('created', desc=True).limit(1).execute()
    
    subscription = subscription_result.data[0] if subscription_result.data else None
    
    return {
        'account_id': account_id,
        'credit_account': balance_info,
        'subscription': subscription,
        'recent_transactions': transactions_result.data or []
    }

@router.get("/user/{account_id}/transactions")
async def get_user_transactions(
    account_id: str,
    limit: int = 100,
    offset: int = 0,
    type_filter: Optional[str] = None,
    admin: dict = Depends(require_admin)
):
    db = DBConnection()
    client = await db.client
    
    query = client.from_('credit_ledger').select('*').eq('account_id', account_id).order('created_at', desc=True)
    
    if type_filter:
        query = query.eq('type', type_filter)
    
    if offset:
        query = query.range(offset, offset + limit - 1)
    else:
        query = query.limit(limit)
    
    transactions_result = await query.execute()
    
    return {
        'account_id': account_id,
        'transactions': transactions_result.data or [],
        'count': len(transactions_result.data or [])
    }

@router.post("/user/search")
async def search_user(
    request: UserSearchRequest,
    admin: dict = Depends(require_admin)
):
    db = DBConnection()
    client = await db.client
    
    user = None
    
    if request.account_id:
        result = await client.schema('basejump').from_('accounts').select('id, created_at').eq('id', request.account_id).execute()
        if result.data and len(result.data) > 0:
            account = result.data[0]
            email_result = await client.schema('basejump').from_('billing_customers').select('email').eq('account_id', account['id']).execute()
            email = email_result.data[0]['email'] if email_result.data else 'N/A'
            user = {
                'id': account['id'],
                'email': email,
                'created_at': account['created_at']
            }
    elif request.email:
        customer_result = await client.schema('basejump').from_('billing_customers').select('account_id, email').eq('email', request.email).execute()
        if customer_result.data and len(customer_result.data) > 0:
            customer = customer_result.data[0]
            account_result = await client.schema('basejump').from_('accounts').select('created_at').eq('id', customer['account_id']).execute()
            created_at = account_result.data[0]['created_at'] if account_result.data else None
            user = {
                'id': customer['account_id'],
                'email': customer['email'],
                'created_at': created_at
            }
    else:
        raise HTTPException(status_code=400, detail="Provide either account_id or email")
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    balance_info = await credit_manager.get_balance(user['id'])
    
    return {
        'user': user,
        'credit_account': balance_info
    }

@router.post("/migrate-user/{account_id}")
async def migrate_user_to_credits(
    account_id: str,
    admin: dict = Depends(require_super_admin)
):
    db = DBConnection()
    client = await db.client
    
    try:
        result = await client.rpc('migrate_user_to_credits', {'p_account_id': account_id}).execute()
        logger.info(f"[ADMIN] Admin {admin['user_id']} migrated user {account_id} to credit system")
        
        return {
            'success': True,
            'account_id': account_id,
            'message': 'User migrated to credit system'
        }
    except Exception as e:
        logger.error(f"[ADMIN] Migration failed for user {account_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# =========================
# Payment FX rate (admin-editable USD/CNY)
# =========================

class SetFxRateRequest(BaseModel):
    usd_cny_rate: Decimal


@router.get("/fx-rate")
async def admin_get_fx_rate(admin: dict = Depends(require_admin)) -> dict:
    rate = await get_usd_cny_rate(DBConnection())
    return {"usd_cny_rate": float(rate)}


@router.put("/fx-rate")
async def admin_set_fx_rate(request: SetFxRateRequest, admin: dict = Depends(require_admin)) -> dict:
    try:
        rate = await set_usd_cny_rate(DBConnection(), request.usd_cny_rate, updated_by=admin.get("user_id"))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    logger.info(f"[ADMIN] Admin {admin.get('user_id')} set usd_cny_rate to {rate}")
    return {"usd_cny_rate": float(rate)}
