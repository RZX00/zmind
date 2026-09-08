// Environment mode types
export enum EnvMode {
  LOCAL = 'local',
  STAGING = 'staging',
  PRODUCTION = 'production',
}

// Subscription tier structure
export interface SubscriptionTierData {
  priceId: string;
  name: string;
}

// Subscription tiers structure
export interface SubscriptionTiers {
  TIER_2_20: SubscriptionTierData;
  TIER_6_50: SubscriptionTierData;
  TIER_12_100: SubscriptionTierData;
  TIER_25_200: SubscriptionTierData;
  TIER_50_400: SubscriptionTierData;
  TIER_125_800: SubscriptionTierData;
  TIER_200_1000: SubscriptionTierData;
  // Yearly plans (10 months price)
  TIER_2_20_YEARLY: SubscriptionTierData;
  TIER_6_50_YEARLY: SubscriptionTierData;
  TIER_12_100_YEARLY: SubscriptionTierData;
  TIER_25_200_YEARLY: SubscriptionTierData;
  TIER_50_400_YEARLY: SubscriptionTierData;
  TIER_125_800_YEARLY: SubscriptionTierData;
  TIER_200_1000_YEARLY: SubscriptionTierData;
}

// Configuration object
interface Config {
  ENV_MODE: EnvMode;
  IS_LOCAL: boolean;
  IS_STAGING: boolean;
  SUBSCRIPTION_TIERS: SubscriptionTiers;
  PAYMENTS_ENABLED: boolean;
}

const warnedBillingKeys = new Set<string>();
const warnBillingOnce = (key: string) => {
  if (warnedBillingKeys.has(key)) return;
  warnedBillingKeys.add(key);
  console.warn(`[billing] Missing Creem price ID: ${key}`);
};

const currentEnvMode = (() => {
  const envMode = (process.env.NEXT_PUBLIC_ENV_MODE || 'local').toUpperCase();
  switch (envMode) {
    case 'LOCAL':
      return EnvMode.LOCAL;
    case 'STAGING':
      return EnvMode.STAGING;
    case 'PRODUCTION':
      return EnvMode.PRODUCTION;
    default:
      return EnvMode.LOCAL;
  }
})();

const paymentsEnabled = (process.env.NEXT_PUBLIC_PAYMENTS_ENABLED || '')
  .toLowerCase() === 'true';
const billingProvider = (process.env.NEXT_PUBLIC_BILLING_PROVIDER || '').toLowerCase();

const shouldValidateBilling =
  process.env.NODE_ENV === 'production' &&
  paymentsEnabled &&
  billingProvider === 'creem' &&
  currentEnvMode !== EnvMode.LOCAL;

// Only warn for plans that are currently exposed in the UI by default.
const REQUIRED_CREEM_KEYS = new Set<string>([
  'NEXT_PUBLIC_CREEM_TIER_2_20_ID',
  'NEXT_PUBLIC_CREEM_TIER_2_20_YEARLY_ID',
  'NEXT_PUBLIC_CREEM_TIER_6_50_ID',
  'NEXT_PUBLIC_CREEM_TIER_6_50_YEARLY_ID',
  'NEXT_PUBLIC_CREEM_TIER_25_200_ID',
  'NEXT_PUBLIC_CREEM_TIER_25_200_YEARLY_ID',
]);

const resolveTierId = (key: string, creemId?: string) => {
  const value = creemId?.trim();
  if (shouldValidateBilling && !value && REQUIRED_CREEM_KEYS.has(key)) {
    warnBillingOnce(key);
  }
  return value || '';
};

// Production tier IDs
const PROD_TIERS: SubscriptionTiers = {
  TIER_2_20: {
    priceId: resolveTierId('NEXT_PUBLIC_CREEM_TIER_2_20_ID', process.env.NEXT_PUBLIC_CREEM_TIER_2_20_ID),
    name: '20/mo',
  },
  TIER_6_50: {
    priceId: resolveTierId('NEXT_PUBLIC_CREEM_TIER_6_50_ID', process.env.NEXT_PUBLIC_CREEM_TIER_6_50_ID),
    name: '40/mo',
  },
  TIER_12_100: {
    priceId: resolveTierId('NEXT_PUBLIC_CREEM_TIER_12_100_ID', process.env.NEXT_PUBLIC_CREEM_TIER_12_100_ID),
    name: '12h/$100',
  },
  TIER_25_200: {
    priceId: resolveTierId('NEXT_PUBLIC_CREEM_TIER_25_200_ID', process.env.NEXT_PUBLIC_CREEM_TIER_25_200_ID),
    name: '100/mo',
  },
  TIER_50_400: {
    priceId: resolveTierId('NEXT_PUBLIC_CREEM_TIER_50_400_ID', process.env.NEXT_PUBLIC_CREEM_TIER_50_400_ID),
    name: '50h/$400',
  },
  TIER_125_800: {
    priceId: resolveTierId('NEXT_PUBLIC_CREEM_TIER_125_800_ID', process.env.NEXT_PUBLIC_CREEM_TIER_125_800_ID),
    name: '125h/$800',
  },
  TIER_200_1000: {
    priceId: resolveTierId('NEXT_PUBLIC_CREEM_TIER_200_1000_ID', process.env.NEXT_PUBLIC_CREEM_TIER_200_1000_ID),
    name: '200h/$1000',
  },
  // Legacy yearly plans with 15% discount (12x monthly price with 15% off)
  TIER_2_20_YEARLY: {
    priceId: resolveTierId('NEXT_PUBLIC_CREEM_TIER_2_20_YEARLY_ID', process.env.NEXT_PUBLIC_CREEM_TIER_2_20_YEARLY_ID),
    name: '200/year',
  },
  TIER_6_50_YEARLY: {
    priceId: resolveTierId('NEXT_PUBLIC_CREEM_TIER_6_50_YEARLY_ID', process.env.NEXT_PUBLIC_CREEM_TIER_6_50_YEARLY_ID),
    name: '400/year',
  },
  TIER_12_100_YEARLY: {
    priceId: resolveTierId('NEXT_PUBLIC_CREEM_TIER_12_100_YEARLY_ID', process.env.NEXT_PUBLIC_CREEM_TIER_12_100_YEARLY_ID),
    name: '12h/$1020/year (legacy)',
  },
  TIER_25_200_YEARLY: {
    priceId: resolveTierId('NEXT_PUBLIC_CREEM_TIER_25_200_YEARLY_ID', process.env.NEXT_PUBLIC_CREEM_TIER_25_200_YEARLY_ID),
    name: '1000/year',
  },
  TIER_50_400_YEARLY: {
    priceId: resolveTierId('NEXT_PUBLIC_CREEM_TIER_50_400_YEARLY_ID', process.env.NEXT_PUBLIC_CREEM_TIER_50_400_YEARLY_ID),
    name: '50h/$4080/year (legacy)',
  },
  TIER_125_800_YEARLY: {
    priceId: resolveTierId('NEXT_PUBLIC_CREEM_TIER_125_800_YEARLY_ID', process.env.NEXT_PUBLIC_CREEM_TIER_125_800_YEARLY_ID),
    name: '125h/$8160/year (legacy)',
  },
  TIER_200_1000_YEARLY: {
    priceId: resolveTierId('NEXT_PUBLIC_CREEM_TIER_200_1000_YEARLY_ID', process.env.NEXT_PUBLIC_CREEM_TIER_200_1000_YEARLY_ID),
    name: '200h/$10200/year (legacy)',
  },
} as const;

// Staging tier IDs
const STAGING_TIERS: SubscriptionTiers = {
  TIER_2_20: {
    priceId: resolveTierId('NEXT_PUBLIC_CREEM_TIER_2_20_ID', process.env.NEXT_PUBLIC_CREEM_TIER_2_20_ID),
    name: '20/mo',
  },
  TIER_6_50: {
    priceId: resolveTierId('NEXT_PUBLIC_CREEM_TIER_6_50_ID', process.env.NEXT_PUBLIC_CREEM_TIER_6_50_ID),
    name: '40/mo',
  },
  TIER_12_100: {
    priceId: resolveTierId('NEXT_PUBLIC_CREEM_TIER_12_100_ID', process.env.NEXT_PUBLIC_CREEM_TIER_12_100_ID),
    name: '12h/$100',
  },
  TIER_25_200: {
    priceId: resolveTierId('NEXT_PUBLIC_CREEM_TIER_25_200_ID', process.env.NEXT_PUBLIC_CREEM_TIER_25_200_ID),
    name: '100/mo',
  },
  TIER_50_400: {
    priceId: resolveTierId('NEXT_PUBLIC_CREEM_TIER_50_400_ID', process.env.NEXT_PUBLIC_CREEM_TIER_50_400_ID),
    name: '50h/$400',
  },
  TIER_125_800: {
    priceId: resolveTierId('NEXT_PUBLIC_CREEM_TIER_125_800_ID', process.env.NEXT_PUBLIC_CREEM_TIER_125_800_ID),
    name: '125h/$800',
  },
  TIER_200_1000: {
    priceId: resolveTierId('NEXT_PUBLIC_CREEM_TIER_200_1000_ID', process.env.NEXT_PUBLIC_CREEM_TIER_200_1000_ID),
    name: '200h/$1000',
  },
  // Legacy yearly plans with 15% discount (12x monthly price with 15% off)
  TIER_2_20_YEARLY: {
    priceId: resolveTierId('NEXT_PUBLIC_CREEM_TIER_2_20_YEARLY_ID', process.env.NEXT_PUBLIC_CREEM_TIER_2_20_YEARLY_ID),
    name: '200/year',
  },
  TIER_6_50_YEARLY: {
    priceId: resolveTierId('NEXT_PUBLIC_CREEM_TIER_6_50_YEARLY_ID', process.env.NEXT_PUBLIC_CREEM_TIER_6_50_YEARLY_ID),
    name: '400/year',
  },
  TIER_12_100_YEARLY: {
    priceId: resolveTierId('NEXT_PUBLIC_CREEM_TIER_12_100_YEARLY_ID', process.env.NEXT_PUBLIC_CREEM_TIER_12_100_YEARLY_ID),
    name: '12h/$1020/year (legacy)',
  },
  TIER_25_200_YEARLY: {
    priceId: resolveTierId('NEXT_PUBLIC_CREEM_TIER_25_200_YEARLY_ID', process.env.NEXT_PUBLIC_CREEM_TIER_25_200_YEARLY_ID),
    name: '1000/year',
  },
  TIER_50_400_YEARLY: {
    priceId: resolveTierId('NEXT_PUBLIC_CREEM_TIER_50_400_YEARLY_ID', process.env.NEXT_PUBLIC_CREEM_TIER_50_400_YEARLY_ID),
    name: '50h/$4080/year (legacy)',
  },
  TIER_125_800_YEARLY: {
    priceId: resolveTierId('NEXT_PUBLIC_CREEM_TIER_125_800_YEARLY_ID', process.env.NEXT_PUBLIC_CREEM_TIER_125_800_YEARLY_ID),
    name: '125h/$8160/year (legacy)',
  },
  TIER_200_1000_YEARLY: {
    priceId: resolveTierId('NEXT_PUBLIC_CREEM_TIER_200_1000_YEARLY_ID', process.env.NEXT_PUBLIC_CREEM_TIER_200_1000_YEARLY_ID),
    name: '200h/$10200/year (legacy)',
  },
} as const;

const subscriptionTiersForMode = (mode: EnvMode): SubscriptionTiers => {
  if (mode === EnvMode.STAGING) return STAGING_TIERS;
  if (mode === EnvMode.LOCAL) return STAGING_TIERS;
  return PROD_TIERS;
};

export const config: Config = {
  ENV_MODE: currentEnvMode,
  IS_LOCAL: currentEnvMode === EnvMode.LOCAL,
  IS_STAGING: currentEnvMode === EnvMode.STAGING,
  SUBSCRIPTION_TIERS: subscriptionTiersForMode(currentEnvMode),
  PAYMENTS_ENABLED: paymentsEnabled,
};

export const isLocalMode = (): boolean => {
  return config.IS_LOCAL;
};

export const isStagingMode = (): boolean => {
  return config.IS_STAGING;
};


// Plan type identification functions
export const isMonthlyPlan = (priceId: string): boolean => {
  const allTiers = config.SUBSCRIPTION_TIERS;
  const monthlyTiers = [
    allTiers.TIER_2_20, allTiers.TIER_6_50, allTiers.TIER_12_100,
    allTiers.TIER_25_200, allTiers.TIER_50_400, allTiers.TIER_125_800,
    allTiers.TIER_200_1000
  ];
  return monthlyTiers.some(tier => tier.priceId === priceId);
};

export const isYearlyPlan = (priceId: string): boolean => {
  const allTiers = config.SUBSCRIPTION_TIERS;
  const yearlyTiers = [
    allTiers.TIER_2_20_YEARLY, allTiers.TIER_6_50_YEARLY, allTiers.TIER_12_100_YEARLY,
    allTiers.TIER_25_200_YEARLY, allTiers.TIER_50_400_YEARLY, allTiers.TIER_125_800_YEARLY,
    allTiers.TIER_200_1000_YEARLY
  ];
  return yearlyTiers.some(tier => tier.priceId === priceId);
};

// Tier level mappings for all plan types
const PLAN_TIERS = {
  // Monthly plans
  [PROD_TIERS.TIER_2_20.priceId]: { tier: 1, type: 'monthly', name: '$20/mo' },
  [PROD_TIERS.TIER_6_50.priceId]: { tier: 2, type: 'monthly', name: '$40/mo' },
  [PROD_TIERS.TIER_12_100.priceId]: { tier: 3, type: 'monthly', name: '12h/$100' },
  [PROD_TIERS.TIER_25_200.priceId]: { tier: 4, type: 'monthly', name: '$100/mo' },
  [PROD_TIERS.TIER_50_400.priceId]: { tier: 5, type: 'monthly', name: '50h/$400' },
  [PROD_TIERS.TIER_125_800.priceId]: { tier: 6, type: 'monthly', name: '125h/$800' },
  [PROD_TIERS.TIER_200_1000.priceId]: { tier: 7, type: 'monthly', name: '200h/$1000' },
  
  // Yearly plans  
  [PROD_TIERS.TIER_2_20_YEARLY.priceId]: { tier: 1, type: 'yearly', name: '$200/year' },
  [PROD_TIERS.TIER_6_50_YEARLY.priceId]: { tier: 2, type: 'yearly', name: '$400/year' },
  [PROD_TIERS.TIER_12_100_YEARLY.priceId]: { tier: 3, type: 'yearly', name: '12h/$1020/year' },
  [PROD_TIERS.TIER_25_200_YEARLY.priceId]: { tier: 4, type: 'yearly', name: '$1000/year' },
  [PROD_TIERS.TIER_50_400_YEARLY.priceId]: { tier: 5, type: 'yearly', name: '50h/$4080/year' },
  [PROD_TIERS.TIER_125_800_YEARLY.priceId]: { tier: 6, type: 'yearly', name: '125h/$8160/year' },
  [PROD_TIERS.TIER_200_1000_YEARLY.priceId]: { tier: 7, type: 'yearly', name: '200h/$10200/year' },
  
  // Staging plans
  [STAGING_TIERS.TIER_2_20.priceId]: { tier: 1, type: 'monthly', name: '$20/mo' },
  [STAGING_TIERS.TIER_6_50.priceId]: { tier: 2, type: 'monthly', name: '$40/mo' },
  [STAGING_TIERS.TIER_12_100.priceId]: { tier: 3, type: 'monthly', name: '12h/$100' },
  [STAGING_TIERS.TIER_25_200.priceId]: { tier: 4, type: 'monthly', name: '$100/mo' },
  [STAGING_TIERS.TIER_50_400.priceId]: { tier: 5, type: 'monthly', name: '50h/$400' },
  [STAGING_TIERS.TIER_125_800.priceId]: { tier: 6, type: 'monthly', name: '125h/$800' },
  [STAGING_TIERS.TIER_200_1000.priceId]: { tier: 7, type: 'monthly', name: '200h/$1000' },
  
  [STAGING_TIERS.TIER_2_20_YEARLY.priceId]: { tier: 1, type: 'yearly', name: '$200/year' },
  [STAGING_TIERS.TIER_6_50_YEARLY.priceId]: { tier: 2, type: 'yearly', name: '$400/year' },
  [STAGING_TIERS.TIER_12_100_YEARLY.priceId]: { tier: 3, type: 'yearly', name: '12h/$1020/year' },
  [STAGING_TIERS.TIER_25_200_YEARLY.priceId]: { tier: 4, type: 'yearly', name: '$1000/year' },
  [STAGING_TIERS.TIER_50_400_YEARLY.priceId]: { tier: 5, type: 'yearly', name: '50h/$4080/year' },
  [STAGING_TIERS.TIER_125_800_YEARLY.priceId]: { tier: 6, type: 'yearly', name: '125h/$8160/year' },
  [STAGING_TIERS.TIER_200_1000_YEARLY.priceId]: { tier: 7, type: 'yearly', name: '200h/$10200/year' },
  
} as const;

export const getPlanInfo = (priceId: string) => {
  return PLAN_TIERS[priceId as keyof typeof PLAN_TIERS] || { tier: 0, type: 'unknown', name: 'Unknown' };
};

// Plan change validation function
export const isPlanChangeAllowed = (currentPriceId: string, newPriceId: string): { allowed: boolean; reason?: string } => {
  const currentPlan = getPlanInfo(currentPriceId);
  const newPlan = getPlanInfo(newPriceId);

  // Allow if same plan
  if (currentPriceId === newPriceId) {
    return { allowed: true };
  }

  // Restriction 1: Don't allow downgrade from monthly to lower monthly
  if (currentPlan.type === 'monthly' && newPlan.type === 'monthly' && newPlan.tier < currentPlan.tier) {
    return { 
      allowed: false, 
      reason: 'Downgrading to a lower monthly plan is not allowed. You can only upgrade to a higher tier or switch to yearly billing.' 
    };
  }

  // Allow all other changes (upgrades, yearly to yearly, etc.)
  return { allowed: true };
};

// Export subscription tier type for typing elsewhere
export type SubscriptionTier = keyof typeof PROD_TIERS;
