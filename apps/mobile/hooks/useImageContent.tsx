import { SERVER_URL } from '@/constants/Server';
import { createSupabaseClient } from '@/constants/SupabaseConfig';
import { debugLog, errorLog } from '@/utils/logger';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

interface ImageContentResult {
    data: string | null;
    isLoading: boolean;
    error: Error | null;
    isProcessing: boolean; // New state for server processing
}

// Optimistic cache for uploaded files
const uploadCache = new Map<string, Blob>();

// Convert blob to base64 data URL for React Native
const blobToDataURL = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
};

export function useImageContent(
    sandboxId?: string,
    filePath?: string,
    uploadedBlob?: Blob, // For optimistic caching
    opts?: { threadId?: string }
): ImageContentResult {
    const [imageUrl, setImageUrl] = useState<string | null>(null);

    const isSandbox = Boolean(sandboxId);
    // Normalize path
    const normalizedPath = isSandbox
        ? (filePath && !filePath.startsWith('/workspace')
            ? `/workspace/${filePath.startsWith('/') ? filePath.substring(1) : filePath}`
            : filePath)
        : (filePath ? filePath.replace(/^\//, '') : filePath);

    const cacheKey = isSandbox ? `${sandboxId}:${normalizedPath}` : `media:${normalizedPath}`;
    // Use path-only key for optimistic caching to survive sandboxId changes
    const optimisticCacheKey = normalizedPath;
    const scope = isSandbox ? 'sandbox' : 'media';

    // Debug logging
    debugLog('[useImageContent] Hook initialized', {
        scope,
        hasPath: Boolean(filePath),
        hasUploadedBlob: Boolean(uploadedBlob),
    });

    // Optimistic caching for uploads
    useEffect(() => {
        if (uploadedBlob && optimisticCacheKey) {
            debugLog('[useImageContent] Setting optimistic cache', { scope });
            uploadCache.set(optimisticCacheKey, uploadedBlob);
            // Auto-expire after 2 minutes (longer to allow for server processing)
            setTimeout(() => {
                debugLog('[useImageContent] Expiring optimistic cache', { scope });
                uploadCache.delete(optimisticCacheKey);
            }, 120000);
        }
    }, [optimisticCacheKey, scope, uploadedBlob]);

    // Smart fetch with retry logic
    const {
        data: blobData,
        isLoading,
        error,
    } = useQuery({
        queryKey: ['image', isSandbox ? sandboxId : 'media', normalizedPath, opts?.threadId],
        queryFn: async () => {
            debugLog('[useImageContent] Query function called', {
                scope,
                hasNormalizedPath: Boolean(normalizedPath),
            });

            // Check optimistic cache first (try both full key and path-only key)
            const cachedBlob = uploadCache.get(cacheKey) || (optimisticCacheKey ? uploadCache.get(optimisticCacheKey) : null);
            if (cachedBlob) {
                debugLog('[useImageContent] Using optimistic cache', {
                    scope,
                    cacheSource: uploadCache.get(cacheKey) ? 'scoped' : 'path',
                });
                return cachedBlob;
            }

            debugLog('[useImageContent] Fetching image from server', {
                scope,
                hasThreadScope: Boolean(opts?.threadId),
            });

            // Fetch from server
            const supabase = createSupabaseClient();
            const { data: { session } } = await supabase.auth.getSession();

            if (!session?.access_token) {
                errorLog('[useImageContent] Missing auth token', { scope });
                throw new Error('No auth token');
            }

            const url = isSandbox
                ? new URL(`${SERVER_URL}/sandboxes/${sandboxId}/files/content`)
                : new URL(`${SERVER_URL}/media/file-uploads/${encodeURIComponent(normalizedPath || '')}`);
            if (isSandbox) {
                url.searchParams.append('path', normalizedPath!);
            } else if (opts?.threadId) {
                url.searchParams.append('thread_id', opts.threadId);
            }

            debugLog('[useImageContent] Sending fetch request', {
                scope,
                hasThreadScope: Boolean(opts?.threadId),
            });

            const response = await fetch(url.toString(), {
                headers: {
                    'Authorization': `Bearer ${session.access_token}`,
                },
            });

            debugLog('[useImageContent] Fetch response received', {
                scope,
                status: response.status,
            });

            if (!response.ok) {
                const errorMsg = `Failed to load image: ${response.status}`;
                errorLog('[useImageContent] Fetch error', {
                    scope,
                    status: response.status,
                });
                throw new Error(errorMsg);
            }

            const blob = await response.blob();
            debugLog('[useImageContent] Fetch succeeded', {
                scope,
                blobSize: blob.size,
            });

            // Clean up optimistic cache since we now have server data
            if (optimisticCacheKey && uploadCache.has(optimisticCacheKey)) {
                debugLog('[useImageContent] Cleaning optimistic cache', { scope });
                uploadCache.delete(optimisticCacheKey);
            }

            return blob;
        },
        enabled: Boolean(normalizedPath),
        staleTime: 5 * 60 * 1000, // 5 minutes
        retry: (failureCount, error: any) => {
            // Smart retry for 404s (server processing)
            if (error?.message?.includes('404')) {
                return failureCount < 3;
            }
            // Don't retry auth errors
            if (error?.message?.includes('401') || error?.message?.includes('403')) {
                return false;
            }
            return failureCount < 2;
        },
        retryDelay: (attemptIndex) => {
            // Exponential backoff: 1s, 2s, 4s
            return Math.min(1000 * (2 ** attemptIndex), 4000);
        },
    });

    // Convert blob to data URL - KEEP EXISTING URL UNTIL NEW ONE IS READY
    useEffect(() => {
        debugLog('[useImageContent] Processing blob response', {
            scope,
            hasBlob: blobData instanceof Blob,
            isLoading,
        });

        if (blobData instanceof Blob) {
            debugLog('[useImageContent] Converting blob to data URL', {
                scope,
                blobSize: blobData.size,
            });
            blobToDataURL(blobData)
                .then((dataUrl) => {
                    debugLog('[useImageContent] Blob conversion succeeded', {
                        scope,
                        dataUrlLength: dataUrl.length,
                    });
                    setImageUrl(dataUrl);
                })
                .catch((error) => {
                    errorLog('[useImageContent] Blob conversion failed', { scope, error });
                });
        } else if (!isLoading) {
            // Only clear URL if we're not currently loading (to preserve cached images)
            debugLog('[useImageContent] Clearing image URL', { scope });
            setImageUrl(null);
        } else {
            debugLog('[useImageContent] Keeping existing image URL while loading', { scope });
        }
    }, [blobData, isLoading, scope]);

    const isProcessing = error?.message?.includes('404') && isLoading;

    // Log final state  
    const imageSource = imageUrl ? (imageUrl.startsWith('data:') ? 'CACHED' : 'SERVER') : 'NONE';
    const cacheStatus = isSandbox ? 'with-sandbox' : 'media';
    debugLog('[useImageContent] Returning image state', {
        imageSource,
        isLoading,
        cacheStatus,
    });

    return {
        data: imageUrl,
        isLoading,
        error,
        isProcessing,
    };
}

// Utility for optimistic caching of uploaded files
export function cacheUploadedFile(filePath: string, blob: Blob, sandboxId?: string) {
    const normalizedPath = sandboxId
        ? (!filePath.startsWith('/workspace')
            ? `/workspace/${filePath.startsWith('/') ? filePath.substring(1) : filePath}`
            : filePath)
        : filePath.replace(/^\//, '');
    const cacheKey = sandboxId ? `${sandboxId}:${normalizedPath}` : `media:${normalizedPath}`;

    uploadCache.set(cacheKey, blob);
    debugLog('[useImageContent] Cached uploaded file', {
        scope: sandboxId ? 'sandbox' : 'media',
    });

    // Auto-expire after 2 minutes (longer to allow for server processing)
    setTimeout(() => {
        uploadCache.delete(cacheKey);
        debugLog('[useImageContent] Expired uploaded file cache', {
            scope: sandboxId ? 'sandbox' : 'media',
        });
    }, 120000);
} 
