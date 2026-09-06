// SPDX-License-Identifier: AGPL-3.0-only

import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** shadcn/ui Input, themed to Taka Sats tokens. 44px min height (DESIGN §12.3). */
export function Input({ className, type, ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type}
      className={cn(
        'flex h-11 w-full rounded-lg border border-input bg-card px-3 py-2 text-base text-foreground',
        'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
