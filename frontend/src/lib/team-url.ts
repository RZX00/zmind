import { BRAND } from '@/lib/brand';

const stripTrailingSlash = (value: string) => value.replace(/\/+$/g, '');
const stripWrappingSlashes = (value: string) => value.replace(/^\/+|\/+$/g, '');

export const resolveTeamOrigin = (origin?: string | null) => {
  const base = origin?.trim() || BRAND.SITE_URL;
  return stripTrailingSlash(base);
};

export const getTeamUrlBase = (origin?: string | null) =>
  `${resolveTeamOrigin(origin)}/team`;

export const buildTeamUrl = (slug: string, origin?: string | null) => {
  const normalizedSlug = stripWrappingSlashes(slug);
  return normalizedSlug
    ? `${getTeamUrlBase(origin)}/${normalizedSlug}`
    : getTeamUrlBase(origin);
};
