from decimal import Decimal
from typing import Dict, List, Optional
from dataclasses import dataclass
from core.utils.config import config

TRIAL_ENABLED = False
TRIAL_DURATION_DAYS = 7
TRIAL_TIER = "tier_2_20"
TRIAL_CREDITS = Decimal("5.00")

TOKEN_PRICE_MULTIPLIER = Decimal('1.2')
MINIMUM_CREDIT_FOR_RUN = Decimal('0.01')
DEFAULT_TOKEN_COST = Decimal('0.000002')

FREE_TIER_INITIAL_CREDITS = Decimal('1.00')
DAILY_LOGIN_POINTS_CAP = 100
DAILY_LOGIN_POINTS_BY_TIER: Dict[str, int] = {
    'free': 10,
    'tier_2_20': 20,
    'tier_6_50': 50,
    'tier_12_100': 100,
}

def _collect_ids(*values: Optional[str]) -> List[str]:
    return [value for value in values if value]

@dataclass
class Tier:
    name: str
    price_ids: List[str]
    monthly_credits: Decimal
    display_name: str
    can_purchase_credits: bool
    models: List[str]
    project_limit: int

@dataclass
class StorageLimit:
    max_total_bytes: int
    max_file_bytes: int

_MB = 1024 * 1024
_GB = 1024 * _MB

TIERS: Dict[str, Tier] = {
    'none': Tier(
        name='none',
        price_ids=[],
        monthly_credits=Decimal('0.00'),
        display_name='No Plan',
        can_purchase_credits=False,
        models=[],
        project_limit=3
    ),
    'free': Tier(
        name='free',
        price_ids=[],
        monthly_credits=Decimal('0.00'),
        display_name='Free',
        can_purchase_credits=False,
        models=[],
        project_limit=3
    ),
    'tier_2_20': Tier(
        name='tier_2_20',
        price_ids=_collect_ids(
            config.STRIPE_TIER_2_20_ID,
            config.STRIPE_TIER_2_20_YEARLY_ID,
            config.CREEM_TIER_2_20_ID,
            config.CREEM_TIER_2_20_YEARLY_ID,
        ),
        monthly_credits=Decimal('20.00'),
        display_name='Plus',
        can_purchase_credits=True,
        models=['all'],
        project_limit=100
    ),
    'tier_6_50': Tier(
        name='tier_6_50',
        price_ids=_collect_ids(
            config.STRIPE_TIER_6_50_ID,
            config.STRIPE_TIER_6_50_YEARLY_ID,
            config.CREEM_TIER_6_50_ID,
            config.CREEM_TIER_6_50_YEARLY_ID,
        ),
        monthly_credits=Decimal('40.00'),
        display_name='Pro',
        can_purchase_credits=True,
        models=['all'],
        project_limit=500
    ),
    'tier_12_100': Tier(
        name='tier_12_100',
        price_ids=_collect_ids(
            config.STRIPE_TIER_12_100_ID,
            config.STRIPE_TIER_12_100_YEARLY_ID,
            config.CREEM_TIER_12_100_ID,
            config.CREEM_TIER_12_100_YEARLY_ID,
        ),
        monthly_credits=Decimal('100.00'),
        display_name='Team',
        can_purchase_credits=True,
        models=['all'],
        project_limit=1000
    ),
    'tier_25_200': Tier(
        name='tier_25_200',
        price_ids=_collect_ids(
            config.STRIPE_TIER_25_200_ID,
            config.STRIPE_TIER_25_200_YEARLY_ID,
            config.CREEM_TIER_25_200_ID,
            config.CREEM_TIER_25_200_YEARLY_ID,
        ),
        monthly_credits=Decimal('100.00'),
        display_name='MAX',
        can_purchase_credits=False,
        models=['all'],
        project_limit=2500
    ),
    'tier_50_400': Tier(
        name='tier_50_400',
        price_ids=_collect_ids(
            config.STRIPE_TIER_50_400_ID,
            config.STRIPE_TIER_50_400_YEARLY_ID,
            config.CREEM_TIER_50_400_ID,
            config.CREEM_TIER_50_400_YEARLY_ID,
        ),
        monthly_credits=Decimal('400.00'),
        display_name='Enterprise',
        can_purchase_credits=True,
        models=['all'],
        project_limit=5000
    ),
    'tier_125_800': Tier(
        name='tier_125_800',
        price_ids=_collect_ids(
            config.STRIPE_TIER_125_800_ID,
            config.STRIPE_TIER_125_800_YEARLY_ID,
            config.CREEM_TIER_125_800_ID,
            config.CREEM_TIER_125_800_YEARLY_ID,
        ),
        monthly_credits=Decimal('800.00'),
        display_name='Enterprise Plus',
        can_purchase_credits=True,
        models=['all'],
        project_limit=10000
    ),
    'tier_200_1000': Tier(
        name='tier_200_1000',
        price_ids=_collect_ids(
            config.STRIPE_TIER_200_1000_ID,
            config.STRIPE_TIER_200_1000_YEARLY_ID,
            config.CREEM_TIER_200_1000_ID,
            config.CREEM_TIER_200_1000_YEARLY_ID,
        ),
        monthly_credits=Decimal('1000.00'),
        display_name='Ultimate',
        can_purchase_credits=True,
        models=['all'],
        project_limit=25000
    ),
}

UNLIMITED_CREDIT_TIERS = {"tier_25_200"}

def is_unlimited_tier(tier_name: Optional[str]) -> bool:
    return tier_name in UNLIMITED_CREDIT_TIERS

FILE_STORAGE_LIMITS: Dict[str, StorageLimit] = {
    # Free/default
    'none': StorageLimit(max_total_bytes=50 * _MB, max_file_bytes=20 * _MB),
    'free': StorageLimit(max_total_bytes=50 * _MB, max_file_bytes=20 * _MB),
    # Unified prepaid tier (D9 / Plan 2)
    'standard': StorageLimit(max_total_bytes=1 * _GB, max_file_bytes=50 * _MB),
    # Plus
    'tier_2_20': StorageLimit(max_total_bytes=200 * _MB, max_file_bytes=50 * _MB),
    'tier_2_20_yearly': StorageLimit(max_total_bytes=200 * _MB, max_file_bytes=50 * _MB),
    'tier_2_17_yearly_commitment': StorageLimit(max_total_bytes=200 * _MB, max_file_bytes=50 * _MB),
    # Pro and above
    'tier_6_50': StorageLimit(max_total_bytes=1 * _GB, max_file_bytes=50 * _MB),
    'tier_6_50_yearly': StorageLimit(max_total_bytes=1 * _GB, max_file_bytes=50 * _MB),
    'tier_6_42_yearly_commitment': StorageLimit(max_total_bytes=1 * _GB, max_file_bytes=50 * _MB),
    'tier_12_100': StorageLimit(max_total_bytes=1 * _GB, max_file_bytes=50 * _MB),
    'tier_12_100_yearly': StorageLimit(max_total_bytes=1 * _GB, max_file_bytes=50 * _MB),
    'tier_25_200': StorageLimit(max_total_bytes=1 * _GB, max_file_bytes=50 * _MB),
    'tier_25_200_yearly': StorageLimit(max_total_bytes=1 * _GB, max_file_bytes=50 * _MB),
    'tier_25_170_yearly_commitment': StorageLimit(max_total_bytes=1 * _GB, max_file_bytes=50 * _MB),
    'tier_50_400': StorageLimit(max_total_bytes=1 * _GB, max_file_bytes=50 * _MB),
    'tier_50_400_yearly': StorageLimit(max_total_bytes=1 * _GB, max_file_bytes=50 * _MB),
    'tier_125_800': StorageLimit(max_total_bytes=1 * _GB, max_file_bytes=50 * _MB),
    'tier_125_800_yearly': StorageLimit(max_total_bytes=1 * _GB, max_file_bytes=50 * _MB),
    'tier_200_1000': StorageLimit(max_total_bytes=1 * _GB, max_file_bytes=50 * _MB),
    'tier_200_1000_yearly': StorageLimit(max_total_bytes=1 * _GB, max_file_bytes=50 * _MB),
}

CREDIT_PACKAGES = [
    {'amount': Decimal('10.00'), 'stripe_price_id': config.STRIPE_CREDITS_10_PRICE_ID},
    {'amount': Decimal('25.00'), 'stripe_price_id': config.STRIPE_CREDITS_25_PRICE_ID},
    {'amount': Decimal('50.00'), 'stripe_price_id': config.STRIPE_CREDITS_50_PRICE_ID},
    {'amount': Decimal('100.00'), 'stripe_price_id': config.STRIPE_CREDITS_100_PRICE_ID},
    {'amount': Decimal('250.00'), 'stripe_price_id': config.STRIPE_CREDITS_250_PRICE_ID},
    {'amount': Decimal('500.00'), 'stripe_price_id': config.STRIPE_CREDITS_500_PRICE_ID},
]

CREEM_CREDIT_PACKAGES = [
    {'amount': Decimal('10.00'), 'product_id': config.CREEM_CREDITS_10_PRODUCT_ID},
    {'amount': Decimal('25.00'), 'product_id': config.CREEM_CREDITS_25_PRODUCT_ID},
    {'amount': Decimal('50.00'), 'product_id': config.CREEM_CREDITS_50_PRODUCT_ID},
    {'amount': Decimal('100.00'), 'product_id': config.CREEM_CREDITS_100_PRODUCT_ID},
    {'amount': Decimal('250.00'), 'product_id': config.CREEM_CREDITS_250_PRODUCT_ID},
    {'amount': Decimal('500.00'), 'product_id': config.CREEM_CREDITS_500_PRODUCT_ID},
]

CREEM_REFILL_PRODUCTS = [
    {'tier': 'tier_2_20', 'product_id': config.CREEM_REFILL_TIER_2_20_ID},
    {'tier': 'tier_6_50', 'product_id': config.CREEM_REFILL_TIER_6_50_ID},
]

ADMIN_LIMITS = {
    'max_credit_adjustment': Decimal('1000.00'),
    'max_bulk_grant': Decimal('10000.00'),
    'require_super_admin_above': Decimal('500.00'),
}

def get_tier_by_price_id(price_id: str) -> Optional[Tier]:
    for tier in TIERS.values():
        if price_id in tier.price_ids:
            return tier
    return None


def _get_creem_tier_price_ids() -> Dict[str, List[str]]:
    return {
        'tier_2_20': [
            config.CREEM_TIER_2_20_ID,
            config.CREEM_TIER_2_20_YEARLY_ID,
        ],
        'tier_6_50': [
            config.CREEM_TIER_6_50_ID,
            config.CREEM_TIER_6_50_YEARLY_ID,
        ],
        'tier_12_100': [
            config.CREEM_TIER_12_100_ID,
            config.CREEM_TIER_12_100_YEARLY_ID,
        ],
        'tier_25_200': [
            config.CREEM_TIER_25_200_ID,
            config.CREEM_TIER_25_200_YEARLY_ID,
        ],
        'tier_50_400': [
            config.CREEM_TIER_50_400_ID,
            config.CREEM_TIER_50_400_YEARLY_ID,
        ],
        'tier_125_800': [
            config.CREEM_TIER_125_800_ID,
            config.CREEM_TIER_125_800_YEARLY_ID,
        ],
        'tier_200_1000': [
            config.CREEM_TIER_200_1000_ID,
            config.CREEM_TIER_200_1000_YEARLY_ID,
        ],
    }


def get_tier_by_provider_id(provider: str, plan_id: str) -> Optional[Tier]:
    provider_key = provider.lower()
    if provider_key == 'stripe':
        return get_tier_by_price_id(plan_id)
    if provider_key == 'creem':
        creem_ids = _get_creem_tier_price_ids()
        for tier_name, ids in creem_ids.items():
            filtered_ids = [value for value in ids if value]
            if plan_id in filtered_ids:
                return TIERS.get(tier_name)
    return None


def get_credit_product_id(provider: str, amount: Decimal) -> Optional[str]:
    provider_key = provider.lower()
    amount_value = Decimal(str(amount))
    if provider_key == 'stripe':
        for package in CREDIT_PACKAGES:
            if package['amount'] == amount_value:
                return package['stripe_price_id']
        return None
    if provider_key == 'creem':
        for package in CREEM_CREDIT_PACKAGES:
            if package['amount'] == amount_value:
                return package['product_id']
    return None

def get_refill_product_id(provider: str, tier_name: str) -> Optional[str]:
    provider_key = provider.lower()
    if provider_key == 'creem':
        for item in CREEM_REFILL_PRODUCTS:
            if item['tier'] == tier_name and item['product_id']:
                return item['product_id']
    return None

def get_tier_by_name(tier_name: str) -> Optional[Tier]:
    return TIERS.get(tier_name)

def get_monthly_credits(tier_name: str) -> Decimal:
    tier = TIERS.get(tier_name)
    return tier.monthly_credits if tier else TIERS['none'].monthly_credits

def can_purchase_credits(tier_name: str) -> bool:
    tier = TIERS.get(tier_name)
    return tier.can_purchase_credits if tier else False

def is_model_allowed(tier_name: str, model: str) -> bool:
    tier = TIERS.get(tier_name, TIERS['none'])
    if 'all' in tier.models:
        return True
    return model in tier.models

def get_project_limit(tier_name: str) -> int:
    tier = TIERS.get(tier_name)
    return tier.project_limit if tier else 3

def get_daily_login_points(tier_name: Optional[str]) -> int:
    if not tier_name or tier_name in ('none', 'free'):
        return DAILY_LOGIN_POINTS_BY_TIER['free']

    normalized = tier_name.replace('_yearly_commitment', '').replace('_yearly', '')
    if normalized in DAILY_LOGIN_POINTS_BY_TIER:
        return DAILY_LOGIN_POINTS_BY_TIER[normalized]

    if normalized.startswith('tier_2_'):
        return DAILY_LOGIN_POINTS_BY_TIER['tier_2_20']
    if normalized.startswith('tier_6_'):
        return DAILY_LOGIN_POINTS_BY_TIER['tier_6_50']
    if normalized.startswith('tier_12_'):
        return DAILY_LOGIN_POINTS_BY_TIER['tier_12_100']

    return DAILY_LOGIN_POINTS_CAP

def get_storage_limits(tier_name: str) -> StorageLimit:
    return FILE_STORAGE_LIMITS.get(tier_name, FILE_STORAGE_LIMITS['none'])

def is_commitment_price_id(price_id: str) -> bool:
    return False

def get_commitment_duration_months(price_id: str) -> int:
    return 0

def get_price_type(price_id: str) -> str:
    if is_commitment_price_id(price_id):
        return 'yearly_commitment'
    
    yearly_price_ids = [
        config.STRIPE_TIER_2_20_YEARLY_ID,
        config.STRIPE_TIER_6_50_YEARLY_ID,
        config.STRIPE_TIER_12_100_YEARLY_ID,
        config.STRIPE_TIER_25_200_YEARLY_ID,
        config.STRIPE_TIER_50_400_YEARLY_ID,
        config.STRIPE_TIER_125_800_YEARLY_ID,
        config.STRIPE_TIER_200_1000_YEARLY_ID
    ]
    
    if price_id in yearly_price_ids:
        return 'yearly'
    
    return 'monthly' 
