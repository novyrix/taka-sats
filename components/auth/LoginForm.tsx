// SPDX-License-Identifier: AGPL-3.0-only

'use client';

import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function LoginForm() {
  const t = useTranslations('Login');
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const result = await signIn('credentials', {
      phone: String(form.get('phone') ?? ''),
      password: String(form.get('password') ?? ''),
      redirect: false,
    });

    setPending(false);
    if (result?.error) {
      setError(t('invalid'));
      return;
    }
    router.push('/enrol');
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="phone">{t('phone')}</Label>
        <Input id="phone" name="phone" type="tel" autoComplete="username" required autoFocus />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">{t('password')}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="pwa" disabled={pending}>
        {pending ? t('signingIn') : t('signIn')}
      </Button>
    </form>
  );
}
