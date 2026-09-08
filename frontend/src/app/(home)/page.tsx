'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { HeroSection } from '@/components/home/sections/hero-section';
import { ModalProviders } from '@/providers/modal-providers';
import { BackgroundAALChecker } from '@/components/auth/background-aal-checker';

const CoreValueSection = dynamic(
  () => import('@/components/home/sections/core-value-section').then((mod) => mod.CoreValueSection),
  { loading: () => <SectionPlaceholder className="min-h-[520px]" /> },
);
const TemplateSection = dynamic(
  () => import('@/components/home/sections/template-section').then((mod) => mod.TemplateSection),
  { loading: () => <SectionPlaceholder className="min-h-[520px]" /> },
);
const FAQSection = dynamic(
  () => import('@/components/home/sections/faq-section').then((mod) => mod.FAQSection),
  { loading: () => <SectionPlaceholder className="min-h-[480px]" /> },
);
const CTASection = dynamic(
  () => import('@/components/home/sections/cta-section').then((mod) => mod.CTASection),
  { loading: () => <SectionPlaceholder className="min-h-[360px]" /> },
);
const FooterSection = dynamic(
  () => import('@/components/home/sections/footer-section').then((mod) => mod.FooterSection),
  { loading: () => <SectionPlaceholder className="min-h-[240px]" /> },
);

function SectionPlaceholder({ className }: { className: string }) {
  return <div className={`w-full ${className}`} aria-hidden="true" />;
}

export default function Home() {
  const [showBelowFold, setShowBelowFold] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const enable = () => {
      if (!cancelled) setShowBelowFold(true);
    };

    const win = window as typeof window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    if (win.requestIdleCallback) {
      const id = win.requestIdleCallback(enable, { timeout: 1500 });
      return () => {
        cancelled = true;
        win.cancelIdleCallback?.(id);
      };
    }

    const timeoutId = window.setTimeout(enable, 1500);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, []);

  return (
    <>
      <ModalProviders />
      <BackgroundAALChecker enabled={false}>
        <main className="flex min-h-screen w-full flex-col items-center justify-center bg-background text-foreground">
          <div className="w-full divide-y divide-border bg-background">
            <HeroSection />
            {showBelowFold ? <CoreValueSection /> : <SectionPlaceholder className="min-h-[520px]" />}
            {showBelowFold ? <TemplateSection /> : <SectionPlaceholder className="min-h-[520px]" />}
            {showBelowFold ? <FAQSection /> : <SectionPlaceholder className="min-h-[480px]" />}
            {showBelowFold ? <CTASection /> : <SectionPlaceholder className="min-h-[360px]" />}
            {showBelowFold ? <FooterSection /> : <SectionPlaceholder className="min-h-[240px]" />}
          </div>
        </main>
      </BackgroundAALChecker>
    </>
  );
}
