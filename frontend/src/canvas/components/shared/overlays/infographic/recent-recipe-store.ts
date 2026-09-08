const STORAGE_PREFIX = 'zmind:infographic:recent-recipes';
const MAX_RECENT_RECIPES = 12;

function getStorageKey(workspaceId?: string | null): string {
  return `${STORAGE_PREFIX}:${workspaceId || 'personal'}`;
}

function sanitizeRecipeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (!out.includes(trimmed)) out.push(trimmed);
    if (out.length >= MAX_RECENT_RECIPES) break;
  }
  return out;
}

export function loadRecentInfographicRecipeIds(workspaceId?: string | null): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(getStorageKey(workspaceId));
    if (!raw) return [];
    return sanitizeRecipeIds(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function saveRecentInfographicRecipeIds(
  recipeIds: string[],
  workspaceId?: string | null,
): string[] {
  const next = sanitizeRecipeIds(recipeIds).slice(0, MAX_RECENT_RECIPES);
  if (typeof window === 'undefined') return next;
  try {
    window.localStorage.setItem(getStorageKey(workspaceId), JSON.stringify(next));
  } catch {}
  return next;
}

export function pushRecentInfographicRecipeId(
  recipeId: string,
  workspaceId?: string | null,
): string[] {
  const candidate = recipeId.trim();
  if (!candidate) return loadRecentInfographicRecipeIds(workspaceId);
  const current = loadRecentInfographicRecipeIds(workspaceId);
  const next = [candidate, ...current.filter((id) => id !== candidate)].slice(0, MAX_RECENT_RECIPES);
  return saveRecentInfographicRecipeIds(next, workspaceId);
}

export function clearRecentInfographicRecipeIds(workspaceId?: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(getStorageKey(workspaceId));
  } catch {}
}
