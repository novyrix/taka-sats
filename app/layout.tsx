// SPDX-License-Identifier: AGPL-3.0-only

import type { Metadata } from 'next';
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
    title: t('title'),
    description: t('description'),
  };
}

type RootLayoutProps = {
  readonly children: ReactNode;
};

export default async function RootLayout({ children }: RootLayoutProps) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${displayFont.variable} ${bodyFont.variable} ${monoFont.variable}`}
    >
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
