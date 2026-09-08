"use client";

import { Button } from '@/components/ui/button';
import { buildTeamUrl } from '@/lib/team-url';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

type Props = {
  inputId: string; // the slug input element id
  origin?: string;
};

export default function TeamUrlCopyButton({ inputId, origin }: Props) {
  const t = useTranslations('teamSettings');
  const handleCopy = async () => {
    try {
      const el = document.getElementById(inputId) as HTMLInputElement | null;
      const slug = (el?.value || '').replace(/^\/+|\/+$/g, '');
      const runtimeOrigin =
        typeof window !== 'undefined' ? window.location.origin : origin;
      const url = buildTeamUrl(slug, runtimeOrigin);
      await navigator.clipboard.writeText(url);
      toast.success(t('url.copySuccess'));
    } catch (e) {
      console.error('Copy failed', e);
      toast.error(t('url.copyFailed'));
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="h-9 w-9 rounded-md shrink-0"
      onClick={handleCopy}
      aria-label={t('url.copyAria')}
      title={t('url.copyTitle')}
    >
      <Copy className="size-4" />
    </Button>
  );
}

