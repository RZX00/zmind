export const siteConfig = {
  name: "Zmind",
  url: "https://zmind.so",
  description: "Zmind is a fully open source AI assistant that helps you accomplish real-world tasks with ease. Through natural conversation, Zmind becomes your digital companion for research, data analysis, and everyday challenges.",
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
  creator: 'Zmind contributors',
  publisher: 'Zmind contributors',
  category: 'Technology',
  applicationName: 'Zmind',
  twitterHandle: '@zmind',
  githubUrl: 'https://github.com/RZX00/zmind',
  
  // Mobile-specific configurations
  bundleId: {
    ios: 'so.zmind.mobile',
    android: 'so.zmind.mobile'
  },
  
  // Theme colors
  colors: {
    primary: '#000000',
    background: '#ffffff',
    theme: '#000000'
  }
};

// React Native metadata structure (for web builds)
export const mobileMetadata = {
  title: {
    default: siteConfig.name,
    template: `%s - ${siteConfig.name}`,
  },
  description: siteConfig.description,
  keywords: siteConfig.keywords,
  authors: siteConfig.authors,
  creator: siteConfig.creator,
  publisher: siteConfig.publisher,
  category: siteConfig.category,
  applicationName: siteConfig.applicationName,
  formatDetection: {
    telephone: false,
    email: false,
    address: false,
  },
  openGraph: {
    title: 'Zmind - Open Source Generalist AI Agent',
    description: siteConfig.description,
    url: siteConfig.url,
    siteName: siteConfig.name,
    images: [
      {
        url: '/banner.png',
        width: 1200,
        height: 630,
        alt: 'Zmind - Open Source Generalist AI Agent',
        type: 'image/png',
      },
    ],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Zmind - Open Source Generalist AI Agent',
    description: siteConfig.description,
    creator: siteConfig.twitterHandle,
    site: siteConfig.twitterHandle,
    images: [
      {
        url: '/banner.png',
        width: 1200,
        height: 630,
        alt: 'Zmind - Open Source Generalist AI Agent',
      },
    ],
  },
  icons: {
    icon: [{ url: '/favicon.png', sizes: 'any' }],
    shortcut: '/favicon.png',
  },
  alternates: {
    canonical: siteConfig.url,
  },
}; 
