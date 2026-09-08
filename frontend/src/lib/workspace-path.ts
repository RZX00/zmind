"use client";

export function buildCanvasPath(
  canvasId: string,
  teamSlug?: string | null,
  search?: string,
) {
  const base = teamSlug ? `/team/${teamSlug}/canvas/${canvasId}` : `/canvas/${canvasId}`;
  if (!search) {
    return base;
  }
  return search.startsWith('?') || search.startsWith('#') ? `${base}${search}` : `${base}?${search}`;
}

export function buildDocPath(
  itemId: string,
  teamSlug?: string | null,
  search?: string,
) {
  const base = teamSlug ? `/team/${teamSlug}/doc/${itemId}` : `/doc/${itemId}`;
  if (!search) {
    return base;
  }
  return search.startsWith('?') || search.startsWith('#') ? `${base}${search}` : `${base}?${search}`;
}

export function buildWorkspacePath(teamSlug?: string | null) {
  return teamSlug ? `/team/${teamSlug}/workspace` : '/workspace';
}

// Prefix a route with the active team slug. If the input is already
// team-scoped or no teamSlug is present, return the original path.
export function buildTeamScopedPath(path: string, teamSlug?: string | null) {
  if (!path) return path;
  if (!teamSlug) return path;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (normalizedPath.startsWith('/team/')) return normalizedPath;
  return `/team/${teamSlug}${normalizedPath}`;
}
