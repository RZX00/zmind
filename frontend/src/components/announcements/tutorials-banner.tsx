'use client';

import * as React from 'react';
import { useEffect, useState } from 'react';
import { ArrowRight, BookOpen, Play, X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslations } from 'next-intl';

import { useAuth } from '@/components/AuthProvider';
import { Link } from '@/i18n/routing';

const STORAGE_KEY = 'zmind-tutorials-banner-dismissed';

export function TutorialsBanner() {
  const [isVisible, setIsVisible] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { user } = useAuth();
  const t = useTranslations('tutorialsBanner');

  useEffect(() => {
    setMounted(true);
    if (!user) return;
    if (typeof window === 'undefined') return;

    const dismissed = window.localStorage.getItem(STORAGE_KEY);
    if (dismissed) return;

    const timer = window.setTimeout(() => {
      setIsVisible(true);
    }, 1800);

    return () => window.clearTimeout(timer);
  }, [user]);

  const handleClose = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsVisible(false);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, 'true');
    }
  };

  if (!mounted || !isVisible || !user) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.96 }}
        transition={{ duration: 0.28, ease: 'easeOut' }}
        className="fixed bottom-4 right-4 z-[100] w-[320px]"
      >
        <Link href="/tutorials" className="block">
          <div className="group relative overflow-hidden rounded-xl border border-border/70 bg-card shadow-xl transition-colors hover:border-primary/30">
            <button
              onClick={handleClose}
              className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/10 text-foreground transition-colors hover:bg-black/20 dark:bg-black/70 dark:hover:bg-black"
              aria-label={t('dismiss', { default: 'Dismiss tutorials banner' })}
            >
              <X className="h-3 w-3" />
            </button>

            <div className="relative flex h-[100px] items-center justify-center overflow-hidden bg-gradient-to-br from-primary/15 via-primary/5 to-transparent">
              <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-primary/10 blur-xl" />
              <div className="absolute -bottom-4 -left-4 h-20 w-20 rounded-full bg-primary/5 blur-lg" />

              <div className="relative flex items-center gap-2">
                {[1, 2, 3].map((step, index) => (
                  <motion.div
                    key={step}
                    initial={{ y: 0 }}
                    animate={{ y: index % 2 === 0 ? [-2, 2, -2] : [2, -2, 2] }}
                    transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut', delay: index * 0.35 }}
                    className="flex h-10 w-10 items-center justify-center rounded-lg border border-border/50 bg-background text-sm font-bold text-primary shadow-md"
                  >
                    {step}
                  </motion.div>
                ))}
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/20 text-xs font-medium text-primary">
                  +4
                </div>
              </div>
            </div>

            <div className="bg-muted/40 p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10">
                  <BookOpen className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="mb-1 text-sm font-semibold text-foreground">
                    {t('title', { default: 'New to Zmind? Start here' })}
                  </h3>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {t('description', {
                      default: '7 interactive tutorials to help you master core workflows quickly.',
                    })}
                  </p>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Play className="h-3 w-3" />
                  <span>{t('walkthroughs', { default: 'Interactive walkthroughs' })}</span>
                </div>
                <div className="flex items-center gap-1 text-xs font-medium text-primary transition-all group-hover:gap-2">
                  <span>{t('cta', { default: 'View tutorials' })}</span>
                  <ArrowRight className="h-3 w-3" />
                </div>
              </div>
            </div>
          </div>
        </Link>
      </motion.div>
    </AnimatePresence>
  );
}
