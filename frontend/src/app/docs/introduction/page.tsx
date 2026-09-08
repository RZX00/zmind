'use client';

import * as React from 'react';
import { 
  DocsHeader,
  DocsCard,
  DocsBody,
  DocsImage
} from '@/components/ui/docs-index';
import { useTheme } from 'next-themes';
import { Separator } from '@/components/ui/separator';
import { Card, CardHeader } from '@/components/ui/card';
import { ArrowRight, Bot, Lightbulb } from 'lucide-react';
import {useTranslations} from 'next-intl';
import { useRouter } from '@/i18n/routing';

function useBreadcrumbs(
  t: ReturnType<typeof useTranslations>,
  onDocsClick: () => void,
) {
  return [
    { title: t('docs.breadcrumbs.docs'), onClick: onDocsClick },
    { title: t('docs.breadcrumbs.introduction') }
  ];
}

export default function IntroductionPage() {
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  const t = useTranslations();
  const breadcrumbs = useBreadcrumbs(t, () => router.push('/docs'));

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const imageSrc = !mounted
    ? '/thumbnail-light.png'
    : resolvedTheme === 'dark'
      ? '/thumbnail-dark.png'
      : '/thumbnail-light.png';

  return (
    <>
      <DocsHeader
        title={t('docs.intro.header.title')}
        subtitle={t('docs.intro.header.subtitle')}
        breadcrumbs={breadcrumbs}
        lastUpdated={t('docs.intro.header.lastUpdated')}
        showSeparator
        size="lg"
        className="mb-8 sm:mb-12"
      />

      <DocsImage
        src={imageSrc}
        alt={t('docs.intro.imageAlt')}
        size="full"
        aspect="video"
        className="mb-12"
      />
    
      <DocsBody className="mb-8">
        <h2 id="positioning">{t('docs.intro.overviewTitle')}</h2>
        <p className="text-lg mb-6">
          {t('docs.intro.overviewP1')}
        </p>
        
        <h3 id="core-value">{t('docs.intro.meet.title')}</h3>
        <p className="mb-4">
          {t('docs.intro.meet.p1')}
        </p>
        <ul className="list-disc pl-6 mb-6 space-y-1">
          <li>{t('docs.intro.meet.li1')}</li>
          <li>{t('docs.intro.meet.li2')}</li>
          <li>{t('docs.intro.meet.li3')}</li>
          <li>{t('docs.intro.meet.li4')}</li>
          <li>{t('docs.intro.meet.li5')}</li>
        </ul>
        <p className="mb-6">
          {t('docs.intro.meet.p2')}
        </p>
  
        <h3 id="audience" className="mb-4">{t('docs.intro.build.title')}</h3>
        <p className="mb-4">
          {t('docs.intro.build.p')}
        </p>
        <ul className="list-disc pl-6 mb-6 space-y-2">
          <li>{t('docs.intro.build.li1')}</li>
          <li>{t('docs.intro.build.li2')}</li>
          <li>{t('docs.intro.build.li3')}</li>
        </ul>

        <h3 id="capability" className="mb-4">{t('docs.intro.how.title')}</h3>
        <p className="mb-4">{t('docs.intro.how.p')}</p>
        <ul className="list-disc pl-6 mb-6 space-y-2">
          <li>{t('docs.intro.how.li1')}</li>
          <li>{t('docs.intro.how.li2')}</li>
          <li>{t('docs.intro.how.li3')}</li>
          <li>{t('docs.intro.how.li4')}</li>
        </ul>
        
        <h3 id="experience" className="mb-4">{t('docs.intro.why.title')}</h3>
        <p className="mb-4">
          {t('docs.intro.why.p')}
        </p>
        <ul className="list-disc pl-6 mb-6 space-y-2">
          <li>{t('docs.intro.why.li1')}</li>
          <li>{t('docs.intro.why.li2')}</li>
          <li>{t('docs.intro.why.li3')}</li>
        </ul>
      </DocsBody>
      <Separator className="my-6 w-full" />
      <div className='w-full items-center justify-end flex pb-8'>
        <Card onClick={() => router.push('/')} className="p-2 group rounded-xl w-full lg:w-[400px] hover:opacity-80 transition-opacity">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center gap-2 bg-primary/10 w-12 h-12 rounded-xl">
                <Lightbulb className="w-6 h-6 text-primary" />
              </div>
            <h3 className="text-lg font-semibold">{t('docs.intro.cta.title')}</h3>
          </div>
            <ArrowRight className="w-4 h-4 mr-2 group-hover:translate-x-1 transition-transform" />
          </div>
        </Card>
      </div>
    </>
  );
} 
