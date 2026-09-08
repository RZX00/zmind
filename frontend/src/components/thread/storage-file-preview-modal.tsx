'use client';

import { useState, useEffect, useMemo } from 'react';
import Image from 'next/image';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PdfRenderer } from '@/components/thread/preview-renderers/pdf-renderer';
import { HtmlRenderer } from '@/components/thread/preview-renderers/html-renderer';
import { MarkdownRenderer } from '@/components/thread/preview-renderers/file-preview-markdown-renderer';
import { createClient } from '@/lib/supabase/client';
import { Loader2, Download, FileWarning } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { encodeStoragePath } from '@/lib/media-path';

interface StoragePreviewFile {
    path: string;
    name?: string;
}

interface StorageFilePreviewModalProps {
    open: boolean;
    file: StoragePreviewFile | null;
    onClose: () => void;
}

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp'];
const MARKDOWN_EXTENSIONS = ['md', 'markdown'];
const HTML_EXTENSIONS = ['html', 'htm'];
const CODE_EXTENSIONS = ['js', 'jsx', 'ts', 'tsx', 'py', 'java', 'c', 'cpp', 'css', 'json', 'xml', 'yaml', 'yml', 'sh', 'rb', 'php', 'go', 'rs'];
const TEXT_EXTENSIONS = ['txt', 'log', 'csv'];

function deriveFilename(path: string | undefined, fallback?: string): string {
    if (fallback) return fallback;
    if (!path) return 'file';
    try {
        const url = new URL(path, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
        const pathname = url.pathname || path;
        const markerIndex = pathname.indexOf('/file-uploads/');
        if (markerIndex >= 0) {
            const decoded = decodeURIComponent(pathname.slice(markerIndex + '/file-uploads/'.length));
            const segment = decoded.split('/').pop() || decoded;
            return segment || 'file';
        }
        const segment = pathname.split('/').pop() || pathname;
        return decodeURIComponent(segment || 'file');
    } catch {
        const clean = path.split('?')[0];
        const segment = clean.split('/').pop() || clean;
        try {
            return decodeURIComponent(segment || 'file');
        } catch {
            return segment || 'file';
        }
    }
}

function toAbsoluteMediaUrl(rawPath: string): string {
    if (/^https?:\/\//i.test(rawPath)) return rawPath;
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    if (rawPath.startsWith('/')) {
        return origin ? `${origin}${rawPath}` : rawPath;
    }
    if (rawPath.startsWith('api/')) {
        return origin ? `${origin}/${rawPath}` : `/${rawPath}`;
    }
    const encoded = encodeStoragePath(rawPath);
    const path = `/api/media/file-uploads/${encoded}`;
    return origin ? `${origin}${path}` : path;
}

export function StorageFilePreviewModal({ open, file, onClose }: StorageFilePreviewModalProps) {
    const [isLoading, setIsLoading] = useState(false);
    const [textContent, setTextContent] = useState<string | null>(null);
    const [blobUrl, setBlobUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const { session } = useAuth();
    const authToken = session?.access_token;

    const filename = useMemo(() => deriveFilename(file?.path, file?.name), [file]);
    const extension = useMemo(() => filename.split('.').pop()?.toLowerCase() || '', [filename]);
    const isPdf = extension === 'pdf';
    const isImage = IMAGE_EXTENSIONS.includes(extension);
    const isMarkdown = MARKDOWN_EXTENSIONS.includes(extension);
    const isHtml = HTML_EXTENSIONS.includes(extension);
    const isCode = CODE_EXTENSIONS.includes(extension);
    const isPlainText = TEXT_EXTENSIONS.includes(extension);
    const isUnsupported = ['doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx'].includes(extension) && !isPdf;

    useEffect(() => {
        if (!open) {
            if (blobUrl) {
                URL.revokeObjectURL(blobUrl);
            }
            setBlobUrl(null);
            setTextContent(null);
            setError(null);
            return;
        }

        if (!file?.path || isUnsupported) return;

        let cancelled = false;
        const loadContent = async () => {
            setIsLoading(true);
            setError(null);
            setTextContent(null);
            if (blobUrl) {
                URL.revokeObjectURL(blobUrl);
                setBlobUrl(null);
            }

            try {
                const supabase = createClient();
                const { data: { session } } = await supabase.auth.getSession();
                const headers: Record<string, string> = {};
                if (session?.access_token) {
                    headers['Authorization'] = `Bearer ${session.access_token}`;
                }

                const resolvedUrl = toAbsoluteMediaUrl(file.path);
                const response = await fetch(resolvedUrl, {
                    headers,
                    credentials: 'include',
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                if (isPdf || isImage) {
                    const blob = await response.blob();
                    if (cancelled) return;
                    const url = URL.createObjectURL(blob);
                    setBlobUrl(url);
                } else {
                    const text = await response.text();
                    if (cancelled) return;
                    setTextContent(text);
                }
            } catch (err) {
                if (cancelled) return;
                console.error('Failed to load storage file:', err);
                setError(err instanceof Error ? err.message : String(err));
            } finally {
                if (!cancelled) {
                    setIsLoading(false);
                }
            }
        };

        loadContent();

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, file?.path, isPdf, isImage, isUnsupported]);

    const downloadUrl = useMemo(() => {
        if (!file?.path) return null;
        const base = toAbsoluteMediaUrl(file.path);
        if (!authToken) return base;
        try {
            const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
            const u = new URL(base, origin);
            if (u.pathname.startsWith('/api/media/') && !u.searchParams.has('token')) {
                u.searchParams.append('token', authToken);
            }
            return u.toString();
        } catch {
            return base;
        }
    }, [file?.path, authToken]);

    const renderContent = () => {
        if (isLoading) {
            return (
                <div className="space-y-2 p-4">
                    {[1, 2, 3, 4, 5].map((i) => (
                        <Skeleton key={i} className="h-4 w-full" />
                    ))}
                </div>
            );
        }

        if (error) {
            return (
                <div className="flex flex-col gap-2 p-4 items-center text-muted-foreground">
                    <FileWarning className="h-6 w-6" />
                    <p>无法加载文件：{error}</p>
                </div>
            );
        }

        if (isUnsupported) {
            return (
                <div className="flex flex-col gap-2 p-4 items-center text-muted-foreground text-sm text-center">
                    <FileWarning className="h-6 w-6" />
                    <p>暂不支持此文件类型的在线预览，请下载后查看。</p>
                </div>
            );
        }

        if (isPdf && blobUrl) {
            return (
                <div className="w-full h-full">
                    <PdfRenderer url={blobUrl} className="w-full h-full" />
                </div>
            );
        }

        if (isImage && blobUrl) {
            return (
                <div className="w-full h-full flex items-center justify-center bg-black/5">
                    <Image
                      src={blobUrl}
                      alt={filename}
                      width={1200}
                      height={800}
                      unoptimized
                      loader={({ src }) => src}
                      className="max-w-full max-h-full object-contain"
                      sizes="100vw"
                    />
                </div>
            );
        }

        if (textContent) {
            if (isMarkdown) {
                return (
                    <MarkdownRenderer
                        content={textContent}
                        previewUrl=""
                        className="h-full w-full overflow-auto p-3"
                    />
                );
            }
            if (isHtml) {
                return (
                    <HtmlRenderer
                        content={textContent}
                        previewUrl=""
                        className="h-full w-full overflow-auto"
                    />
                );
            }

            const codeLike = isCode;
            return (
                <pre className={`text-xs whitespace-pre-wrap p-3 h-full overflow-auto ${codeLike ? 'bg-muted/30 rounded-md' : ''}`}>
                    {textContent}
                </pre>
            );
        }

        if (!isLoading) {
            return (
                <div className="flex flex-col gap-2 p-4 items-center text-muted-foreground">
                    <FileWarning className="h-6 w-6" />
                    <p>没有可显示的预览内容。</p>
                </div>
            );
        }

        return null;
    };

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[900px] max-h-[90vh] overflow-hidden flex flex-col">
                <DialogHeader className="flex flex-row items-center justify-between">
                    <DialogTitle>{filename}</DialogTitle>
                    {downloadUrl && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                                try {
                                    window.open(downloadUrl, '_blank', 'noopener,noreferrer');
                                } catch (err) {
                                    console.error('Failed to open download link:', err);
                                }
                            }}
                        >
                            <Download className="h-4 w-4 mr-1" />
                            下载
                        </Button>
                    )}
                </DialogHeader>
                <div className="flex-1 min-h-[400px] border rounded-xl overflow-hidden relative bg-background">
                    {isLoading && (
                        <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-10">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                    )}
                    {renderContent()}
                </div>
            </DialogContent>
        </Dialog>
    );
}
