import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const CREEM_TIER_CODES = [
  'TIER_2_20',
  'TIER_6_50',
  'TIER_12_100',
  'TIER_25_200',
  'TIER_50_400',
  'TIER_125_800',
  'TIER_200_1000',
] as const;

const buildPublicEnv = (): Record<string, string> => {
  const entries: Array<[string, string]> = [];

  for (const tierCode of CREEM_TIER_CODES) {
    const legacyMonthly = `CREEM_${tierCode}_ID`;
    const publicMonthly = `NEXT_PUBLIC_${legacyMonthly}`;
    const monthlyValue = process.env[publicMonthly] ?? process.env[legacyMonthly];
    if (monthlyValue && monthlyValue.trim()) {
      entries.push([publicMonthly, monthlyValue.trim()]);
    }

    const legacyYearly = `CREEM_${tierCode}_YEARLY_ID`;
    const publicYearly = `NEXT_PUBLIC_${legacyYearly}`;
    const yearlyValue = process.env[publicYearly] ?? process.env[legacyYearly];
    if (yearlyValue && yearlyValue.trim()) {
      entries.push([publicYearly, yearlyValue.trim()]);
    }
  }

  return Object.fromEntries(entries);
};

const POSTHOG_REWRITES = [
  {
    source: '/ingest/static/:path*',
    destination: 'https://eu-assets.i.posthog.com/static/:path*',
  },
  {
    source: '/ingest/:path*',
    destination: 'https://eu.i.posthog.com/:path*',
  },
  {
    source: '/ingest/flags',
    destination: 'https://eu.i.posthog.com/flags',
  },
] as const;

const baseConfig: NextConfig = ({
  productionBrowserSourceMaps: true,
  output: (process.env.NEXT_OUTPUT as 'standalone') || undefined,
  transpilePackages: [],
  typescript: {
    ignoreBuildErrors: true,
  },
  env: buildPublicEnv(),
  
  async rewrites() {
    return [...POSTHOG_REWRITES];
  },
  skipTrailingSlashRedirect: true,
});

// Tell next-intl where to find the request config
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

export default withNextIntl(baseConfig);
