import { siteConfig } from '@/lib/site';
import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { interLocal } from './fonts';
import './globals.css';
import { Providers } from './providers';

import { Toaster } from '@/components/ui/sonner';
import { LazyGoogleAnalytics } from '@/components/lazy-google-analytics';
import Script from 'next/script';
import { PostHogIdentify } from '@/components/posthog-identify';
import '@/lib/polyfills'; // Load polyfills early
import {NextIntlClientProvider} from 'next-intl';
import {getMessages, getLocale} from 'next-intl/server';
import {normalizeLocale, AppLocale} from '@/i18n/locales';

// Use local Geist fonts from the `geist` package to avoid dev loader issues
const geistSans = GeistSans;
const geistMono = GeistMono;


// Use locally hosted Inter via next/font/local

export const viewport: Viewport = {
  themeColor: 'black',
};

export async function generateMetadata(): Promise<Metadata> {
  let locale: AppLocale = 'en';
  try {
    locale = normalizeLocale(await getLocale());
  } catch {
    locale = 'en';
  }
  const ogLocale = locale === 'zh' ? 'zh_CN' : 'en_US';
  const metaTitle =
    locale === 'zh'
      ? 'Zmind - 全能可视化思维画布'
      : 'Zmind - All-in-One Thinking Studio';
  const metaDescription =
    locale === 'zh'
      ? '全能可视化思维画布，用 AI 帮你把想法整理成清晰、可协作的方案。'
      : 'All-in-one thinking studio that turns ideas into clear, collaborative visual plans with AI.';

  return {
    metadataBase: new URL(siteConfig.url),
    title: {
      default: siteConfig.name,
      template: `%s - ${siteConfig.name}`,
    },
    description:
      'Zmind is a fully open source AI assistant that helps you accomplish real-world tasks with ease. Through natural conversation, Zmind becomes your digital companion for research, data analysis, and everyday challenges.',
    keywords: [
      'AI',
      'artificial intelligence',
      'browser automation',
      'web scraping',
      'file management',
      'AI assistant',
      'open source',
      'research',
      'data analysis',
    ],
    authors: [{ name: 'Zmind Team', url: 'https://zmind.so' }],
    creator: 'Zmind Team',
    publisher: 'Zmind Team',
    category: 'Technology',
    applicationName: 'Zmind',
    formatDetection: {
      telephone: false,
      email: false,
      address: false,
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
      },
    },
    openGraph: {
      title: metaTitle,
      description: metaDescription,
      url: siteConfig.url,
      siteName: 'Zmind',
      images: [
        {
          url: '/banner.png',
          width: 1200,
          height: 630,
          alt: metaTitle,
          type: 'image/png',
        },
      ],
      locale: ogLocale,
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: metaTitle,
      description: metaDescription,
      creator: '@zmind',
      site: '@zmind',
      images: [
        {
          url: '/banner.png',
          width: 1200,
          height: 630,
          alt: metaTitle,
        },
      ],
    },
    icons: {
      icon: [
        { url: '/zmind-symbol.svg?v=3', type: 'image/svg+xml' },
        { url: '/zmind-symbol-light.svg?v=3', type: 'image/svg+xml', media: '(prefers-color-scheme: light)' },
        { url: '/zmind-symbol.svg?v=3', type: 'image/svg+xml', media: '(prefers-color-scheme: dark)' },
      ],
      shortcut: '/zmind-symbol.svg?v=3',
    },
    alternates: {
      canonical: siteConfig.url,
      languages: {
        zh: '/zh'
      }
    }
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  let locale: AppLocale = 'en';
  try {
    locale = normalizeLocale(await getLocale());
  } catch {
    locale = 'en';
  }
  let messages: any;
  try {
    messages = await getMessages();
  } catch {
    // Fallback to English messages if middleware didn't run (e.g., internal routes in dev)
    messages = (await import('../messages/en.json')).default;
  }

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        {/* Google Tag Manager */}
        <Script id="google-tag-manager" strategy="lazyOnload">
          {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
          new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
          j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
          'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
          })(window,document,'script','dataLayer','GTM-T6M87MFJ');`}
        </Script>
        
        {/* Microsoft Clarity */}
        <Script id="microsoft-clarity" strategy="lazyOnload">
          {`(function(c,l,a,r,i,t,y){
              c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
              t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
              y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
          })(window, document, "clarity", "script", "uqjxfqwx5y");`}
        </Script>
        
        {/* Google Analytics 4 */}
        <Script src="https://www.googletagmanager.com/gtag/js?id=G-TB98J32T62" strategy="lazyOnload" />
        <Script id="google-analytics-4" strategy="lazyOnload">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-TB98J32T62');
          `}
        </Script>
        {process.env.NEXT_PUBLIC_TOLT_REFERRAL_ID && (
          <Script
            src="https://cdn.tolt.io/tolt.js"
            data-tolt={process.env.NEXT_PUBLIC_TOLT_REFERRAL_ID}
            strategy="lazyOnload"
          />
        )}
      </head>

      <body
        className={`${geistSans.variable} ${geistMono.variable} ${interLocal.variable} antialiased font-sans bg-background`}
      >
        <noscript>
          <iframe
            src="https://www.googletagmanager.com/ns.html?id=GTM-T6M87MFJ"
            height="0"
            width="0"
            style={{ display: 'none', visibility: 'hidden' }}
          />
        </noscript>
        {/* End Google Tag Manager (noscript) */}

        <NextIntlClientProvider locale={locale} messages={messages}>
          <Providers>
            {children}
            <Toaster />
          </Providers>
          <LazyGoogleAnalytics gaId="G-6ETJFB3PT3" />
          <PostHogIdentify />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
