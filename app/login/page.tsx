// SPDX-License-Identifier: AGPL-3.0-only

import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { auth } from '@/auth';
import { LoginForm } from '@/components/auth/LoginForm';

export default async function LoginPage() {
  if (await auth()) {
    redirect('/enrol');
  }
  const t = await getTranslations('Login');

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-8 px-4 py-10">
      <div className="space-y-2">
        <h1 className="font-display text-2xl font-bold tracking-[-0.02em]">{t('title')}</h1>
        <p className="text-muted-foreground">{t('subtitle')}</p>
      </div>
      <LoginForm />
    </main>
  );
}
