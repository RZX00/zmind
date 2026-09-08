'use client';

import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ScreenshotAspect } from '../../domain/screenshot/types';

interface ScreenshotPanelProps {
  isOpen: boolean;
  loading: boolean;
  screenshotUrl: string | null;
  aspect: ScreenshotAspect;
  message: string | null;
  hasBlob: boolean;
  aspectOptions: ScreenshotAspect[];
  onClose: () => void;
  onRetry: () => void;
  onDownload: () => void;
  onAspectChange: (aspect: ScreenshotAspect) => void;
}

export const ScreenshotPanel: React.FC<ScreenshotPanelProps> = ({
  isOpen,
  loading,
  screenshotUrl,
  aspect,
  message,
  hasBlob,
  aspectOptions,
  onClose,
  onRetry,
  onDownload,
  onAspectChange,
}) => {
  const t = useTranslations();
  if (!isOpen) return null;

  return (
    <div className="fixed top-20 right-4 z-[95] w-80" data-screenshot-exclude="true" data-export-exclude="true">
      <div className="rounded-2xl border bg-background shadow-xl">
        <div className="flex items-center justify-between px-3 py-2">
          <div className="text-sm font-semibold text-foreground">{t('canvas.screenshot.title', { default: 'Screenshot' })}</div>
          <button
            className="h-7 w-7 rounded-md hover:bg-muted flex items-center justify-center text-muted-foreground"
            onClick={onClose}
            aria-label={t('canvas.screenshot.close', { default: 'Close' })}
          >
            <X size={14} />
          </button>
        </div>

        <div className="px-3 pb-3 space-y-3">
          <div
            className="w-full overflow-hidden rounded-lg border bg-muted/40 flex items-center justify-center"
            style={{
              aspectRatio: aspect === '4:3' ? '4 / 3' : aspect === '1:1' ? '1 / 1' : '16 / 9',
            }}
          >
            {loading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('canvas.screenshot.capturing', { default: 'Capturing...' })}
              </div>
            ) : screenshotUrl ? (
              <Image
                src={screenshotUrl}
                alt="Screenshot preview"
                width={1200}
                height={675}
                className="h-full w-full object-cover"
                unoptimized
                loader={({ src }) => src}
              />
            ) : (
              <div className="text-xs text-muted-foreground">
                {t('canvas.screenshot.noPreview', { default: 'Click the camera to capture the canvas.' })}
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {aspectOptions.map((opt) => (
              <button
                key={opt}
                type="button"
                className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                  aspect === opt
                    ? 'bg-foreground text-background border-foreground'
                    : 'bg-background text-foreground hover:border-foreground/50'
                } ${loading ? 'opacity-60 cursor-not-allowed' : ''}`}
                onClick={() => onAspectChange(opt)}
                disabled={loading}
              >
                {opt === 'original' ? t('canvas.screenshot.aspect.original', { default: 'Original' }) : opt}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onRetry} disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t('canvas.screenshot.retry', { default: 'Retake' })}
            </Button>
            <Button size="sm" onClick={onDownload} disabled={!hasBlob}>
              {t('canvas.screenshot.download', { default: 'Download' })}
            </Button>
          </div>

          <div className="text-xs text-muted-foreground min-h-[16px]">
            {message || t('canvas.screenshot.copyHint', { default: 'Copied to clipboard when possible. Download is always available.' })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ScreenshotPanel;
