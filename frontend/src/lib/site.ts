import { requiredOneOf } from '@/lib/env-utils';

export const siteConfig = {
  name: 'Zmind',
  url: requiredOneOf(['NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_URL']),
  description: 'All-in-one thinking studio for visual collaboration and creative problem-solving',
  links: {
    twitter: 'https://x.com/AletheonAI',
    github: '',
    linkedin: 'https://www.linkedin.com/company/aletheon/',
  },
};

export type SiteConfig = typeof siteConfig;
