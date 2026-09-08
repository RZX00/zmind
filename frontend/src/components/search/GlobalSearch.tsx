'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import {
  FilePlus2,
  FileText,
  LayoutGrid,
  Link2,
  Loader2,
  Sparkles,
} from 'lucide-react';
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { GLOBAL_SEARCH_OPEN_EVENT } from '@/lib/global-search';
import { useUnifiedSearch } from '@/hooks/react-query/search/use-unified-search';
import useWorkspaceLauncherActions from '@/hooks/useWorkspaceLauncherActions';
import WorkspaceLauncherGuardDialog from '@/components/workspace/WorkspaceLauncherGuardDialog';
import type { UnifiedSearchResult } from '@/types/search';

const DEBOUNCE_MS = 180;

const hasCjk = (value: string) => /[\u4e00-\u9fff]/.test(value);

const getMinLength = (value: string) => {
  if (!value) return 0;
  return hasCjk(value) ? 1 : 2;
};

const getResultIcon = (result: UnifiedSearchResult) => {
  if (result.resultType === 'doc') return FileText;
  if (result.resultType === 'reference') return Link2;
  return LayoutGrid;
};

const getResultBadge = (
  result: UnifiedSearchResult,
  t: (key: string, values?: Record<string, unknown>) => string,
) => {
  if (result.resultType === 'doc') {
    return t('badgeDoc', { default: 'Doc' });
  }
  if (result.resultType === 'reference') {
    return t('badgeLink', { default: 'Link' });
  }
  return t('badgeCanvas', { default: 'Canvas' });
};

const formatUpdatedAt = (
  value: number,
  locale: ReturnType<typeof useLocale>,
) => {
  if (!value) return null;
  return formatDistanceToNow(new Date(value), {
    addSuffix: true,
    locale: locale === 'zh' ? zhCN : undefined,
  });
};

const GlobalSearch = () => {
  const t = useTranslations('globalSearch');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const trimmedQuery = query.trim();
  const minLength = getMinLength(trimmedQuery);
  const queryReady = trimmedQuery.length >= minLength;

  const {
    recentItems,
    creatingCanvas,
    creatingDoc,
    createCanvasAndOpen,
    createDocAndOpen,
    openCanvas,
    openDoc,
    openSearchResult,
    guardDialog,
    confirmPendingAction,
    cancelPendingAction,
  } = useWorkspaceLauncherActions();

  useEffect(() => {
    const onOpen = () => setOpen(true);
    if (typeof window === 'undefined') return;
    window.addEventListener(GLOBAL_SEARCH_OPEN_EVENT, onOpen as EventListener);
    return () => window.removeEventListener(GLOBAL_SEARCH_OPEN_EVENT, onOpen as EventListener);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedQuery(trimmedQuery);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [trimmedQuery]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setDebouncedQuery('');
    }
  }, [open]);

  const {
    data,
    isFetching,
    error,
  } = useUnifiedSearch(debouncedQuery, {
    enabled: open && queryReady,
    limit: 12,
  });

  const searchResults = data?.results || [];

  const actionCanvasLabel = trimmedQuery.length > 0
    ? t('createCanvasWithTitle', { title: trimmedQuery })
    : t('createCanvas');

  const actionDocLabel = trimmedQuery.length > 0
    ? t('createDocWithTitle', { title: trimmedQuery })
    : t('createDoc');

  const handleCreateCanvas = useCallback(() => {
    createCanvasAndOpen({
      title: trimmedQuery || undefined,
      autoCollapseSidebar: true,
    });
    setOpen(false);
  }, [createCanvasAndOpen, trimmedQuery]);

  const handleCreateDoc = useCallback(() => {
    createDocAndOpen({
      title: trimmedQuery || undefined,
      autoCollapseSidebar: true,
    });
    setOpen(false);
  }, [createDocAndOpen, trimmedQuery]);

  const handleOpenResult = useCallback((result: UnifiedSearchResult) => {
    openSearchResult(result, { autoCollapseSidebar: true });
    setOpen(false);
  }, [openSearchResult]);

  const showRecentItems = trimmedQuery.length === 0;
  const showSearchResults = trimmedQuery.length > 0 && queryReady;
  const hasSearchResults = showSearchResults && searchResults.length > 0;
  const showEmptySearchState = showSearchResults && !isFetching && !error && searchResults.length === 0;

  const recentList = useMemo(
    () => recentItems.slice(0, 8),
    [recentItems],
  );

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogHeader className="sr-only">
          <DialogTitle>{t('open', { default: 'Search docs and canvases' })}</DialogTitle>
          <DialogDescription>
            {t('description', {
              default: 'Quickly create a new canvas or doc, or jump to an existing one.',
            })}
          </DialogDescription>
        </DialogHeader>
        <DialogContent className="max-w-[760px] overflow-hidden p-0">
          <Command shouldFilter={false} className="rounded-xl">
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder={t('placeholder', { default: 'Search docs and canvases...' })}
              aria-label={t('placeholder', { default: 'Search docs and canvases...' })}
            />

            <div className="border-b px-3 py-2 text-xs text-muted-foreground">
              {t('hint', {
                default: 'Type to search docs, canvases, nodes and links. Press Enter on an action to move fast.',
              })}
            </div>

            <CommandList className="max-h-[460px]">
              <CommandGroup heading={t('quickActions', { default: 'Quick actions' })}>
                <CommandItem
                  value={`create-canvas-${trimmedQuery || 'blank'}`}
                  onSelect={handleCreateCanvas}
                  className="flex items-center gap-3 px-3 py-3"
                >
                  {creatingCanvas ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : (
                    <LayoutGrid className="h-4 w-4 text-muted-foreground" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">{actionCanvasLabel}</div>
                    <div className="text-xs text-muted-foreground">
                      {t('quickCanvasHint', { default: 'Open a fresh canvas immediately' })}
                    </div>
                  </div>
                  <CommandShortcut>{t('action', { default: 'Go' })}</CommandShortcut>
                </CommandItem>
                <CommandItem
                  value={`create-doc-${trimmedQuery || 'blank'}`}
                  onSelect={handleCreateDoc}
                  className="flex items-center gap-3 px-3 py-3"
                >
                  {creatingDoc ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : (
                    <FilePlus2 className="h-4 w-4 text-muted-foreground" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">{actionDocLabel}</div>
                    <div className="text-xs text-muted-foreground">
                      {t('quickDocHint', { default: 'Start writing in a new doc right away' })}
                    </div>
                  </div>
                  <CommandShortcut>{t('action', { default: 'Go' })}</CommandShortcut>
                </CommandItem>
              </CommandGroup>

              <CommandSeparator />

              {trimmedQuery.length > 0 && !queryReady && (
                <div className="px-3 py-3 text-sm text-muted-foreground">
                  {t('minLength', {
                    default: 'Type at least {count} characters to search, or use the quick actions above.',
                    count: minLength,
                  })}
                </div>
              )}

              {showRecentItems && (
                <CommandGroup heading={t('recent', { default: 'Recently updated' })}>
                  {recentList.length === 0 && (
                    <div className="px-3 py-3 text-sm text-muted-foreground">
                      {t('recentEmpty', { default: 'No docs or canvases yet.' })}
                    </div>
                  )}
                  {recentList.map((item) => {
                    const Icon = item.type === 'doc' ? FileText : LayoutGrid;
                    return (
                      <CommandItem
                        key={`${item.type}-${item.id}`}
                        value={`recent-${item.type}-${item.id}-${item.title}`}
                        onSelect={() => {
                          if (item.type === 'doc') {
                            openDoc(item.id, {
                              autoCollapseSidebar: true,
                              title: item.title,
                            });
                          } else {
                            openCanvas({
                              id: item.sourceId || item.id,
                              title: item.title,
                            }, {
                              autoCollapseSidebar: true,
                            });
                          }
                          setOpen(false);
                        }}
                        className="flex items-center gap-3 px-3 py-3"
                      >
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-foreground">{item.title}</div>
                          <div className="text-xs text-muted-foreground">
                            {item.type === 'doc'
                              ? t('badgeDoc', { default: 'Doc' })
                              : t('badgeCanvas', { default: 'Canvas' })}
                            {' · '}
                            {formatUpdatedAt(item.updatedAt, locale) || t('recentNow', { default: 'just now' })}
                          </div>
                        </div>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}

              {showSearchResults && (
                <>
                  {isFetching && (
                    <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>{t('loading', { default: 'Searching…' })}</span>
                    </div>
                  )}

                  {!isFetching && !error && hasSearchResults && (
                    <CommandGroup heading={t('results', { default: 'Search results' })}>
                      {searchResults.map((result) => {
                        const Icon = getResultIcon(result);
                        return (
                          <CommandItem
                            key={result.id}
                            value={`result-${result.id}-${result.title}`}
                            onSelect={() => handleOpenResult(result)}
                            className="flex items-start gap-3 px-3 py-3"
                          >
                            <Icon className="mt-0.5 h-4 w-4 text-muted-foreground" />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-3">
                                <div className="truncate text-sm font-medium text-foreground">{result.title || t('untitled', { default: 'Untitled' })}</div>
                                <span className="rounded border border-border/70 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                                  {getResultBadge(result, t)}
                                </span>
                              </div>
                              <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                                {result.snippet || t('resultHint', { default: 'Open this result' })}
                              </div>
                              <div className="mt-1 text-[11px] text-muted-foreground">
                                {formatUpdatedAt(result.updatedAt, locale) || t('recentNow', { default: 'just now' })}
                              </div>
                            </div>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  )}

                  {!isFetching && error && (
                    <div className="px-3 py-3 text-sm text-muted-foreground">
                      {t('unavailable', { default: 'Search is unavailable right now. Try again in a moment.' })}
                    </div>
                  )}

                  {showEmptySearchState && (
                    <div className="px-3 py-4 text-sm text-muted-foreground">
                      <div>{t('noResults', { default: 'No results for "{query}"', query: trimmedQuery })}</div>
                      <div className="mt-1 text-xs">
                        {t('noResultsHint', {
                          default: 'Create a new canvas or doc with the quick actions above.',
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}

              {!showRecentItems && !showSearchResults && (
                <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
                  <Sparkles className="h-4 w-4" />
                  <span>
                    {t('emptyHelp', {
                      default: 'Use quick actions above, or keep typing to search everything in this workspace.',
                    })}
                  </span>
                </div>
              )}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>

      <WorkspaceLauncherGuardDialog
        open={guardDialog.open}
        title={guardDialog.title}
        description={guardDialog.description}
        confirmLabel={guardDialog.confirmLabel}
        cancelLabel={guardDialog.cancelLabel}
        onConfirm={confirmPendingAction}
        onCancel={cancelPendingAction}
      />
    </>
  );
};

export default GlobalSearch;
