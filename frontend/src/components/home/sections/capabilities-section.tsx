'use client';

import { SectionHeader } from '@/components/home/section-header';
import { motion, useInView } from 'motion/react';
import { useRef } from 'react';
import { useTranslations } from 'next-intl';
import { SpotlightCard } from '@/components/home/ui/spotlight-card';
import { 
  FileText,
  Image as ImageIcon,
  Presentation,
  Globe,
  BarChart3,
  ShoppingCart,
  Users,
  Clock 
} from 'lucide-react';

const thinkingTools = [
  { key: 0, icon: <FileText className="size-6" /> },
  { key: 1, icon: <ImageIcon className="size-6" /> },
  { key: 2, icon: <Presentation className="size-6" /> },
  { key: 3, icon: <Globe className="size-6" /> },
  { key: 4, icon: <BarChart3 className="size-6" /> },
  { key: 5, icon: <ShoppingCart className="size-6" /> },
  { key: 6, icon: <Users className="size-6" /> },
  { key: 7, icon: <Clock className="size-6" /> },
];

export function CapabilitiesSection() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-10%" });
  const t = useTranslations();

  return (
    <section
      id="capabilities"
      className="flex flex-col items-center justify-center w-full relative py-20 md:py-32"
      ref={ref}
    >
      <div className="relative w-full px-4 md:px-6">
        <div className="max-w-6xl mx-auto">
          <SectionHeader className="mb-16">
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-center text-balance mb-4 text-slate-900 dark:text-white">
              {t('home.capabilities.title')}
            </h2>
            <p className="text-lg text-muted-foreground text-center text-balance max-w-2xl mx-auto">
              {t('home.capabilities.subtitle')}
            </p>
          </SectionHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
            {thinkingTools.map((tool, index) => (
              <motion.div
                key={tool.key}
                initial={{ opacity: 0, y: 20 }}
                animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
                transition={{
                  duration: 0.5,
                  delay: index * 0.05,
                  ease: 'easeOut',
                }}
                className="h-full"
              >
                <SpotlightCard className="p-8 h-full flex flex-col items-start justify-start group">
                  {/* Icon */}
                  <div className="mb-6 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-900/20 dark:text-brand-400 group-hover:scale-110 transition-transform duration-300">
                    {tool.icon}
                  </div>

                  {/* Content */}
                  <div className="space-y-3">
                    <h3 className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
                      {t(`home.capabilities.items.${tool.key}.title`)}
                    </h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {t(`home.capabilities.items.${tool.key}.description`)}
                    </p>
                  </div>
                </SpotlightCard>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
