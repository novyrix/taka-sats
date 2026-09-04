import { getRequestConfig } from 'next-intl/server';
import { headers } from 'next/headers';
import { getSettings } from '@/lib/config';
import { negotiateLocale } from '@/lib/i18n/locale';
import enMessages from '@/messages/en.json';
import shengMessages from '@/messages/sheng.json';
import swMessages from '@/messages/sw.json';

type Messages = typeof enMessages;

const MESSAGES: Record<string, Messages> = {
  en: enMessages,
  sw: swMessages as Messages,
  sheng: shengMessages as Messages,
};

export default getRequestConfig(async () => {
  const { locales, default_locale: defaultLocale } = getSettings().programme;
  const acceptLanguage = (await headers()).get('accept-language');

  const negotiated = negotiateLocale(acceptLanguage, locales, defaultLocale);
  const locale = negotiated in MESSAGES ? negotiated : defaultLocale;

  return {
    locale,
    messages: MESSAGES[locale] ?? enMessages,
  };
});
