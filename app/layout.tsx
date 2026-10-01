// SPDX-License-Identifier: AGPL-3.0-only

import type { Metadata, Viewport } from 'next';
import { Hanken_Grotesk, JetBrains_Mono, Space_Grotesk } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { ThemeProvider } from '@/components/ThemeProvider';
import './globals.css';

const displayFont = Space_Grotesk({
  variable: '--font-space-grotesk',
  subsets: ['latin'],
  weight: ['500', '700'],
  display: 'swap',
  preload: false,
});

const bodyFont = Hanken_Grotesk({
  variable: '--font-hanken-grotesk',
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
});

const monoFont = JetBrains_Mono({
  variable: '--font-jetbrains-mono',
  subsets: ['latin'],
  weight: ['500', '700'],
  display: 'swap',
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Metadata');

  return {
    metadataBase: new URL('https://taka.afribit.africa'),
    applicationName: 'Taka Sats',
    title: {
      default: t('title'),
      template: '%s | Taka Sats',
    },
    description: t('description'),
    keywords: [
      'Taka Sats',
      'recycling rewards',
      'Bitcoin recycling',
      'waste collection Kenya',
      'Lightning payments',
      'verified recycling',
    ],
    alternates: { canonical: '/' },
    manifest: '/manifest.webmanifest',
    icons: {
      icon: [
        { url: '/favicon.ico', sizes: 'any' },
        { url: '/icon.png', type: 'image/png', sizes: '256x256' },
      ],
      apple: [{ url: '/apple-touch-icon.png', type: 'image/png', sizes: '180x180' }],
    },
    openGraph: {
      type: 'website',
      url: '/',
      siteName: 'Taka Sats',
      title: t('title'),
      description: t('description'),
      locale: 'en_KE',
      images: [{ url: '/opengraph-image', width: 1200, height: 630, alt: t('shareImageAlt') }],
    },
    twitter: {
      card: 'summary_large_image',
      title: t('title'),
      description: t('description'),
      images: ['/opengraph-image'],
    },
    category: 'technology',
    creator: 'Afribit Africa',
    publisher: 'Afribit Africa',
    formatDetection: { email: false, address: false, telephone: false },
    appleWebApp: { capable: true, title: t('title'), statusBarStyle: 'default' },
  };
}

export const viewport: Viewport = {
  themeColor: '#3E6336',
  colorScheme: 'light',
};

type RootLayoutProps = {
  readonly children: ReactNode;
};

export default async function RootLayout({ children }: RootLayoutProps) {
  const locale = await getLocale();
  const messages = await getMessages();
  const t = await getTranslations('Metadata');
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Taka Sats',
    url: 'https://taka.afribit.africa',
    description: t('description'),
    publisher: {
      '@type': 'Organization',
      name: 'Afribit Africa',
      url: 'https://afribit.africa',
      logo: 'https://taka.afribit.africa/icon-512.png',
    },
  };

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${displayFont.variable} ${bodyFont.variable} ${monoFont.variable}`}
    >
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(structuredData).replace(/</g, '\\u003c'),
          }}
        />
      </head>
      <body>
        <NextIntlClientProvider messages={messages}>
          <ThemeProvider attribute="data-theme" defaultTheme="light" enableSystem={false}>
            {children}
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
