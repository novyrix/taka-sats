// SPDX-License-Identifier: AGPL-3.0-only

'use client';

import { Label as LabelPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** shadcn/ui Label — `text-label` per DESIGN §4.5 (display 500, +0.02em tracking). */
export function Label({ className, ...props }: ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      className={cn(
        'font-display text-xs font-medium uppercase tracking-[0.02em] text-muted-foreground',
        'peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
        className,
      )}
      {...props}
    />
  );
}
