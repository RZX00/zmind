'use client';

import React from 'react';
import { Separator } from '@/components/ui/separator';
import {Link} from '@/i18n/routing';
import { usePathname } from '@/i18n/routing';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

export default function TeamSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { accountSlug } = useParams() as { accountSlug: string };
  const pathname = usePathname();
  const t = useTranslations('teamSettings');
  const items = [
    { name: t('title'), href: `/team/${accountSlug}/settings` },
  ];

  return (
    <div className="dashboard-page space-y-6 w-full">
      <Separator className="border-subtle dark:border-white/10" />
      <div className="dashboard-container">
        <div className="relative max-w-4xl mx-auto">
          {/* Top nav on mobile */}
          <div className="lg:hidden mb-4 rounded-[var(--canvas-panel-radius)] border border-border/60 bg-background/70 p-1">
            <nav className="flex gap-2">
              {items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    pathname === item.href
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
                  }`}
                >
                  {item.name}
                </Link>
              ))}
            </nav>
          </div>

          {/* Centered main content */}
          <div className="min-w-0">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
