'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, ImagePlus, Loader2, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import { useWorkspace } from '@/contexts/workspace-context';
import {
  useInfographicPreferenceDefaults,
  useInfographicRecipes,
  useUpdateInfographicPreferenceDefaults,
} from '@/hooks/react-query/infographic/use-infographic';
import { uploadFileWithIntent, getDownloadUrl } from '@/lib/api/files';
import { pushRecentInfographicRecipeId } from './recent-recipe-store';

export type InfographicStyleDraft = {
  recipeId?: string;
  recipeName?: string;
  customPrompt: string;
  referenceImageFileId?: string | null;
  referenceImagePreviewUrl?: string | null;
};

interface InfographicStyleStudioDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: InfographicStyleDraft | null;
  onApply: (value: InfographicStyleDraft | null) => void;
}

const MAX_REF_IMAGE_SIZE = 10 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/** Muted gradient fallback for recipes without cover art. */
function chipGradient(id: string, coverUrl?: string | null): React.CSSProperties {
  if (coverUrl) {
    return {
      backgroundImage: `linear-gradient(180deg, transparent 40%, rgba(0,0,0,0.55) 100%), url(${coverUrl})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    };
  }
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const a = h % 360;
  const b = (a + 35) % 360;
  return { background: `linear-gradient(135deg, hsl(${a} 32% 42%), hsl(${b} 28% 30%))` };
}

/** Large preview gradient for selected recipe. */
function previewStyle(id: string, coverUrl?: string | null): React.CSSProperties {
  if (coverUrl) {
    return {
      backgroundImage: `linear-gradient(180deg, transparent 30%, rgba(0,0,0,0.6) 100%), url(${coverUrl})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    };
  }
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const a = h % 360;
  const b = (a + 40) % 360;
  return { background: `linear-gradient(135deg, hsl(${a} 30% 35%), hsl(${b} 25% 25%))` };
}

export default function InfographicStyleStudioDialog({
  open,
  onOpenChange,
  value,
  onApply,
}: InfographicStyleStudioDialogProps) {
  const t = useTranslations();
  const { account, workspaceId } = useWorkspace();
  const canManageWorkspace = Boolean(
    account?.personal_account || account?.role === 'owner' || account?.is_primary_owner,
  );

  const defaultsQuery = useInfographicPreferenceDefaults(open);
  const recipesQuery = useInfographicRecipes(undefined, open);
  const updateMutation = useUpdateInfographicPreferenceDefaults();

  const [selectedRecipeId, setSelectedRecipeId] = useState('');
  const [customPrompt, setCustomPrompt] = useState('');
  const [refFileId, setRefFileId] = useState<string | null>(null);
  const [refPreviewUrl, setRefPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const recipes = useMemo(() => recipesQuery.data?.recipes ?? [], [recipesQuery.data?.recipes]);
  const resolved = defaultsQuery.data?.resolved;

  useEffect(() => {
    if (!open) return;
    if (value) {
      setSelectedRecipeId(value.recipeId || '');
      setCustomPrompt(value.customPrompt || '');
      setRefFileId(value.referenceImageFileId ?? null);
      setRefPreviewUrl(value.referenceImagePreviewUrl ?? null);
      return;
    }
    if (!resolved) return;
    setSelectedRecipeId(resolved.recipe_id || '');
    setCustomPrompt(resolved.custom_prompt || '');
    setRefFileId(resolved.reference_image_file_id ?? null);
    if (resolved.reference_image_file_id) {
      getDownloadUrl(resolved.reference_image_file_id)
        .then((d) => setRefPreviewUrl(d.url))
        .catch(() => setRefPreviewUrl(null));
    } else {
      setRefPreviewUrl(null);
    }
  }, [open, resolved, value]);

  const sorted = useMemo(() => {
    const arr = [...recipes];
    arr.sort((a, b) => {
      const d = (b.scope_type === 'system' ? 1 : 0) - (a.scope_type === 'system' ? 1 : 0);
      return d || a.name.localeCompare(b.name);
    });
    return arr;
  }, [recipes]);

  const byId = useMemo(() => new Map(recipes.map((r) => [r.recipe_id, r])), [recipes]);
  const sel = selectedRecipeId ? byId.get(selectedRecipeId) : null;
  const loading = defaultsQuery.isLoading || recipesQuery.isLoading;
  const saving = updateMutation.isPending;

  // ── Upload ────────────────────────────────────────────────────────
  const upload = useCallback(
    async (file: File) => {
      if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
        toast.error(t('canvas.selectionOverlay.refImageInvalidType'));
        return;
      }
      if (file.size > MAX_REF_IMAGE_SIZE) {
        toast.error(t('canvas.selectionOverlay.refImageTooLarge'));
        return;
      }
      setUploading(true);
      try {
        const { file_id } = await uploadFileWithIntent(file, 'infographic_reference');
        setRefFileId(file_id);
        const { url } = await getDownloadUrl(file_id);
        setRefPreviewUrl(url);
      } catch (err: any) {
        toast.error(err?.message || t('canvas.selectionOverlay.refImageUploadFailed'));
      } finally {
        setUploading(false);
      }
    },
    [t],
  );

  const removeRef = useCallback(() => {
    setRefFileId(null);
    setRefPreviewUrl(null);
    if (fileRef.current) fileRef.current.value = '';
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const f = e.dataTransfer?.files?.[0];
      if (f) void upload(f);
    },
    [upload],
  );

  // ── Actions ───────────────────────────────────────────────────────
  const apply = () => {
    onApply({
      recipeId: selectedRecipeId || undefined,
      recipeName: sel?.name,
      customPrompt,
      referenceImageFileId: refFileId,
      referenceImagePreviewUrl: refPreviewUrl,
    });
    if (selectedRecipeId) pushRecentInfographicRecipeId(selectedRecipeId, workspaceId);
    onOpenChange(false);
    toast.success(t('canvas.selectionOverlay.styleAppliedTemporary'));
  };

  const save = async (scope: 'user' | 'workspace') => {
    try {
      await updateMutation.mutateAsync({
        scope,
        default_recipe_id: selectedRecipeId || null,
        default_custom_prompt: customPrompt.trim() || null,
        default_reference_image_file_id: refFileId || null,
      });
      toast.success(
        scope === 'workspace'
          ? t('canvas.selectionOverlay.styleSavedWorkspace')
          : t('canvas.selectionOverlay.styleSavedUser'),
      );
    } catch (err: any) {
      toast.error(err?.message || t('canvas.selectionOverlay.styleSaveFailed'));
    }
  };

  // ── Render ────────────────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[88vh] flex flex-col p-0 gap-0 overflow-hidden">
        {/* ── Header ── */}
        <DialogHeader className="shrink-0 px-5 pt-4 pb-3">
          <DialogTitle className="text-base font-semibold">
            {t('canvas.selectionOverlay.styleSettingsTitle')}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t('canvas.selectionOverlay.styleSettingsDesc')}
          </DialogDescription>
        </DialogHeader>

        {/* ── Body (scrollable) ── */}
        {loading ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {t('canvas.selectionOverlay.loadingStyleSettings')}
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-4 space-y-4">
            {/* ── Preview card for selected style ── */}
            <div
              className="relative h-36 rounded-xl overflow-hidden transition-all duration-300"
              style={previewStyle(sel?.recipe_id || 'default', sel?.cover_url)}
            >
              <div className="absolute inset-0 flex flex-col justify-end p-4">
                <div className="text-base font-semibold text-white drop-shadow-md">
                  {sel?.name || t('canvas.selectionOverlay.stylePreviewResolvedDefault')}
                </div>
                {sel?.description && (
                  <div className="mt-0.5 text-xs text-white/80 line-clamp-2 drop-shadow-sm">
                    {sel.description}
                  </div>
                )}
                {sel?.tags && sel.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {sel.tags.slice(0, 4).map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-white/15 backdrop-blur-sm px-2 py-0.5 text-[10px] text-white/80"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* ── Style chips row ── */}
            <section>
              <h3 className="mb-2 text-xs font-medium text-muted-foreground">
                {t('canvas.selectionOverlay.stylePresetsLabel')}
              </h3>
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
                {sorted.map((r) => {
                  const on = r.recipe_id === selectedRecipeId;
                  return (
                    <button
                      key={r.recipe_id}
                      type="button"
                      onClick={() => setSelectedRecipeId(r.recipe_id)}
                      className={[
                        'relative flex-shrink-0 w-[104px] h-[72px] rounded-lg overflow-hidden transition-all cursor-pointer',
                        on
                          ? 'ring-2 ring-primary ring-offset-1 ring-offset-background scale-[1.03]'
                          : 'ring-1 ring-white/8 hover:ring-white/20',
                      ].join(' ')}
                      style={chipGradient(r.recipe_id, r.cover_url)}
                    >
                      <span className="absolute inset-x-0 bottom-0 px-2 pb-1.5 pt-5 bg-gradient-to-t from-black/60 to-transparent">
                        <span className="block text-[11px] font-medium text-white/90 leading-tight truncate">
                          {r.name}
                        </span>
                      </span>
                    </button>
                  );
                })}
                {!sorted.length && (
                  <div className="flex h-[72px] w-full items-center justify-center rounded-lg border border-dashed border-border/40 text-xs text-muted-foreground">
                    {t('canvas.selectionOverlay.styleNoMarketResult')}
                  </div>
                )}
              </div>
            </section>

            {/* ── Reference image ── */}
            <section>
              <h3 className="mb-2 text-xs font-medium text-muted-foreground">
                {t('canvas.selectionOverlay.refImageLabel')}
                <span className="ml-1 font-normal text-muted-foreground/50">
                  {t('canvas.selectionOverlay.optionalHint')}
                </span>
              </h3>

              {refPreviewUrl ? (
                <div className="flex items-center gap-3 rounded-lg border border-border/40 p-2">
                  <img
                    src={refPreviewUrl}
                    alt=""
                    className="h-12 w-12 shrink-0 rounded-md object-cover border border-border/30"
                  />
                  <span className="flex-1 min-w-0 text-xs text-muted-foreground truncate">
                    {t('canvas.selectionOverlay.refImageAttached')}
                  </span>
                  <button
                    type="button"
                    onClick={removeRef}
                    className="shrink-0 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <div
                  role="button"
                  tabIndex={0}
                  className="flex items-center gap-3 rounded-lg border border-dashed border-border/40 p-3 cursor-pointer transition-colors hover:border-primary/30 hover:bg-primary/5"
                  onClick={() => fileRef.current?.click()}
                  onKeyDown={(e) => e.key === 'Enter' && fileRef.current?.click()}
                  onDrop={onDrop}
                  onDragOver={(e) => e.preventDefault()}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted/20">
                    {uploading ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/60" />
                    ) : (
                      <ImagePlus className="h-4 w-4 text-muted-foreground/50" />
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground/70">
                    {uploading
                      ? t('canvas.selectionOverlay.refImageUploading')
                      : t('canvas.selectionOverlay.refImageDropOrClick')}
                  </span>
                </div>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(f);
                }}
              />
            </section>

            {/* ── Custom prompt ── */}
            <section>
              <h3 className="mb-2 text-xs font-medium text-muted-foreground">
                {t('canvas.selectionOverlay.customPrompt')}
                <span className="ml-1 font-normal text-muted-foreground/50">
                  {t('canvas.selectionOverlay.optionalHint')}
                </span>
              </h3>
              <Textarea
                rows={2}
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                className="text-sm resize-none"
                placeholder={t('canvas.selectionOverlay.customPromptPlaceholder')}
              />
            </section>
          </div>
        )}

        {/* ── Footer ── */}
        <div className="shrink-0 flex items-center justify-between gap-2 border-t border-border/30 px-5 py-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={saving || loading}
                className="text-xs text-muted-foreground/70 hover:text-muted-foreground"
              >
                {saving && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
                {t('canvas.selectionOverlay.saveAsDefault')}
                <ChevronDown className="ml-1 h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[160px]">
              <DropdownMenuItem className="text-xs" onClick={() => void save('user')}>
                {t('canvas.selectionOverlay.styleSaveAsMyDefault')}
              </DropdownMenuItem>
              {canManageWorkspace && (
                <DropdownMenuItem className="text-xs" onClick={() => void save('workspace')}>
                  {t('canvas.selectionOverlay.styleSaveAsWorkspaceDefault')}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button type="button" size="sm" disabled={loading} onClick={apply}>
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            {t('canvas.selectionOverlay.styleApplyToCanvas')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
