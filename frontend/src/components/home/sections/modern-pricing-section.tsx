'use client';

import { SectionHeader } from '@/components/home/section-header';
import { siteConfig } from '@/lib/home';
import { cn } from '@/lib/utils';
import { motion } from 'motion/react';
import React, { useState, useCallback } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useRouter } from '@/i18n/routing';
import { CheckIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {useTranslations} from 'next-intl';

// Modern pricing tier interface
interface ModernPricingTier {
  id: string;
  name: string;
  tagline: string;
  price: string;
  features: string[];
  isPopular?: boolean;
  gradient: string;
  textColor: string;
  buttonText: string;
  originalTier: any; // Reference to original tier for functionality
}

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

// Create modern tiers based on existing tiers with billing period support
const createModernTiers = (billingPeriod: 'monthly' | 'yearly', t: ReturnType<typeof useTranslations>): ModernPricingTier[] => {
  const originalTiers = siteConfig.cloudPricingItems.filter(tier => !tier.hidden);

  return originalTiers.map((tier, index) => {
    const id = tier.name.toLowerCase();
    const getDisplayPrice = () => {
      if (billingPeriod === 'yearly' && tier.yearlyPrice) {
        return `$${formatMoney(parsePriceValue(tier.yearlyPrice) / 12)}`;
      }
      return tier.price;
    };

    const gradients = [
      'from-brand-600 to-black',
      'from-brand-600 to-black',
      'from-brand-600 to-black'
    ];

    return {
      id: tier.name.toLowerCase(),
      name: tier.name,
      tagline: t(`pricing.tiers.${id}.tagline`, { defaultMessage: tier.description }),
      price: getDisplayPrice(),
      features: (t.raw?.(`pricing.tiers.${id}.features`) as string[]) ?? tier.features,
      isPopular: tier.isPopular,
      gradient: gradients[index % gradients.length],
      textColor: 'text-white',
      buttonText: t(`pricing.tiers.${id}.button`, { defaultMessage: tier.buttonText }),
      originalTier: tier
    };
  });
};

interface ModernPricingCardProps {
  tier: ModernPricingTier;
  index: number;
  billingPeriod: 'monthly' | 'yearly';
}

function ModernPricingCard({ tier, index, billingPeriod }: ModernPricingCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const { user } = useAuth();
  const router = useRouter();
  const t = useTranslations();
  const isFreePlan = parsePriceValue(tier.originalTier.price) === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: index * 0.1 }}
      className="relative group"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Popular badge */}
      {tier.isPopular && (
        <div className="absolute -top-4 left-1/2 transform -translate-x-1/2 z-20">
          <motion.div
            initial={{ scale: 0, rotate: -10 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ duration: 0.3, delay: 0.5 }}
          >
            <Badge className="bg-white dark:bg-gray-900 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 shadow-lg font-playfair text-sm px-4 py-1.5 font-medium">
              {t('pricing.mostPopular', { defaultMessage: 'Most popular' })}
            </Badge>
          </motion.div>
        </div>
      )}

      {/* Main card */}
      <div
        className={cn(
          "relative h-full overflow-hidden transition-all duration-700 ease-out cursor-pointer",
          "bg-background",
          "border-2 border-border"
        )}
        style={{
          borderRadius: '0px',
          minHeight: '500px', // 确保所有卡片都有相同的最小高度
        }}
      >
        {/* Gradient overlay with animated entrance */}
        <motion.div
          className={cn(
            "absolute inset-0 transition-opacity duration-700",
            `bg-gradient-to-b ${tier.gradient}`
          )}
          initial={{ opacity: 0 }}
          animate={{ opacity: isHovered ? 1 : 0 }}
          transition={{ duration: 0.7, ease: "easeInOut" }}
        />



        {/* Content */}
        <div className="relative z-10 p-6 sm:p-8 h-full flex flex-col">
          {/* Header */}
          <div className="mb-6 text-center">
            <motion.h3
              className={cn(
                "font-google-sans text-2xl sm:text-3xl font-bold mb-3 transition-colors duration-500",
                isHovered ? tier.textColor : "text-gray-900 dark:text-white"
              )}
              animate={{
                scale: isHovered ? 1.05 : 1,
              }}
              transition={{ duration: 0.3 }}
            >
              {tier.name}
            </motion.h3>
            <p className={cn(
              "font-inter text-sm leading-relaxed transition-colors duration-500 line-clamp-3",
              isHovered ? "text-white/90" : "text-gray-600 dark:text-gray-400"
            )}>
              {tier.tagline}
            </p>
          </div>

          {/* Price */}
          <div className="mb-8">
            <motion.div
              className="flex items-baseline"
              animate={{
                y: isHovered ? -2 : 0,
              }}
              transition={{ duration: 0.3 }}
            >
              <span className={cn(
                "font-playfair text-4xl sm:text-5xl font-bold transition-colors duration-500",
                isHovered ? tier.textColor : "text-gray-900 dark:text-white"
              )}>
                {tier.price}
              </span>
              {!isFreePlan && (
                <span className={cn(
                  "font-inter text-base sm:text-lg ml-2 transition-colors duration-500",
                  isHovered ? "text-white/80" : "text-gray-500"
                )}>
                  {t('pricing.perMonth')}
                </span>
              )}
            </motion.div>
            {/* Billing period indicator and savings */}
            {billingPeriod === 'yearly' &&
              tier.originalTier.yearlyPrice &&
              tier.originalTier.originalYearlyPrice &&
              !isFreePlan && (
              <div className="mt-2">
                <div className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold bg-green-50 border-green-200 text-green-700 w-fit">
                  {t('pricing.savePerYear', {
                    amount: `$${formatMoney(
                      parsePriceValue(tier.originalTier.originalYearlyPrice) -
                        parsePriceValue(tier.originalTier.yearlyPrice),
                    )}`,
                    defaultMessage: 'Save {amount} per year',
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Features */}
          <div className="flex-grow mb-8">
            <ul className="space-y-3 sm:space-y-4">
              {tier.features.map((feature, idx) => (
                <motion.li
                  key={idx}
                  className="flex items-start"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3, delay: 0.1 * idx }}
                >
                  <CheckIcon className={cn(
                    "w-4 h-4 sm:w-5 sm:h-5 mt-0.5 mr-3 flex-shrink-0 transition-colors duration-500",
                    isHovered ? "text-white" : "text-green-500"
                  )} />
                  <span className={cn(
                    "font-inter text-sm transition-colors duration-500",
                    isHovered ? "text-white/90" : "text-gray-700 dark:text-gray-300"
                  )}>
                    {feature}
                  </span>
                </motion.li>
              ))}
            </ul>
          </div>

          {/* Button */}
          <motion.div
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <Button
              className={cn(
                "w-full font-inter font-medium transition-all duration-500 py-3 sm:py-4",
                "border-0",
                isHovered
                  ? "bg-white text-gray-900 hover:bg-white"
                  : "bg-background text-gray-900 dark:text-white hover:bg-white hover:text-gray-900 dark:hover:bg-white dark:hover:text-gray-900"
              )}
              style={{
                borderRadius: '0px'
              }}
              onClick={() => {
                router.push('/invite');
              }}
            >
              {t('pricing.cta')}
            </Button>
          </motion.div>
        </div>

      </div>
    </motion.div>
  );
}

// Billing period toggle component
function BillingPeriodToggle({
  billingPeriod,
  setBillingPeriod
}: {
  billingPeriod: 'monthly' | 'yearly';
  setBillingPeriod: (period: 'monthly' | 'yearly') => void;
}) {
  const t = useTranslations();
  return (
    <div className="flex items-center justify-center gap-3">
      <div className="relative bg-muted rounded-full p-1">
        <div className="flex">
          <div
            className={cn("px-3 py-1 rounded-full text-xs font-medium transition-all duration-200 cursor-pointer",
              billingPeriod === 'monthly'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
            onClick={() => setBillingPeriod('monthly')}
          >
            {t('pricing.billing.monthly', { defaultMessage: 'Monthly' })}
          </div>
          <div
            className={cn("px-3 py-1 rounded-full text-xs font-medium transition-all duration-200 flex items-center gap-1 cursor-pointer",
              billingPeriod === 'yearly'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
            onClick={() => setBillingPeriod('yearly')}
          >
            {t('pricing.billing.yearly', { defaultMessage: 'Yearly' })}
            <span className="bg-green-600 text-green-50 dark:bg-green-500 dark:text-green-50 text-[10px] px-1.5 py-0.5 rounded-full font-semibold whitespace-nowrap">
              {t('pricing.billing.discount', { defaultMessage: '2 months free' })}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

interface ModernPricingSectionProps {
  showTitleAndTabs?: boolean;
  className?: string;
}

export function ModernPricingSection({
  showTitleAndTabs = true,
  className
}: ModernPricingSectionProps) {
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'yearly'>('yearly');
  const t = useTranslations();
  const modernTiers = createModernTiers(billingPeriod, t);

  return (
    <section
      id="pricing"
      className={cn(
        "flex flex-col items-center justify-center w-full relative py-16",
        className
      )}
    >
      <div className="w-full max-w-7xl mx-auto px-6">
        {showTitleAndTabs && (
          <SectionHeader>
            <h2 className="font-playfair text-4xl md:text-5xl font-bold text-center text-balance mb-4">
              {t('pricing.title', { defaultMessage: 'Choose the right plan for your needs' })}
            </h2>
            <p className="font-inter text-lg text-muted-foreground text-center text-balance max-w-3xl mx-auto">
              {t('pricing.subtitle', { defaultMessage: 'Start with our free plan or upgrade for more credits' })}
            </p>
          </SectionHeader>
        )}

        <div className="flex justify-center mb-12">
          <BillingPeriodToggle
            billingPeriod={billingPeriod}
            setBillingPeriod={setBillingPeriod}
          />
        </div>

        {/* Pricing cards grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8 lg:gap-12 mt-16 max-w-6xl mx-auto">
          {modernTiers.map((tier, index) => (
            <ModernPricingCard
              key={tier.id}
              tier={tier}
              index={index}
              billingPeriod={billingPeriod}
            />
          ))}
        </div>

        {/* Bottom note */}
        <div className="mt-16 text-center">
          <p className="font-inter text-sm text-muted-foreground max-w-2xl mx-auto">
            {t('pricing.bottomNote', { defaultMessage: 'Prices shown are for illustration. Actual pricing may vary based on usage and plan.' })}
          </p>
        </div>
      </div>
    </section>
  );
}
