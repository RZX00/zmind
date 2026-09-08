import localFont from 'next/font/local';

export const interLocal = localFont({
  src: [
    { path: '../../public/fonts/Inter-Regular.woff2', weight: '400', style: 'normal' },
    { path: '../../public/fonts/Inter-Italic.woff2', weight: '400', style: 'italic' },
    { path: '../../public/fonts/Inter-SemiBold.woff2', weight: '600', style: 'normal' },
    { path: '../../public/fonts/Inter-SemiBoldItalic.woff2', weight: '600', style: 'italic' },
    { path: '../../public/fonts/Inter-Bold.woff2', weight: '700', style: 'normal' },
    { path: '../../public/fonts/Inter-BoldItalic.woff2', weight: '700', style: 'italic' },
  ],
  variable: '--font-inter',
  display: 'swap',
  preload: true,
});

