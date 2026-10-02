// SPDX-License-Identifier: AGPL-3.0-only

'use client';

import { signOut } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

/** Ends the session and returns to /login. Queued offline events stay on the device. */
export function SignOutButton({ className }: { readonly className?: string }) {
  const t = useTranslations('Console');
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={className}
      onClick={() => void signOut({ redirectTo: '/login' })}
    >
      {t('signOut')}
    </Button>
  );
}
