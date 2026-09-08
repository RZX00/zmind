import { locales } from '@/i18n/routing';
import { buildTeamScopedPath, buildWorkspacePath } from '@/lib/workspace-path';

export function normalizePath(path: string): string {
  if (!path) return '/';
  // strip hash and query
  const noHash = path.split('#')[0] || '';
  const noQuery = noHash.split('?')[0] || '';
  // remove trailing slash (except for root)
  const cleaned = noQuery.endsWith('/') && noQuery !== '/' ? noQuery.slice(0, -1) : noQuery;
  return cleaned || '/';
}

export function stripLocalePrefix(path: string): string {
  const norm = normalizePath(path);
  const parts = norm.split('/').filter(Boolean);
  if (parts.length === 0) return '/';
  if (locales.includes(parts[0] as any)) {
    const rest = '/' + parts.slice(1).join('/');
    return rest || '/';
  }
  return norm;
}

export function isSameRoute(a: string, b: string): boolean {
  return stripLocalePrefix(a) === stripLocalePrefix(b);
}

export function pathsFor(teamSlug?: string | null) {
  return {
    dashboard: buildTeamScopedPath('/dashboard', teamSlug),
    knowledge: buildTeamScopedPath('/knowledge', teamSlug),
    trash: buildTeamScopedPath('/trash', teamSlug),
    workspace: buildWorkspacePath(teamSlug),
  } as const;
}

