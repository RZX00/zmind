/**
 * Shared collaborator color/initials helpers.
 *
 * Extracted from TopBar so the avatar ring, the presence broadcast color, and
 * the remote selection overlays all derive the exact same color for a given user.
 */

export const COLLAB_COLORS = ['#f97316', '#14b8a6', '#0ea5e9', '#ec4899', '#8b5cf6'];

export const computeCollaboratorColor = (seed: string, provided?: string) => {
  if (provided) return provided;
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash) % COLLAB_COLORS.length;
  return COLLAB_COLORS[index];
};

export const collaboratorInitials = (name: string) => {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] || '').toUpperCase() + (parts[1][0] || '').toUpperCase();
};
