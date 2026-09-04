// SPDX-License-Identifier: AGPL-3.0-only

import { CircleCheck, CircleDashed, Clock, OctagonX, RefreshCw, TriangleAlert } from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';
import { type DisplayStatus, STATUS_TONE } from '@/lib/status';
import { cn } from '@/lib/utils';

/**
 * Status primitives (DESIGN §8, §13.2) — M0 stubs.
 *
 * Both components take a `DisplayStatus` enum value, never a raw colour, so a
 * status can never be shown as colour alone. The visible/accessible text is a
 * required prop: callers pass a translated string (`messages` `Status.*`), so
 * these components stay locale-agnostic and usable from Server or Client
 * components. Motion (the `syncing` spinner) lands with M3 — see §9.4.
 */

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

const STATUS_ICON: Readonly<Record<DisplayStatus, IconComponent>> = {
  queued: CircleDashed,
  syncing: RefreshCw,
  confirmed: CircleCheck,
  needs_attention: TriangleAlert,
  failed: OctagonX,
  pending_payout: Clock,
};

type StatusIconProps = {
  readonly status: DisplayStatus;
  /** Accessible name — a translated string. Required: the icon carries meaning. */
  readonly label: string;
  readonly className?: string;
};

export function StatusIcon({ status, label, className }: StatusIconProps) {
  const Icon = STATUS_ICON[status];
  return (
    <Icon
      role="img"
      aria-label={label}
      className={cn('size-5 shrink-0', STATUS_TONE[status], className)}
    />
  );
}

type StatusPillProps = {
  readonly status: DisplayStatus;
  /** Visible, translated label. */
  readonly label: string;
  readonly className?: string;
};

export function StatusPill({ status, label, className }: StatusPillProps) {
  const Icon = STATUS_ICON[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1',
        'font-display text-xs font-medium uppercase tracking-[0.02em]',
        STATUS_TONE[status],
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <span>{label}</span>
    </span>
  );
}
