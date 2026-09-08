import { siteConfig } from '@/lib/home';
import { Link } from '@/i18n/routing';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { ContactDialog } from '@/components/home/contact-dialog';

export function CTASection() {
  const { ctaSection } = siteConfig;
  const t = useTranslations();

  return (
    <section
      id="cta"
      className="flex w-full flex-col items-center justify-center bg-transparent pt-12 pb-12 dark:bg-transparent"
    >
      <div className="w-full">
        <div className="w-full">
          <div className="h-[300px] md:h-[400px] overflow-hidden shadow-xl w-full border border-border bg-brand-600 relative z-20">
          <div className="absolute inset-0 -top-32 md:-top-40 flex flex-col items-center justify-center">
            <h1 className="text-white text-4xl md:text-7xl font-medium tracking-tighter max-w-xs md:max-w-xl text-center">
              {t('home.cta.title')}
            </h1>
            <div className="absolute bottom-10 flex flex-col items-center justify-center gap-3">
              <div className="flex items-center justify-center gap-3 flex-wrap">
                <Button
                  asChild
                  size="lg"
                  className="h-12 px-8 font-semibold text-base rounded-none bg-foreground text-background hover:bg-foreground/90"
                >
                  <Link href={ctaSection.button.href}>
                    {t('home.cta.button')}
                  </Link>
                </Button>
                <ContactDialog
                  trigger={
                    <Button
                      size="lg"
                      variant="secondary"
                      className="h-12 px-8 font-semibold text-base rounded-none border border-white/60 bg-white/30 text-white hover:bg-white/40 hover:text-white"
                    >
                      {t('home.cta.contactButton')}
                    </Button>
                  }
                />
              </div>
              <span className="text-white text-sm">{t('home.cta.subtext')}</span>
            </div>
          </div>
          </div>
        </div>
      </div>
    </section>
  );
}
