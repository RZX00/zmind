import React from 'react';
import Image from 'next/image';
import {
    FileText, FileImage, FileCode, FileSpreadsheet, FileVideo,
    FileAudio, FileType, Database, Archive, File, ExternalLink,
    Loader2, Download, ChevronDown
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { AttachmentGroup } from './attachment-group';
import { HtmlRenderer } from './preview-renderers/html-renderer';
import { MarkdownRenderer } from './preview-renderers/file-preview-markdown-renderer';
import { CsvRenderer } from './preview-renderers/csv-renderer';
import { XlsxRenderer } from './preview-renderers/xlsx-renderer';
import { PdfRenderer as PdfPreviewRenderer } from './preview-renderers/pdf-renderer';
import { toast } from 'sonner';
import { requiredEnv } from '@/lib/env-utils';
import { encodeStoragePath } from '@/lib/media-path';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';

import { useFileContent, useImageContent } from '@/hooks/react-query/files';
import { useAuth } from '@/components/AuthProvider';
import { Project } from '@/lib/api';

// Define basic file types
export type FileType =
    | 'image' | 'code' | 'text' | 'pdf'
    | 'audio' | 'video' | 'spreadsheet'
    | 'archive' | 'database' | 'markdown'
    | 'csv'
    | 'other';

// Simple extension-based file type detection
function getFileType(filename: string): FileType {
    const ext = filename.split('.').pop()?.toLowerCase() || '';

    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return 'image';
    if (['js', 'jsx', 'ts', 'tsx', 'html', 'css', 'json', 'py', 'java', 'c', 'cpp'].includes(ext)) return 'code';
    if (['txt', 'log', 'env'].includes(ext)) return 'text';
    if (['md', 'markdown'].includes(ext)) return 'markdown';
    if (ext === 'pdf') return 'pdf';
    if (['mp3', 'wav', 'ogg', 'flac'].includes(ext)) return 'audio';
    if (['mp4', 'webm', 'mov', 'avi'].includes(ext)) return 'video';
    if (['csv', 'tsv'].includes(ext)) return 'csv';
    if (['xls', 'xlsx'].includes(ext)) return 'spreadsheet';
    if (['zip', 'rar', 'tar', 'gz'].includes(ext)) return 'archive';
    if (['db', 'sqlite', 'sql'].includes(ext)) return 'database';

    return 'other';
}

// Get appropriate icon for file type
function getFileIcon(type: FileType): React.ElementType {
    const icons: Record<FileType, React.ElementType> = {
        image: FileImage,
        code: FileCode,
        text: FileText,
        markdown: FileText,
        pdf: FileType,
        audio: FileAudio,
        video: FileVideo,
        spreadsheet: FileSpreadsheet,
        csv: FileSpreadsheet,
        archive: Archive,
        database: Database,
        other: File
    };

    return icons[type];
}

// Generate a human-readable display name for file type
function getTypeLabel(type: FileType, extension?: string): string {
    if (type === 'code' && extension) {
        return extension.toUpperCase();
    }

    const labels: Record<FileType, string> = {
        image: 'Image',
        code: 'Code',
        text: 'Text',
        markdown: 'Markdown',
        pdf: 'PDF',
        audio: 'Audio',
        video: 'Video',
        spreadsheet: 'Spreadsheet',
        csv: 'CSV',
        archive: 'Archive',
        database: 'Database',
        other: 'File'
    };

    return labels[type];
}

function formatFileSize(bytes: number): string {
    if (!Number.isFinite(bytes)) return '';
    if (bytes < 1024) return `${Math.round(bytes)} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Get the API URL for file content
function getFileUrl(sandboxId: string | undefined, path: string): string {
    if (!sandboxId) return path;

    // Check if the path already starts with /workspace
    if (!path.startsWith('/workspace')) {
        // Prepend /workspace to the path if it doesn't already have it
        path = `/workspace/${path.startsWith('/') ? path.substring(1) : path}`;
    }

    // Handle any potential Unicode escape sequences
    try {
        // Replace escaped Unicode sequences with actual characters
        path = path.replace(/\\u([0-9a-fA-F]{4})/g, (_, hexCode) => {
            return String.fromCharCode(parseInt(hexCode, 16));
        });
    } catch (e) {
        console.error('Error processing Unicode escapes in path:', e);
    }

    const backendUrl = requiredEnv('NEXT_PUBLIC_BACKEND_URL');
    const url = new URL(`${backendUrl}/runtime/${sandboxId}/files/content`);

    // Properly encode the path parameter for UTF-8 support
    url.searchParams.append('path', path);

    return url.toString();
}

interface FileAttachmentProps {
    filepath: string;
    displayName?: string;
    fileSizeBytes?: number;
    onClick?: (path: string) => void;
    className?: string;
    sandboxId?: string;
    showPreview?: boolean;
    localPreviewUrl?: string;
    customStyle?: React.CSSProperties;
    /**
     * Controls whether HTML, Markdown, and CSV files show their content preview.
     * - true: files are shown as regular file attachments (default)
     * - false: HTML, MD, and CSV files show rendered content in grid layout
     */
    collapsed?: boolean;
    project?: Project;
    isSingleItemGrid?: boolean; // New prop to detect single item in grid
    standalone?: boolean; // New prop for minimal standalone styling
    alignRight?: boolean; // New prop to control right alignment
    shareThreadId?: string; // For public share pages, to authorize media proxy
}

// Cache fetched content between mounts to avoid duplicate fetches
// Content caches for file attachment optimization
// const contentCache = new Map<string, string>();
// const errorCache = new Set<string>();

export function FileAttachment({
    filepath,
    displayName,
    fileSizeBytes,
    onClick,
    className,
    sandboxId,
    showPreview = true,
    localPreviewUrl,
    customStyle,
    collapsed = true,
    project,
    isSingleItemGrid = false,
    standalone = false,
    alignRight = false,
    shareThreadId
}: FileAttachmentProps) {
    // Authentication 
    const { session } = useAuth();

    // Simplified state management
    const [hasError, setHasError] = React.useState(false);
    const authToken = session?.access_token;

    // XLSX sheet management
    const [xlsxSheetIndex, setXlsxSheetIndex] = React.useState(0);
    const [xlsxSheetNames, setXlsxSheetNames] = React.useState<string[]>([]);

    // Basic file info
    const deriveFilename = (raw: string, fallbackName?: string): string => {
        if (fallbackName) return fallbackName;
        const noQuery = raw.split('?')[0];
        try {
            const url = new URL(noQuery, 'http://localhost');
            const pathname = url.pathname || noQuery;
            const markerIndex = pathname.indexOf('/file-uploads/');
            if (markerIndex >= 0) {
                const decoded = decodeURIComponent(pathname.slice(markerIndex + '/file-uploads/'.length));
                const segment = decoded.split('/').pop() || decoded;
                return segment || 'file';
            }
            const segment = pathname.split('/').pop() || pathname;
            return decodeURIComponent(segment || 'file');
        } catch {
            const segment = noQuery.split('/').pop() || noQuery;
            try {
                return decodeURIComponent(segment || 'file');
            } catch {
                return segment || 'file';
            }
        }
    };

    const filename = deriveFilename(filepath, displayName);
    const extension = filename.split('.').pop()?.toLowerCase() || '';
    const fileType = getFileType(filename);
    const isSandboxFile = Boolean(sandboxId && (filepath.startsWith('/workspace') || filepath.startsWith('workspace/')));
    const sandboxPath = isSandboxFile
        ? (filepath.startsWith('/workspace') ? filepath : `/workspace/${filepath.replace(/^\//, '')}`)
        : undefined;
    // Build a robust URL for display/download
    const buildPublicMediaUrl = (input: string): string => {
        try {
            const isLikelyFileId = /^[0-9a-fA-F-]{36}$/.test(input);
            if (isLikelyFileId) return input;
            if (/^https?:\/\//i.test(input)) return input;
            // If already our media proxy, append thread_id if provided
            if (/\/api\/media\/file-uploads\//.test(input)) {
                const u = new URL(input, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
                if (shareThreadId && !u.searchParams.has('thread_id')) {
                    u.searchParams.append('thread_id', shareThreadId);
                }
                if (authToken && !u.searchParams.has('token')) {
                    u.searchParams.append('token', authToken);
                }
                return u.toString();
            }
            // If looks like a raw storage path (account_id/source/... or legacy), wrap with media proxy
            if ((!input.startsWith('/') && input.includes('/')) || input.startsWith('knowledge-base/')) {
                const base = `/api/media/file-uploads/${encodeStoragePath(input)}`;
                const params = new URLSearchParams();
                if (shareThreadId) params.set('thread_id', shareThreadId);
                if (authToken) params.set('token', authToken);
                const qs = params.toString();
                return qs ? `${base}?${qs}` : base;
            }
            // If it's an absolute Supabase storage URL, try to extract object path
            if (/\/storage\/v1\/object\//.test(input)) {
                const u = new URL(input);
                const parts = u.pathname.split('/');
                const idx = parts.indexOf('object');
                if (idx >= 0 && parts[idx + 2]) {
                    const bucket = parts[idx + 2];
                    const obj = decodeURIComponent(parts.slice(idx + 3).join('/'));
                    if (bucket === 'file-uploads' && obj) {
                        const base = `/api/media/file-uploads/${encodeStoragePath(obj)}`;
                        const params = new URLSearchParams();
                        if (shareThreadId) params.set('thread_id', shareThreadId);
                        if (authToken) params.set('token', authToken);
                        const qs = params.toString();
                        return qs ? `${base}?${qs}` : base;
                    }
                }
            }
        } catch {}
        return input;
    };

    const rawUrl = localPreviewUrl || (isSandboxFile && sandboxId ? getFileUrl(sandboxId, sandboxPath || filepath) : filepath);
    const fileUrl = isSandboxFile ? rawUrl : buildPublicMediaUrl(rawUrl);
    const typeLabel = getTypeLabel(fileType, extension);
    const fileSizeLabel = typeof fileSizeBytes === 'number' ? formatFileSize(fileSizeBytes) : '';
    const IconComponent = getFileIcon(fileType);

    // Display flags
    const isImage = fileType === 'image';
    const isHtmlOrMd = extension === 'html' || extension === 'htm' || extension === 'md' || extension === 'markdown';
    const isCsv = extension === 'csv' || extension === 'tsv';
    const isXlsx = extension === 'xlsx' || extension === 'xls';
    const isPdf = extension === 'pdf';
    const isGridLayout = customStyle?.gridColumn === '1 / -1' || Boolean(customStyle && ('--attachment-height' in customStyle));
    // Define isInlineMode early, before any hooks
    const isInlineMode = !isGridLayout;
    const shouldShowPreview = (isHtmlOrMd || isCsv || isXlsx || isPdf) && showPreview && collapsed === false;

    // Use the React Query hook to fetch file content
    // For CSV files, always try to load content for better preview experience
    // For XLSX files, we need binary data which is handled by useImageContent
    const shouldLoadContent = (isHtmlOrMd || isCsv) && (shouldShowPreview || isCsv);
    const {
        data: fileContent,
        isLoading: fileContentLoading,
        error: fileContentError
    } = useFileContent(
        shouldLoadContent && isSandboxFile ? sandboxId : undefined,
        shouldLoadContent && isSandboxFile ? sandboxPath || filepath : undefined
    );

    // Use the React Query hook to fetch image content with authentication
    const {
        data: imageUrl,
        isLoading: imageLoading,
        error: imageError
    } = useImageContent(
        isImage && showPreview && isSandboxFile && sandboxId ? sandboxId : undefined,
        isImage && showPreview ? (sandboxPath || filepath) : undefined
    );

    // For PDFs we also fetch blob URL via the same binary hook used for images
    const {
        data: pdfBlobUrl,
        isLoading: pdfLoading,
        error: pdfError
    } = useImageContent(
        isPdf && shouldShowPreview && isSandboxFile && sandboxId ? sandboxId : undefined,
        isPdf && shouldShowPreview ? (sandboxPath || filepath) : undefined
    );

    // For XLSX files we fetch binary data and convert to base64
    const {
        data: xlsxBlobUrl,
        isLoading: xlsxLoading,
        error: xlsxError
    } = useImageContent(
        isXlsx && shouldShowPreview && isSandboxFile && sandboxId ? sandboxId : undefined,
        isXlsx && shouldShowPreview ? (sandboxPath || filepath) : undefined
    );

    // Set error state based on query errors
    React.useEffect(() => {
        if (fileContentError || imageError || pdfError || xlsxError) {
            setHasError(true);
        }
    }, [fileContentError, imageError, pdfError, xlsxError]);

    // Prevent noisy UI when PDF preview fails: show toast once via effect
    const pdfErrorToastShownRef = React.useRef(false);
    React.useEffect(() => {
        if (isPdf && hasError && !pdfErrorToastShownRef.current) {
            try { toast.error('Failed to preview PDF file.'); } catch {}
            pdfErrorToastShownRef.current = true;
        }
    }, [isPdf, hasError]);

    // Parse XLSX to get sheet names when blob URL is available
    React.useEffect(() => {
        if (isXlsx && xlsxBlobUrl && shouldShowPreview) {
            const parseSheetNames = async () => {
                try {
                    // Import XLSX dynamically to avoid bundle size issues
                    const XLSX = await import('xlsx');

                    // Convert blob URL to binary data
                    const response = await fetch(xlsxBlobUrl);
                    const arrayBuffer = await response.arrayBuffer();

                    // Read workbook
                    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
                    setXlsxSheetNames(workbook.SheetNames);
                } catch (error) {
                    console.error('Failed to parse XLSX sheet names:', error);
                    setXlsxSheetNames([]);
                }
            };

            parseSheetNames();
        }
    }, [isXlsx, xlsxBlobUrl, shouldShowPreview]);

    const handleClick = () => {
        if (onClick) {
            onClick(filepath);
        }
    };

    const handleDownload = async (e: React.MouseEvent) => {
        e.stopPropagation(); // Prevent triggering the main click handler

        try {
            if (!isSandboxFile || !sandboxId || !session?.access_token) {
                // Fallback: open file URL in new tab
                window.open(fileUrl, '_blank');
                return;
            }

            // Use the same fetch logic as other components
            const backendUrl = requiredEnv('NEXT_PUBLIC_BACKEND_URL');
            const response = await fetch(`${backendUrl}/runtime/${sandboxId}/files/content?path=${encodeURIComponent(sandboxPath || filepath)}`, {
                headers: {
                    'Authorization': `Bearer ${session.access_token}`
                }
            });

            if (!response.ok) {
                throw new Error(`Download failed: ${response.status}`);
            }

            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Download failed:', error);
            // Fallback: try to open the file URL
            window.open(fileUrl, '_blank');
        }
    };

    const handlePdfPreviewError = React.useCallback(() => {
        setHasError(true);
        try { toast.error('Failed to preview PDF file.'); } catch {}
    }, []);

    // Helper: render the small inline chip (same style as ChatInput)
    const renderInlineChip = () => (
        <button
            onClick={handleClick}
            className={cn(
                "group flex rounded-xl transition-all duration-200 min-h-[54px] h-[54px] overflow-hidden cursor-pointer",
                "border border-black/10 dark:border-white/10",
                "bg-sidebar",
                "text-left",
                "pr-7",
                isInlineMode
                    ? "min-w-[170px] w-full sm:max-w-[300px] sm:w-fit"
                    : "min-w-[170px] max-w-[300px] w-fit",
                className
            )}
            style={{ ...(customStyle || {}) }}
            title={filename}
        >
            <div className="relative min-w-[54px] w-[54px] h-full aspect-square flex-shrink-0 bg-black/5 dark:bg-white/5">
                <div className="flex items-center justify-center h-full w-full">
                    <IconComponent className="h-5 w-5 text-black/60 dark:text-white/60" />
                </div>
            </div>

            <div className="flex-1 min-w-0 flex flex-col justify-center p-2 pl-3 overflow-hidden">
                <div className="text-sm font-medium text-foreground truncate max-w-full">
                    {filename}
                </div>
                <div className="text-xs text-muted-foreground flex items-center gap-1 truncate">
                    <span className="text-black/60 dark:text-white/60 truncate">{typeLabel}</span>
                    {fileSizeLabel ? (
                        <>
                            <span className="text-black/40 dark:text-white/40 flex-shrink-0">·</span>
                            <span className="text-black/60 dark:text-white/60 flex-shrink-0">{fileSizeLabel}</span>
                        </>
                    ) : null}
                </div>
            </div>
        </button>
    );

    // Images are displayed with their natural aspect ratio
    if (isImage && showPreview) {
        // Use custom height for images if provided through CSS variable
        const imageHeight = isGridLayout
            ? (customStyle as any)['--attachment-height'] as string
            : '54px';

        // Show loading state for images
        if (imageLoading && sandboxId) {
            return (
                <button
                    onClick={handleClick}
                    className={cn(
                        "group relative min-h-[54px] min-w-fit rounded-xl cursor-pointer",
                        "border border-black/10 dark:border-white/10",
                        "bg-black/5 dark:bg-black/20",
                        "p-0 overflow-hidden",
                        "flex items-center justify-center",
                        isGridLayout ? "w-full" : "min-w-[54px]",
                        className
                    )}
                    style={{
                        maxWidth: "100%",
                        height: isSingleItemGrid && isGridLayout ? 'auto' : (isGridLayout ? imageHeight : 'auto'),
                        maxHeight: isSingleItemGrid && isGridLayout ? '800px' : undefined,
                        minHeight: isGridLayout ? imageHeight : '54px',
                        ...customStyle
                    }}
                    title={filename}
                >
                    <div className="absolute inset-0 flex items-center justify-center">
                        <Loader2 className="h-8 w-8 text-primary animate-spin" />
                    </div>
                </button>
            );
        }

        // Check for errors
        if (imageError || hasError) {
            return (
                <button
                    onClick={handleClick}
                    className={cn(
                        "group relative min-h-[54px] min-w-fit rounded-xl cursor-pointer",
                        "border border-black/10 dark:border-white/10",
                        "bg-black/5 dark:bg-black/20",
                        "p-0 overflow-hidden",
                        "flex flex-col items-center justify-center gap-1",
                        isGridLayout ? "w-full" : "inline-block",
                        className
                    )}
                    style={{
                        maxWidth: "100%",
                        height: isSingleItemGrid && isGridLayout ? 'auto' : (isGridLayout ? imageHeight : 'auto'),
                        maxHeight: isSingleItemGrid && isGridLayout ? '800px' : undefined,
                        ...customStyle
                    }}
                    title={filename}
                >
                    <IconComponent className="h-6 w-6 text-red-500 mb-1" />
                    <div className="text-xs text-red-500">Failed to load image</div>
                </button>
            );
        }

        // Choose best available source in order: localPreviewUrl/fileUrl (http/blob) > sandbox imageUrl > none
        const preferredInline = (localPreviewUrl && typeof localPreviewUrl === 'string')
            ? localPreviewUrl
            : (typeof fileUrl === 'string' && (/^https?:/i.test(fileUrl) || fileUrl.startsWith('blob:'))
                ? fileUrl
                : undefined);
        const sandboxSrc = (sandboxId && session?.access_token) ? imageUrl : undefined;
        if (!preferredInline && !sandboxSrc) {
            return renderInlineChip();
        }
        const imgSrc = preferredInline || sandboxSrc || '';

        return (
            <button
                onClick={handleClick}
                className={cn(
                    "group relative min-h-[54px] rounded-2xl cursor-pointer",
                    "border border-black/10 dark:border-white/10",
                    "bg-black/5 dark:bg-black/20",
                    "p-0 overflow-hidden",
                    "flex items-center justify-center",
                    isGridLayout ? "w-full" : "inline-block",
                    className
                )}
                style={{
                    maxWidth: "100%",
                    height: isSingleItemGrid && isGridLayout ? 'auto' : (isGridLayout ? imageHeight : 'auto'),
                    maxHeight: isSingleItemGrid && isGridLayout ? '800px' : undefined,
                    ...customStyle
                }}
                title={filename}
            >
                <Image
                    src={imgSrc}
                    alt={filename}
                    width={1200}
                    height={800}
                    unoptimized
                    loader={({ src }) => src}
                    className={cn(
                        "max-h-full max-w-full",
                        isSingleItemGrid ? "object-contain" : isGridLayout ? "w-full h-full object-cover" : "w-auto"
                    )}
                    style={{
                        height: isSingleItemGrid ? 'auto' : imageHeight,
                        objectPosition: "center",
                        objectFit: isSingleItemGrid ? "contain" : isGridLayout ? "cover" : "contain"
                    }}
                    onError={(e) => {
                        console.error('Image load error for:', filename);
                        setHasError(true);
                        if (localPreviewUrl && typeof localPreviewUrl === 'string' && localPreviewUrl.startsWith('blob:')) {
                            (e.target as HTMLImageElement).src = localPreviewUrl;
                        }
                    }}
                    sizes="100vw"
                />
            </button>
        );
    }

    const rendererMap = {
        'html': HtmlRenderer,
        'htm': HtmlRenderer,
        'md': MarkdownRenderer,
        'markdown': MarkdownRenderer,
        'csv': CsvRenderer,
        'tsv': CsvRenderer,
        'xlsx': XlsxRenderer,
        'xls': XlsxRenderer
    };

    // HTML/MD/CSV/PDF preview when not collapsed and in grid layout
    if (shouldShowPreview && isGridLayout) {
        // Determine the renderer component
        const Renderer = rendererMap[extension as keyof typeof rendererMap];

        // Decide if we can actually render a meaningful preview; otherwise fall back to a simple filename row
        const pdfUrlAvailable = isPdf ? (localPreviewUrl || (sandboxId ? (pdfBlobUrl ?? null) : null)) : null;
        const xlsxUrlAvailable = isXlsx ? (localPreviewUrl || (sandboxId ? (xlsxBlobUrl ?? null) : null)) : null;
        const textContentReady = (isHtmlOrMd || isCsv) ? Boolean(fileContent) : true;
        const shouldFallbackToFilename = hasError
            || (isPdf && !pdfUrlAvailable)
            || (isXlsx && !xlsxUrlAvailable)
            || ((isHtmlOrMd || isCsv) && !textContentReady);

        if (shouldFallbackToFilename) {
            // Use inline chip style for fallback to keep UI consistent with ChatInput
            return (
                <div style={{ gridColumn: '1 / -1' }}>
                    {renderInlineChip()}
                </div>
            );
        }

        return (
            <div
                className={cn(
                    "group relative w-full",
                    // Rounded card with header space. Clip children to preserve rounded corners.
                    "rounded-xl border bg-card pt-10 overflow-hidden",
                    // Height constraints: keep within viewport; content will scroll inside
                    isPdf || isHtmlOrMd || isCsv || isXlsx || standalone
                        ? "min-h-[160px] max-h-[60vh]"
                        : "h-[300px]",
                    className
                )}
                style={{
                    gridColumn: "1 / -1", // Make it take full width in grid
                    width: "100%",        // Ensure full width within Dock
                    minWidth: 0,          // Prevent flex overflowing issues
                    ...customStyle
                }}
                onClick={hasError ? handleClick : undefined} // Make clickable if error
            >
                {/* Content area */}
                <div
                    className="h-full w-full relative overflow-y-auto overflow-x-hidden"
                    style={{
                        minWidth: 0,
                        width: '100%',
                        containIntrinsicSize: (isPdf || isHtmlOrMd) ? '100% 500px' : undefined,
                        contain: (isPdf || isHtmlOrMd) ? 'layout size' : undefined
                    }}
                >
                    {/* Render PDF, XLSX, or text-based previews */}
                    {!hasError && (
                        <>
                            {isPdf && (() => {
                                const pdfUrlForRender = pdfUrlAvailable;
                                return pdfUrlForRender ? (
                                    <PdfPreviewRenderer
                                        url={pdfUrlForRender}
                                        className="h-full w-full"
                                        onError={handlePdfPreviewError}
                                    />
                                ) : null;
                            })()}
                            {isXlsx && (() => {
                                const xlsxUrlForRender = xlsxUrlAvailable;
                                return xlsxUrlForRender ? (
                                    <XlsxRenderer
                                        content={xlsxUrlForRender}
                                        className="h-full w-full"
                                        activeSheetIndex={xlsxSheetIndex}
                                        onSheetChange={(index) => setXlsxSheetIndex(index)}
                                    />
                                ) : null;
                            })()}
                            {!isPdf && !isXlsx && fileContent && Renderer && (
                                <Renderer
                                    content={fileContent}
                                    previewUrl={fileUrl}
                                    className="h-full w-full"
                                    project={project}
                                />
                            )}
                        </>
                    )}

                    {/* Error state */}
                    {hasError && (
                        <div className="h-full w-full flex flex-col items-center justify-center p-4">
                            <div className="text-red-500 mb-2">Error loading content</div>
                            <div className="text-muted-foreground text-sm text-center mb-2">
                                {fileUrl && (
                                    <div className="text-xs max-w-full overflow-hidden truncate opacity-70">
                                        Path may need /workspace prefix
                                    </div>
                                )}
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={handleDownload}
                                    className="px-3 py-1.5 bg-secondary/10 hover:bg-secondary/20 rounded-md text-sm flex items-center gap-1"
                                >
                                    <Download size={14} />
                                    Download
                                </button>
                                <button
                                    onClick={handleClick}
                                    className="px-3 py-1.5 bg-primary/10 hover:bg-primary/20 rounded-md text-sm flex items-center gap-1"
                                >
                                    <ExternalLink size={14} />
                                    Open in viewer
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Loading state */}
                    {fileContentLoading && !isPdf && (
                        <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-10">
                            <Loader2 className="h-8 w-8 text-primary animate-spin" />
                        </div>
                    )}

                    {isPdf && pdfLoading && !pdfBlobUrl && (
                        <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-10">
                            <Loader2 className="h-8 w-8 text-primary animate-spin" />
                        </div>
                    )}

                    {isXlsx && xlsxLoading && !xlsxBlobUrl && (
                        <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-10">
                            <Loader2 className="h-8 w-8 text-primary animate-spin" />
                        </div>
                    )}

                    {/* Empty content state - show when not loading and no content yet */}
                    {!isPdf && !isXlsx && !fileContent && !fileContentLoading && !hasError && (
                        <div className="h-full w-full flex flex-col items-center justify-center p-4 pointer-events-none">
                            <div className="text-muted-foreground text-sm mb-2">
                                Preview available
                            </div>
                            <div className="text-muted-foreground text-xs text-center">
                                Click header to open externally
                            </div>
                        </div>
                    )}
                </div>

                {/* Header with filename */}
                <div className="absolute top-0 left-0 right-0 bg-accent p-2 h-[40px] z-10 flex items-center justify-between rounded-t-xl">
                    <div className="flex items-center gap-2 min-w-0">
                        <div className="text-sm font-medium truncate">{filename}</div>
                        {/* XLSX Sheet Selector */}
                        {isXlsx && xlsxSheetNames.length > 1 && (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <button className="flex items-center gap-1 px-2 py-1 rounded-xl hover:bg-background/70 text-xs font-medium transition-colors">
                                        <span className="truncate max-w-[100px]">{xlsxSheetNames[xlsxSheetIndex] || 'Sheet 1'}</span>
                                        <ChevronDown size={12} />
                                    </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start" className="min-w-[120px]">
                                    {xlsxSheetNames.map((sheetName, index) => (
                                        <DropdownMenuItem
                                            key={index}
                                            onClick={() => setXlsxSheetIndex(index)}
                                            className={cn(
                                                "text-xs cursor-pointer",
                                                index === xlsxSheetIndex && "bg-accent"
                                            )}
                                        >
                                            {sheetName}
                                        </DropdownMenuItem>
                                    ))}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        )}
                    </div>
                    <div className="flex items-center gap-1">
                        {/* <button
                            onClick={handleDownload}
                            className="cursor-pointer p-1 rounded-full hover:bg-black/10 dark:hover:bg-white/10"
                            title="Download file"
                        >
                            <Download size={14} />
                        </button> */}
                        {onClick && (
                            <button
                                onClick={handleClick}
                                className="cursor-pointer p-1 rounded-full hover:bg-black/10 dark:hover:bg-white/10"
                                title="Open in viewer"
                            >
                                <ExternalLink size={14} />
                            </button>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    // Regular files with details
    const safeStyle = { ...customStyle };
    delete safeStyle.height;
    delete (safeStyle as any)['--attachment-height'];

    const fileButton = renderInlineChip();

    // Wrap with alignment container if alignRight is true
    if (alignRight) {
        return (
            <div className="w-full flex justify-end">
                <div className="max-w-[85%]">
                    {fileButton}
                </div>
            </div>
        );
    }

    return fileButton;
}

interface SimpleUploadedFile {
    name?: string;
    path: string;
    size?: number;
    type?: string;
    fileUrl?: string;
    localUrl?: string;
    fileId?: string;
}

interface FileAttachmentGridProps {
    attachments: Array<string | SimpleUploadedFile>;
    onFileClick?: (path: string, filePathList?: string[], file?: string | SimpleUploadedFile) => void;
    className?: string;
    sandboxId?: string;
    showPreviews?: boolean;
    collapsed?: boolean;
    project?: Project;
    standalone?: boolean;
    alignRight?: boolean;
    shareThreadId?: string;
}

export function FileAttachmentGrid({
    attachments,
    onFileClick,
    className,
    sandboxId,
    showPreviews = true,
    collapsed = false,
    project,
    standalone = false,
    alignRight = false,
    shareThreadId
}: FileAttachmentGridProps) {
    if (!attachments || attachments.length === 0) return null;

    // For standalone rendering, always expand previews to show content
    const shouldCollapse = standalone ? false : collapsed;

    const content = (
        <AttachmentGroup
            files={attachments}
            onFileClick={onFileClick}
            className={className}
            sandboxId={sandboxId}
            showPreviews={showPreviews}
            layout="grid"
            gridImageHeight={standalone ? 500 : 150} // Larger height for standalone files
            collapsed={shouldCollapse}
            project={project}
            standalone={standalone}
            alignRight={alignRight}
            shareThreadId={shareThreadId}
        />
    );

    // Wrap with alignment container if alignRight is true
    if (alignRight) {
        return (
            <div className="w-full flex justify-end">
                <div className="max-w-[85%]">
                    {content}
                </div>
            </div>
        );
    }

    return content;
} 
