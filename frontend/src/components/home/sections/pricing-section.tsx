'use client';

import { SectionHeader } from '@/components/home/section-header';
import type { PricingTier } from '@/lib/home';
import { siteConfig } from '@/lib/home';
import { cn } from '@/lib/utils';
import { motion } from 'motion/react';
import {useTranslations} from 'next-intl';
import React, { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import { 
  CheckIcon, 
  Clock, 
  Bot, 
  FileText, 
  Settings, 
  Grid3X3, 
  Image as ImageIcon, 
  Video, 
  Presentation, 
  Diamond, 
  Heart,
  Zap
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { isLocalMode, isPlanChangeAllowed } from '@/lib/config';
import { config as appConfig } from '@/lib/config';
import { BRAND } from '@/lib/brand';
import { AnimatedBg, type Tone } from '@/components/home/ui/AnimatedBg';
import { useAuth } from '@/components/AuthProvider';

// Constants
export const SUBSCRIPTION_PLANS = {
  FREE: 'free',
  PRO: 'base',
  ENTERPRISE: 'extra',
};

// 充值模型下,定价页仅作静态营销展示;旧 SubscriptionStatus 已删,这里用本地最小形状取代 prop 类型。
type CurrentPlan = {
  price_id?: string;
  plan_name?: string;
  status?: string;
  tier?: { name?: string };
  subscription?: { status?: string } | null;
  has_purchase_qualification?: boolean;
  has_schedule?: boolean;
  scheduled_price_id?: string;
} | null;

// Types
type ButtonVariant =
  | 'default'
  | 'secondary'
  | 'ghost'
  | 'outline'
  | 'link'
  | null;

// Map plan name to an icon path (fallback to our symbol)
function getPlanIcon(planName: string) {
  const plan = (planName || '').toLowerCase();
  if (plan.includes('ultra') || plan.includes('max')) return '/plan-icons/ultra.svg';
  if (plan.includes('pro') || plan.includes('business') || plan.includes('enterprise') || plan.includes('scale') || plan.includes('max')) return '/plan-icons/pro.svg';
  if (plan.includes('plus') || plan.includes('free') || plan.includes('basic')) return '/plan-icons/plus.svg';
  return '/plan-icons/plus.svg';
}

// Styles for the black capsule header shown in screenshot
function getPlanPillStyles(planName: string) {
  const plan = (planName || '').toLowerCase();
  if (plan.includes('ultra') || plan.includes('max')) {
    return {
      iconClass: 'bg-gradient-to-r from-cyan-300 via-sky-300 to-amber-300 bg-clip-text text-transparent',
      textClass: 'bg-gradient-to-r from-cyan-500 via-sky-500 to-amber-500 bg-clip-text text-transparent',
    };
  }
  if (plan.includes('pro')) {
    return {
      iconClass: 'bg-gradient-to-r from-pink-500 to-rose-400 bg-clip-text text-transparent',
      textClass: 'text-gray-900 dark:text-white',
    };
  }
  return {
    iconClass: 'bg-gradient-to-r from-gray-500 to-gray-400 bg-clip-text text-transparent',
    textClass: 'text-gray-900 dark:text-white',
  };
}



interface PriceDisplayProps {
  price: string;
  isCompact?: boolean;
}

interface PricingTierProps {
  tier: PricingTier;
  isCompact?: boolean;
  currentSubscription: CurrentPlan;
  isLoading: Record<string, boolean>;
  isFetchingPlan: boolean;
  selectedPlan?: string;
  onPlanSelect?: (planId: string) => void;
  onSubscriptionUpdate?: () => void;
  isAuthenticated?: boolean;
  returnUrl: string;
  insideDialog?: boolean;
  billingPeriod?: 'monthly' | 'yearly';
  variant?: 'marketing' | 'dashboard';
}

// Feature icon mapping (supports EN & ZH)
const getFeatureIcon = (feature: string) => {
  const f = feature.toLowerCase();
  // English
  if (f.includes('token credits') || f.includes('ai token') || f.includes('credits') || f.includes('points')) return <Clock className="size-4" />;
  if (f.includes('custom agents') || f.includes('agents')) return <Bot className="size-4" />;
  if (f.includes('private projects') || f.includes('public projects')) return <FileText className="size-4" />;
  if (f.includes('custom abilities') || f.includes('basic abilities')) return <Settings className="size-4" />;
  if (f.includes('integrations') || f.includes('100+')) return <Grid3X3 className="size-4" />;
  if (f.includes('premium ai models')) return <Diamond className="size-4" />;
  if (f.includes('community support') || f.includes('priority support')) return <Heart className="size-4" />;
  if (f.includes('dedicated account manager')) return <Zap className="size-4" />;
  if (f.includes('storage') || f.includes('file size')) return <FileText className="size-4" />;
  if (f.includes('image') || f.includes('video') || f.includes('slides') || f.includes('generation')) return <ImageIcon className="size-4" />;

  // Chinese
  const zh = feature; // original case
  if (zh.includes('代币') || zh.includes('额度') || zh.includes('积分')) return <Clock className="size-4" />;
  if (zh.includes('智能体')) return <Bot className="size-4" />;
  if (zh.includes('私有项目') || zh.includes('公开项目')) return <FileText className="size-4" />;
  if (zh.includes('能力') || zh.includes('功能')) return <Settings className="size-4" />;
  if (zh.includes('集成') || zh.includes('100+')) return <Grid3X3 className="size-4" />;
  if (zh.includes('高级 AI 模型')) return <Diamond className="size-4" />;
  if (zh.includes('优先级支持')) return <Heart className="size-4" />;
  if (zh.includes('客户成功经理')) return <Zap className="size-4" />;
  if (zh.includes('存储') || zh.includes('单文件')) return <FileText className="size-4" />;
  if (zh.includes('图片') || zh.includes('视频') || zh.includes('演示')) return <ImageIcon className="size-4" />;

  // Default
  return <CheckIcon className="size-4" />;
};

// Components

function PriceDisplay({ price, isCompact }: PriceDisplayProps) {
  return (
    <motion.span
      key={price}
      className={isCompact ? 'text-xl font-semibold' : 'text-4xl font-semibold'}
      initial={{
        opacity: 0,
        x: 10,
        filter: 'blur(5px)',
      }}
      animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
      transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
    >
      {price}
    </motion.span>
  );
}

function BillingPeriodToggle({
  billingPeriod,
  setBillingPeriod,
  variant = 'marketing',
}: {
  billingPeriod: 'monthly' | 'yearly';
  setBillingPeriod: (period: 'monthly' | 'yearly') => void;
  variant?: 'marketing' | 'dashboard';
}) {
  const t = useTranslations();
  const isDashboard = variant === 'dashboard';
  return (
    <div className="flex items-center justify-center gap-3">
      <div className={cn(
        "relative rounded-full p-1",
        isDashboard ? "bg-card border border-border" : "bg-muted"
      )}>
        <div className="flex">
          <div 
            className={cn("px-3 py-1 rounded-full text-xs font-medium transition-all duration-200 cursor-pointer",
              billingPeriod === 'monthly'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
            onClick={() => setBillingPeriod('monthly')}
          >
            {t('pricing.billing.monthly', {default: 'Monthly'})}
          </div>
          <div 
            className={cn("px-3 py-1 rounded-full text-xs font-medium transition-all duration-200 flex items-center gap-1 cursor-pointer",
              billingPeriod === 'yearly'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
            onClick={() => setBillingPeriod('yearly')}
          >
            {t('pricing.billing.yearly', {default: 'Yearly'})}
            <span className="bg-green-600 text-green-50 dark:bg-green-500 dark:text-green-50 text-[10px] px-1.5 py-0.5 rounded-full font-semibold whitespace-nowrap">
              {t('pricing.billing.discount', {default: '2 months free'})}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function PricingTier({
  tier,
  isCompact = false,
  currentSubscription,
  isLoading,
  isFetchingPlan,
  selectedPlan,
  onPlanSelect,
  onSubscriptionUpdate,
  isAuthenticated = false,
  returnUrl,
  insideDialog = false,
  billingPeriod = 'monthly' as 'monthly' | 'yearly',
  variant = 'marketing',
}: PricingTierProps) {
  const t = useTranslations();
  const isDashboard = variant === 'dashboard';
  const paymentsDisabled = !appConfig.PAYMENTS_ENABLED;
  
  const formatMoney = (value: number) => {
    const rounded = Math.round(value * 100) / 100;
    const formatted = rounded.toFixed(2);
    return formatted.replace(/\.?0+$/, '');
  };
  const parsePriceValue = (price?: string) => {
    if (!price) return 0;
    const parsed = parseFloat(price.replace(/[^\d.]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  };

  // Determine the price to display based on billing period
  const getDisplayPrice = () => {
    if (billingPeriod === 'yearly' && tier.yearlyPrice) {
      // Legacy yearly plans (hidden from UI but still accessible)
      return tier.yearlyPrice;
    }
    return tier.price;
  };

  // Get the price ID to use based on billing period
  const getPriceId = () => {
    if (billingPeriod === 'yearly' && tier.yearlyStripePriceId) {
      // Legacy yearly plans (hidden from UI but still accessible)
      return tier.yearlyStripePriceId;
    }
    return tier.stripePriceId;
  };

  const displayPrice = getDisplayPrice();
  const displayPriceValue = parsePriceValue(displayPrice);
  const isFreePlan = displayPriceValue === 0;
  const priceId = getPriceId();
  const planLower = (tier.name || '').toLowerCase();
  const isAnimatedPlan = ['plus', 'pro', 'ultra', 'max', 'business', 'enterprise'].some((match) => planLower.includes(match));

  const animatedConfig = (() => {
    if (planLower.includes('ultra') || planLower.includes('max')) {
      return {
        blurMultiplier: 0.9,
        sizeMultiplier: 0.75,
        customArcs: {
          left: [
            {
              pos: { left: -140, top: -50 },
              size: 380,
              tone: 'light' as Tone,
              opacity: 0.2,
              delay: 0.05,
              x: [0, 18, -10, 0],
              y: [0, 12, -6, 0],
              scale: [0.9, 1.08, 0.95, 0.9],
              blur: ['12px', '20px', '14px', '12px'],
            },
          ],
          right: [
            {
              pos: { right: -120, top: 160 },
              size: 420,
              tone: 'dark' as Tone,
              opacity: 0.28,
              delay: 1.1,
              x: [0, -18, 12, 0],
              y: [0, 12, -9, 0],
              scale: [0.92, 1.12, 0.98, 0.92],
              blur: ['10px', '6px', '8px', '10px'],
            },
          ],
        },
      };
    }

    if (planLower.includes('pro')) {
      return {
        blurMultiplier: 0.8,
        sizeMultiplier: 0.7,
        customArcs: {
          left: [
            {
              pos: { left: -120, top: -30 },
              size: 350,
              tone: 'light' as Tone,
              opacity: 0.15,
              delay: 0.02,
              x: [0, 12, -6, 0],
              y: [0, 8, -4, 0],
              scale: [0.85, 1.05, 0.95, 0.85],
              blur: ['10px', '15px', '12px', '10px'],
            },
          ],
          right: [
            {
              pos: { right: -110, top: 200 },
              size: 380,
              tone: 'dark' as Tone,
              opacity: 0.2,
              delay: 1.0,
              x: [0, -15, 8, 0],
              y: [0, 10, -6, 0],
              scale: [0.9, 1.1, 0.98, 0.9],
              blur: ['8px', '4px', '6px', '8px'],
            },
          ],
        },
      };
    }

    return {
      blurMultiplier: 0.75,
      sizeMultiplier: 0.68,
      customArcs: {
        left: [
          {
            pos: { left: -110, top: -40 },
            size: 320,
            tone: 'light' as Tone,
            opacity: 0.12,
            delay: 0.06,
            x: [0, 10, -5, 0],
            y: [0, 7, -4, 0],
            scale: [0.88, 1.04, 0.94, 0.88],
            blur: ['14px', '18px', '15px', '14px'],
          },
        ],
        right: [
          {
            pos: { right: -120, top: 140 },
            size: 340,
            tone: 'medium' as Tone,
            opacity: 0.18,
            delay: 1.0,
            x: [0, -12, 6, 0],
            y: [0, 8, -5, 0],
            scale: [0.9, 1.05, 0.96, 0.9],
            blur: ['9px', '6px', '7px', '9px'],
          },
        ],
      },
    };
  })();

  // Localized plan mapping
  const planKey = (() => {
    if (planLower.includes('plus')) return 'plus';
    if (planLower.includes('pro')) return 'pro';
    if (planLower.includes('max') || planLower.includes('ultra')) return 'max';
    if (planLower.includes('business')) return 'business';
    if (planLower.includes('enterprise')) return 'enterprise';
    if (planLower.includes('scale')) return 'scale';
    return 'pro';
  })();
  const localizedTagline = t(`pricing.tiers.${planKey}.tagline`, { default: tier.description });
  const localizedButton = t(`pricing.tiers.${planKey}.button`, { default: tier.buttonText || 'Get started' });
  const localizedFeatures = (() => {
    try {
      const raw = t.raw(`pricing.tiers.${planKey}.features`);
      if (Array.isArray(raw)) return raw as string[];
    } catch {}
    return tier.features || [];
  })();
  const hasPurchaseAccess = currentSubscription?.has_purchase_qualification ?? false;

  // 充值模型:不再创建订阅 checkout,统一引导到充值页 / 鉴权 / 邀请。
  const handleSubscribe = (_planStripePriceId: string) => {
    if (!isAuthenticated) {
      window.location.href = '/auth?mode=signup';
      return;
    }
    if (!hasPurchaseAccess) {
      window.location.href = '/invite';
      return;
    }
    window.location.href = '/subscription';
  };

  // Find the current tier (moved outside conditional for JSX access)
  const currentTier = siteConfig.cloudPricingItems.find(
    (p) => p.stripePriceId === currentSubscription?.price_id || p.yearlyStripePriceId === currentSubscription?.price_id,
  );

  const userPlanName = currentSubscription?.plan_name || 'none';
  const isCurrentActivePlan = isAuthenticated && (
    currentSubscription?.price_id === priceId ||
    (userPlanName === 'tier_2_20' && tier.price === '$20' && billingPeriod === 'monthly') ||
    (currentSubscription?.subscription && 
     userPlanName === 'tier_2_20' && 
     tier.price === '$20' && 
     currentSubscription?.subscription?.status === 'active')
  );

  const isScheduled = isAuthenticated && currentSubscription?.has_schedule;
  const isScheduledTargetPlan =
    isScheduled && currentSubscription?.scheduled_price_id === priceId;
  const isPlanLoading = isLoading[priceId];

  let buttonText = isAuthenticated ? 'Select Plan' : tier.buttonText;
  let buttonDisabled = isPlanLoading;
  let buttonVariant: ButtonVariant = null;
  let ringClass = '';
  let statusBadge = null;
  let buttonClassName = '';
  
  const planChangeValidation = (isAuthenticated && currentSubscription?.price_id) 
    ? isPlanChangeAllowed(currentSubscription.price_id, priceId)
    : { allowed: true };

  if (isAuthenticated) {
    if (isCurrentActivePlan) {
      buttonText = 'Current Plan';
      statusBadge = (
        <span className="bg-primary/10 text-primary text-[10px] font-medium px-1.5 py-0.5 rounded-full">
          Current
        </span>
      );
      buttonDisabled = true;
      buttonVariant = 'secondary';
      ringClass = isCompact ? 'ring-1 ring-primary' : 'ring-2 ring-primary';
      buttonClassName = 'bg-primary/5 hover:bg-primary/10 text-primary';
    } else if (isScheduledTargetPlan) {
      buttonText = 'Scheduled';
      buttonDisabled = true;
      buttonVariant = 'outline';
      ringClass = isCompact
        ? 'ring-1 ring-yellow-500'
        : 'ring-2 ring-yellow-500';
      buttonClassName =
        'bg-yellow-500/5 hover:bg-yellow-500/10 text-yellow-600 border-yellow-500/20';
      statusBadge = (
        <span className="bg-yellow-500/10 text-yellow-600 text-[10px] font-medium px-1.5 py-0.5 rounded-full">
          Scheduled
        </span>
      );
    } else if (isScheduled && currentSubscription?.price_id === priceId) {
      buttonText = 'Change Scheduled';
      buttonVariant = 'secondary';
      ringClass = isCompact ? 'ring-1 ring-primary' : 'ring-2 ring-primary';
      buttonClassName = 'bg-primary/5 hover:bg-primary/10 text-primary';
      statusBadge = (
        <span className="bg-yellow-500/10 text-yellow-600 text-[10px] font-medium px-1.5 py-0.5 rounded-full">
          Downgrade Pending
        </span>
      );
    } else {
      const currentIsMonthly = currentTier && currentSubscription?.price_id === currentTier.stripePriceId;
      const currentIsYearly = currentTier && currentSubscription?.price_id === currentTier.yearlyStripePriceId;
      const targetIsMonthly = priceId === tier.stripePriceId;
      const targetIsYearly = priceId === tier.yearlyStripePriceId;
      const currentPriceString = currentSubscription
        ? (currentIsYearly ? currentTier?.yearlyPrice : currentTier?.price) || '$0'
        : '$0';
      const selectedPriceString = displayPrice;
      const currentAmount = currentPriceString === '$0' ? 0 : parsePriceValue(currentPriceString) * 100;
      const targetAmount = selectedPriceString === '$0' ? 0 : parsePriceValue(selectedPriceString) * 100;
      const isSameTierUpgradeToLongerTerm =
        currentTier &&
        currentTier.name === tier.name &&
        currentIsMonthly &&
        targetIsYearly;
      const isSameTierDowngradeToShorterTerm =
        currentTier &&
        currentTier.name === tier.name &&
        currentIsYearly &&
        targetIsMonthly;

      // Use the plan change validation already computed above

      if (
        currentAmount === 0 &&
        targetAmount === 0 &&
        currentSubscription?.status !== 'no_subscription'
      ) {
        buttonText = 'Select Plan';
        buttonDisabled = true;
        buttonVariant = 'secondary';
        buttonClassName = 'bg-primary/5 hover:bg-primary/10 text-primary';
      } else if (!planChangeValidation.allowed) {
        // Plan change not allowed due to business rules
        buttonText = 'Not Available';
        buttonDisabled = true;
        buttonVariant = 'secondary';
        buttonClassName = 'opacity-50 cursor-not-allowed bg-muted text-muted-foreground';
      } else {
        if (targetAmount > currentAmount || isSameTierUpgradeToLongerTerm) {
          // Allow upgrade to higher tier OR upgrade to longer term on same tier
          buttonText = 'Upgrade';
          buttonVariant = tier.buttonColor as ButtonVariant;
          buttonClassName = 'bg-primary hover:bg-primary/90 text-primary-foreground';
        } else if (targetAmount < currentAmount || isSameTierDowngradeToShorterTerm) {
          // Prevent downgrades and downgrades to shorter terms
          buttonText = 'Not Available';
          buttonDisabled = true;
          buttonVariant = 'secondary';
          buttonClassName = 'opacity-50 cursor-not-allowed bg-muted text-muted-foreground';
        } else {
          buttonText = 'Select Plan';
          buttonVariant = tier.buttonColor as ButtonVariant;
          buttonClassName = 'bg-primary hover:bg-primary/90 text-primary-foreground';
        }
      }
    }

    if (isPlanLoading) {
      buttonText = 'Loading...';
      buttonClassName = 'opacity-70 cursor-not-allowed';
    }
  } else {
    // Non-authenticated state styling
    buttonVariant = tier.buttonColor as ButtonVariant;
    buttonClassName =
      tier.buttonColor === 'default'
        ? 'bg-primary hover:bg-primary/90 text-white'
        : 'bg-brand-600 hover:bg-brand-700 text-white';
  }

  return (
    <>
      <div
        className={cn(
          'rounded-2xl flex flex-col relative transition-all duration-300 ease-out',
          insideDialog
            ? 'min-h-[300px]'
            : 'h-full min-h-[300px] hover:-translate-y-0.5',
          isDashboard
            ? 'bg-card/90 border border-border/60 shadow-[0_1px_0_rgba(255,255,255,0.6)] backdrop-blur-sm hover:shadow-[0_18px_50px_-35px_rgba(0,0,0,0.35)]'
            : tier.isPopular && !insideDialog
              ? 'md:shadow-[0px_61px_24px_-10px_rgba(0,0,0,0.01),0px_34px_20px_-8px_rgba(0,0,0,0.05),0px_15px_15px_-6px_rgba(0,0,0,0.09),0px_4px_8px_-2px_rgba(0,0,0,0.10),0px_0px_0px_1px_rgba(0,0,0,0.08)] bg-accent'
              : 'bg-[#F3F4F6] dark:bg-[#F9FAFB]/[0.02] border border-border',
          !insideDialog && !isDashboard && ringClass,
          !insideDialog && isDashboard && tier.isPopular && 'ring-1 ring-primary/20',
        )}
      >
        {isAnimatedPlan && !isDashboard && (
          <AnimatedBg
            variant="header"
            blurMultiplier={animatedConfig.blurMultiplier}
            sizeMultiplier={animatedConfig.sizeMultiplier}
            customArcs={animatedConfig.customArcs}
          />
        )}
        <div className={cn(
          "flex flex-col gap-3 relative z-10",
          insideDialog ? "p-3" : "p-4"
        )}>
          <div className="flex items-center gap-2">
            {/* Black capsule with icon + label inside */}
            {(() => {
              const pill = getPlanPillStyles(tier.name);
              return (
                <div className="rounded-full px-3 py-1.5 inline-flex items-center gap-2 w-fit border border-border/50 bg-background/80 text-foreground backdrop-blur-sm">
                  <span className="relative inline-flex h-4 w-4 items-center justify-center">
                    {/* Light theme logo */}
                    <Image
                      src="/zmind-symbol-light.svg"
                      alt="Zmind"
                      width={16}
                      height={16}
                      className="h-4 w-4 dark:hidden"
                    />
                    {/* Dark theme logo */}
                    <Image
                      src="/zmind-symbol.svg"
                      alt="Zmind"
                      width={16}
                      height={16}
                      className="h-4 w-4 hidden dark:inline"
                    />
                  </span>
                  <span className={cn("text-sm font-medium leading-none", pill.textClass)}>{tier.name}</span>
                </div>
              );
            })()}

            {/* Right-side badges (Popular / status) */}
            <div className="flex items-center gap-2">
              {tier.isPopular && (
                <span className="inline-flex items-center rounded-full border border-border/50 bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground">
                  Popular
                </span>
              )}
              {isAuthenticated && statusBadge}
            </div>
          </div>
          <div className="flex items-baseline mt-2 min-h-[80px]">
            {billingPeriod === 'yearly' && tier.yearlyPrice && !isFreePlan ? (
              <div className="flex flex-col">
                <div className="flex items-baseline gap-2">
                  <PriceDisplay
                    price={`$${formatMoney(parsePriceValue(tier.yearlyPrice) / 12)}`}
                    isCompact={insideDialog}
                  />
                  {tier.discountPercentage && tier.originalYearlyPrice && (
                    <span className="text-xs line-through text-muted-foreground">
                      ${formatMoney(parsePriceValue(tier.originalYearlyPrice) / 12)}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-muted-foreground">
                    {t('pricing.perMonth', { default: '/month' })}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t('pricing.billedYearly', { default: 'billed yearly' })}
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex items-baseline">
                <PriceDisplay price={displayPrice} isCompact={insideDialog} />
                {!isFreePlan && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    {t('pricing.perMonth', { default: '/month' })}
                  </span>
                )}
              </div>
            )}
          </div>
          <p className="hidden text-sm mt-2">{localizedTagline}</p>

          {billingPeriod === 'yearly' && tier.yearlyPrice && tier.discountPercentage && tier.originalYearlyPrice ? (
            <div className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold bg-green-50 border-green-200 text-green-700 w-fit">
              {t('pricing.savePerYear', {
                amount: `$${formatMoney(parsePriceValue(tier.originalYearlyPrice) - parsePriceValue(tier.yearlyPrice))}`,
                default: 'Save {amount} per year',
              })}
            </div>
          ) : (
            <div className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold w-fit opacity-0 pointer-events-none select-none" aria-hidden="true">
              placeholder
            </div>
          )}
        </div>

        <div className={cn(
          "flex-grow",
          insideDialog ? "px-3 pb-2" : "px-4 pb-3"
        )}>
          {localizedFeatures && localizedFeatures.length > 0 && (
            <ul className="space-y-3">
              {localizedFeatures.map((feature) => (
                <li key={feature} className="flex items-center gap-3">
                  <div className="size-5 min-w-5 flex items-center justify-center text-muted-foreground">
                    {getFeatureIcon(feature)}
                  </div>
                  <span className="text-sm">{feature}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className={cn(
          "mt-auto",
          insideDialog ? "px-3 pt-1 pb-3" : "px-4 pt-2 pb-4"
        )}>
          <Button
            onClick={() => {
              if (paymentsDisabled) {
                return;
              }
              handleSubscribe(priceId);
            }}
            disabled={buttonDisabled || paymentsDisabled}
            variant={buttonVariant || 'default'}
            className={cn(
              'w-full font-medium transition-all duration-200',
              isCompact || insideDialog ? 'h-8 text-xs' : 'h-10 rounded-full text-sm',
              buttonClassName,
              isPlanLoading && 'animate-pulse',
            )}
            title={!planChangeValidation.allowed ? planChangeValidation.reason : undefined}
          >
            {paymentsDisabled && !isCurrentActivePlan
              ? t('pricing.paymentsDisabled', {default: 'Coming soon'})
              : (localizedButton || buttonText)}
          </Button>
        </div>
      </div>
    </>
  );
}

interface PricingSectionProps {
  returnUrl?: string;
  showTitleAndTabs?: boolean;
  hideFree?: boolean;
  insideDialog?: boolean;
  showInfo?: boolean;
  noPadding?: boolean;
  onSubscriptionUpdate?: () => void;
  variant?: 'marketing' | 'dashboard';
}

export function PricingSection({
  returnUrl = typeof window !== 'undefined' ? window.location.href : '/',
  showTitleAndTabs = true,
  hideFree = false,
  insideDialog = false,
  showInfo = true,
  noPadding = false,
  onSubscriptionUpdate,
  variant = 'marketing',
}: PricingSectionProps) {
  const { user } = useAuth();
  const t = useTranslations();
  const isUserAuthenticated = !!user;
  const isDashboard = variant === 'dashboard';

  // 充值模型:不再拉订阅状态;定价页作为静态营销展示。
  const currentSubscription: CurrentPlan = null;
  const isAuthenticated = isUserAuthenticated;
  const isFetchingPlan = false;

  const getDefaultBillingPeriod = useCallback((): 'monthly' | 'yearly' => {
    if (!isAuthenticated || !currentSubscription) {
      return 'yearly';
    }

    const currentTier = siteConfig.cloudPricingItems.find(
      (p) => p.stripePriceId === currentSubscription.price_id || 
             p.yearlyStripePriceId === currentSubscription.price_id,
    );

    if (currentTier) {
      if (currentTier.yearlyStripePriceId === currentSubscription.price_id) {
        return 'yearly';
      } else if (currentTier.stripePriceId === currentSubscription.price_id) {
        return 'monthly';
      }
    }

    return 'yearly';
  }, [isAuthenticated, currentSubscription]);

  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'yearly'>(getDefaultBillingPeriod());
  const [planLoadingStates, setPlanLoadingStates] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setBillingPeriod(getDefaultBillingPeriod());
  }, [getDefaultBillingPeriod]);

  const handlePlanSelect = (planId: string) => {
    setPlanLoadingStates((prev) => ({ ...prev, [planId]: true }));
  };

  const handleSubscriptionUpdate = () => {
    setTimeout(() => {
      setPlanLoadingStates({});
    }, 1000);
    // Call parent's update handler if provided
    if (onSubscriptionUpdate) {
      onSubscriptionUpdate();
    }
  };



  if (isLocalMode()) {
    return (
      <div className="p-4 bg-muted/30 border border-border rounded-lg text-center">
        <p className="text-sm text-muted-foreground">
          Running in local development mode - billing features are disabled
        </p>
      </div>
    );
  }

  return (
    <section
      id="pricing"
      className={cn("flex flex-col items-center justify-center gap-10 w-full relative", noPadding ? "pb-0" : "pb-12")}
    >
      <div className={cn(
        "w-full",
        isDashboard ? "px-0" : "max-w-6xl mx-auto px-6"
      )}>
        {/* Payments disabled banner removed per product decision */}
        {showTitleAndTabs && (
          <SectionHeader>
            <h2 className="text-3xl md:text-4xl font-medium tracking-tighter text-center text-balance">
              {t('pricing.title', {default: 'Choose the right plan for your needs'})}
            </h2>
            <p className="text-muted-foreground text-center text-balance font-medium">
              {t('pricing.subtitle', {default: 'Start with our free plan or upgrade for more credits'})}
            </p>
          </SectionHeader>
        )}

        <div className="flex justify-center mb-8">
          <BillingPeriodToggle
            billingPeriod={billingPeriod}
            setBillingPeriod={setBillingPeriod}
            variant={variant}
          />
        </div>

        <div className={cn(
          "grid gap-6 w-full",
          insideDialog
            ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 2xl:grid-cols-3"
            : "min-[650px]:grid-cols-2 lg:grid-cols-3",
          !insideDialog && "grid-rows-1 items-stretch"
        )}>
          {siteConfig.cloudPricingItems
            .filter((tier) => !tier.hidden && (!hideFree || tier.price !== '$0'))
            .map((tier) => (
              <PricingTier
                key={tier.name}
                tier={tier}
                currentSubscription={currentSubscription}
                isLoading={planLoadingStates}
                isFetchingPlan={isFetchingPlan}
                onPlanSelect={handlePlanSelect}
                onSubscriptionUpdate={handleSubscriptionUpdate}
                isAuthenticated={isAuthenticated}
                returnUrl={returnUrl}
                insideDialog={insideDialog}
                billingPeriod={billingPeriod}
                variant={variant}
              />
            ))}
        </div>
      </div>
      {showInfo && (
        <div className={cn(
          "mt-4 p-4 rounded-lg max-w-2xl mx-auto border",
          isDashboard
            ? "bg-muted/30 border-border text-foreground"
            : "bg-brand-50 dark:bg-brand-950/20 border-brand-200 dark:border-brand-800"
        )}>
          <p className={cn(
            "text-sm text-center",
            isDashboard ? "text-muted-foreground" : "text-brand-800 dark:text-brand-200"
          )}>
            <strong>{t('pricing.info.title', {default: 'What are credits?'})}</strong> {t('pricing.info.body', {default: 'Credits are what you spend on AI usage. More complex tasks use more credits.'})}
          </p>
        </div>
      )}
    </section>
  );
}

