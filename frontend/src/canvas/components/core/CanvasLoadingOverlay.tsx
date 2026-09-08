import React from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

type CanvasLoadingStatus = 'loading' | 'slow' | 'error';

interface CanvasLoadingOverlayProps {
  visible: boolean;
  title?: string | null;
  status?: CanvasLoadingStatus;
  message?: string;
  onRetry?: () => void;
  onClearLocal?: () => void;
  busy?: boolean;
}

const defaultMessages: Record<Exclude<CanvasLoadingStatus, 'error'>, string> = {
  loading: 'Preparing your canvas… Please hold on.',
  slow: 'This is taking longer than expected. Still working…',
};

const CanvasLoadingOverlay: React.FC<CanvasLoadingOverlayProps> = ({
  visible,
  title,
  status = 'loading',
  message,
  onRetry,
  onClearLocal,
  busy,
}) => {
  if (!visible) return null;

  const heading = title ? `Opening “${title}”` : 'Opening canvas';
  const subtitle =
    status === 'error'
      ? message || 'Unable to open this canvas. Please refresh or try again later.'
      : defaultMessages[status];

  const showSpinner = status !== 'error';

  return (
    <div
      className="absolute inset-0 z-[200] flex flex-col items-center justify-center gap-4 bg-background/65 backdrop-blur-xl px-6 text-center"
      role="status"
      aria-live="assertive"
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-full border border-white/15 bg-white/10 mx-auto">
        {showSpinner ? (
          <Loader2 className="h-8 w-8 animate-spin text-[#8c8273]" aria-hidden="true" />
        ) : (
          <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden="true" />
        )}
      </div>
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold text-foreground font-mono">{heading}</h2>
        <p
          className={cn(
            'text-base font-mono',
            status === 'error' ? 'text-destructive' : 'text-foreground/80'
          )}
        >
          {subtitle}
        </p>
      </div>
      {status === 'error' && (
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            className="px-3 py-1.5 rounded-md border bg-background text-foreground hover:bg-accent/20 disabled:opacity-60"
            onClick={() => { try { onRetry && onRetry(); } catch {} }}
            disabled={!!busy}
          >
            {busy ? 'Retrying…' : 'Retry without cache'}
          </button>
          <button
            type="button"
            className="px-3 py-1.5 rounded-md border bg-background text-foreground hover:bg-accent/20 disabled:opacity-60"
            onClick={() => { try { onClearLocal && onClearLocal(); } catch {} }}
            disabled={!!busy}
          >
            Clear local state
          </button>
        </div>
      )}
    </div>
  );
};

export default CanvasLoadingOverlay;
