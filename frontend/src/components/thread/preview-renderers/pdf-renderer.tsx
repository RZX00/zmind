'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { cn } from '@/lib/utils';
import '@/lib/polyfills'; // Import polyfill for Promise.withResolvers
import { Document, Page, pdfjs } from 'react-pdf';

// Import styles for annotations and text layer
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

type PreflightEntry = { ok: boolean; ts: number };
const PREFLIGHT_TTL_MS = 60_000;
const preflightCache = new Map<string, PreflightEntry>();

// Internal component that uses react-pdf
interface PdfDocumentProps {
    url: string;
    containerWidth: number | null;
    onError?: (error: Error) => void;
}

const PdfDocument = ({ url, containerWidth, onError }: PdfDocumentProps) => {
    // Configure PDF.js worker
    React.useEffect(() => {
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
            'pdfjs-dist/build/pdf.worker.min.mjs',
            import.meta.url,
        ).toString();
    }, []);

    return (
        <Document
            file={url}
            className="shadow-none"
            onLoadError={(e) => { try { onError?.(e as any); } catch {} }}
            onSourceError={(e) => { try { onError?.(e as any); } catch {} }}
        >
            <Page
                pageNumber={1}
                width={containerWidth ?? undefined}
                renderTextLayer={true}
                renderAnnotationLayer={true}
                className="border border-border rounded bg-white"
            />
        </Document>
    );
};

// Dynamic import to avoid SSR issues
const DynamicPdfDocument = dynamic(() => Promise.resolve(PdfDocument), {
    ssr: false,
    loading: () => (
        <div className="w-full h-full flex items-center justify-center bg-muted/20">
            <div className="text-sm text-muted-foreground">Loading PDF...</div>
        </div>
    )
});

interface PdfRendererProps {
    url?: string | null;
    className?: string;
    onError?: () => void;
}

// Minimal inline PDF preview for attachment grid. No toolbar. First page only.
export function PdfRenderer({ url, className, onError }: PdfRendererProps) {
    const [containerWidth, setContainerWidth] = React.useState<number | null>(null);
    const wrapperRef = React.useRef<HTMLDivElement | null>(null);
    const [status, setStatus] = React.useState<'idle' | 'checking' | 'ready' | 'failed'>('idle');
    const onErrorRef = React.useRef(onError);

    React.useEffect(() => {
        onErrorRef.current = onError;
    }, [onError]);

    React.useEffect(() => {
        if (!wrapperRef.current) return;
        const element = wrapperRef.current;
        const setWidth = () => {
            const nextWidth = element.clientWidth;
            setContainerWidth((prev) => (prev === nextWidth ? prev : nextWidth));
        };
        setWidth();
        const observer = new ResizeObserver(() => setWidth());
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    React.useEffect(() => {
        if (!url) {
            setStatus((prev) => (prev === 'failed' ? prev : 'failed'));
            return;
        }
        let cancelled = false;
        const cached = preflightCache.get(url);
        if (cached && Date.now() - cached.ts < PREFLIGHT_TTL_MS) {
            const nextStatus = cached.ok ? 'ready' : 'failed';
            setStatus((prev) => (prev === nextStatus ? prev : nextStatus));
            return;
        }
        setStatus((prev) => (prev === 'checking' ? prev : 'checking'));
        const controller = new AbortController();
        fetch(url, {
            method: 'GET',
            cache: 'no-store',
            redirect: 'manual',
            headers: { Range: 'bytes=0-0' },
            signal: controller.signal,
        })
            .then((resp) => {
                if (cancelled) return;
                const ok = resp.ok
                    || resp.type === 'opaqueredirect'
                    || [301, 302, 303, 307, 308].includes(resp.status);
                try { resp.body?.cancel(); } catch {}
                preflightCache.set(url, { ok, ts: Date.now() });
                const nextStatus = ok ? 'ready' : 'failed';
                setStatus((prev) => (prev === nextStatus ? prev : nextStatus));
                if (!ok) {
                    try { onErrorRef.current?.(); } catch {}
                }
            })
            .catch(() => {
                if (cancelled) return;
                preflightCache.set(url, { ok: false, ts: Date.now() });
                setStatus((prev) => (prev === 'failed' ? prev : 'failed'));
                try { onErrorRef.current?.(); } catch {}
            });
        return () => {
            cancelled = true;
            controller.abort();
        };
    }, [url]);

    if (!url || status === 'failed') {
        return (
            <div className={cn('w-full h-full flex items-center justify-center bg-muted/20', className)} />
        );
    }

    if (status !== 'ready') {
        return (
            <div className={cn('w-full h-full flex items-center justify-center bg-muted/20', className)}>
                <div className="text-xs text-muted-foreground">Loading preview...</div>
            </div>
        );
    }

    return (
        <div ref={wrapperRef} className={cn('w-full h-full overflow-auto bg-background', className)}>
            <div className="flex justify-center">
                <DynamicPdfDocument
                    url={url}
                    containerWidth={containerWidth}
                    onError={() => {
                        setStatus((prev) => (prev === 'failed' ? prev : 'failed'));
                        preflightCache.set(url, { ok: false, ts: Date.now() });
                        try { onErrorRef.current?.(); } catch {}
                    }}
                />
            </div>
        </div>
    );
}


