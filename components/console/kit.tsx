// SPDX-License-Identifier: AGPL-3.0-only

'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type ComponentProps, type ReactNode, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusPill } from '@/components/ui/status';
import { type ApiFail, type ApiResult } from '@/lib/console/api';
import {
  anomalyDisplay,
  collectorDisplay,
  destinationDisplay,
  payoutDisplay,
  sessionDisplay,
  topupDisplay,
} from '@/lib/console/status-map';
import type { DisplayStatus } from '@/lib/status';
import { cn } from '@/lib/utils';

/** Plain, token-styled building blocks shared by every operator console page. */

export function PageHeader({
  title,
  description,
  actions,
}: {
  readonly title: string;
  readonly description?: string | undefined;
  readonly actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-xl font-bold tracking-[-0.02em]">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Panel({
  title,
  children,
  className,
  actions,
}: {
  readonly title?: string | undefined;
  readonly children: ReactNode;
  readonly className?: string | undefined;
  readonly actions?: ReactNode;
}) {
  return (
    <section className={cn('rounded-lg border border-border bg-card p-4', className)}>
      {title || actions ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title ? <h2 className="font-display text-base font-bold">{title}</h2> : <span />}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Translate an API failure into a readable message (by `code`, never the English message). */
export function useErrorText(): (error: Pick<ApiFail, 'code' | 'status'>) => string {
  const t = useTranslations('Console.errors');
  return (error) => (t.has(error.code) ? t(error.code) : t('generic', { code: error.code }));
}

export function ErrorNotice({
  error,
  onRetry,
}: {
  readonly error: ApiFail;
  readonly onRetry?: (() => void) | undefined;
}) {
  const t = useTranslations('Console');
  const text = useErrorText();
  return (
    <div
      role="alert"
      className="rounded-lg border border-destructive/40 bg-card p-4 text-sm"
      data-testid="error-notice"
    >
      <p className="font-medium text-destructive">{text(error)}</p>
      <p className="mt-1 font-mono text-xs text-muted-foreground">{error.code}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {error.status === 401 ? (
          <Link href="/login" className="text-sm underline">
            {t('signInAgain')}
          </Link>
        ) : null}
        {onRetry ? (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            {t('retry')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function Loading() {
  const t = useTranslations('Console');
  return (
    <p role="status" className="py-8 text-center text-sm text-muted-foreground">
      {t('loading')}
    </p>
  );
}

export function Empty({ children }: { readonly children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

/** Loading / error / empty / content in one place. */
export function DataState({
  loading,
  error,
  empty,
  emptyText,
  onRetry,
  children,
}: {
  readonly loading: boolean;
  readonly error: ApiFail | null;
  readonly empty?: boolean;
  readonly emptyText?: string;
  readonly onRetry?: () => void;
  readonly children: ReactNode;
}) {
  if (error) {
    return <ErrorNotice error={error} onRetry={onRetry} />;
  }
  if (loading) {
    return <Loading />;
  }
  if (empty) {
    return <Empty>{emptyText}</Empty>;
  }
  return <>{children}</>;
}

export function TableWrap({
  children,
  minWidth = '40rem',
}: {
  readonly children: ReactNode;
  readonly minWidth?: string;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full border-collapse text-sm" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

export function Th({ children, className }: { readonly children?: ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={cn(
        'border-b border-border px-3 py-3 text-left font-display text-xs font-medium uppercase tracking-[0.02em] text-muted-foreground',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className,
  ...rest
}: { readonly children?: ReactNode } & ComponentProps<'td'>) {
  return (
    <td
      className={cn('border-b border-border px-3 py-3 align-top last:border-0', className)}
      {...rest}
    >
      {children}
    </td>
  );
}

/** A status chip: icon + colour + the translated text (never colour alone). */
export function Pill({
  status,
  label,
}: {
  readonly status: DisplayStatus;
  readonly label: string;
}) {
  return <StatusPill status={status} label={label} />;
}

const DOMAINS = {
  collector: collectorDisplay,
  destination: destinationDisplay,
  payout: payoutDisplay,
  topup: topupDisplay,
  anomaly: anomalyDisplay,
  session: sessionDisplay,
} as const;

/** A translated status chip for a domain state (). */
export function DomainPill({
  domain,
  value,
}: {
  readonly domain: keyof typeof DOMAINS;
  readonly value: string;
}) {
  const t = useTranslations('Console.status');
  const key = `${domain}.${value}`;
  return <StatusPill status={DOMAINS[domain](value)} label={t.has(key) ? t(key) : value} />;
}

export function Mono({
  children,
  className,
}: {
  readonly children: ReactNode;
  className?: string;
}) {
  return <span className={cn('font-mono text-xs break-all', className)}>{children}</span>;
}

/** A native select styled like Input (44px target). */
export function Select({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-11 rounded-lg border border-input bg-card px-3 text-sm text-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'min-h-20 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground',
        'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className,
      )}
      {...props}
    />
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children(id)}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function TextField({
  label,
  hint,
  ...props
}: { readonly label: string; readonly hint?: string } & ComponentProps<typeof Input>) {
  return (
    <Field label={label} {...(hint ? { hint } : {})}>
      {(id) => <Input id={id} {...props} />}
    </Field>
  );
}

/**
 * A button that runs an async API action, disables itself while running and shows any failure
 * next to it in a readable form. `confirm` asks first (a destructive or irreversible step).
 * `onDone` fires after a success (typically a reload).
 */
export function ActionButton<T>({
  label,
  busyLabel,
  run,
  onDone,
  variant = 'default',
  size = 'sm',
  confirm,
  disabled,
  testId,
}: {
  readonly label: string;
  readonly busyLabel?: string;
  readonly run: () => Promise<ApiResult<T>>;
  readonly onDone?: (data: T) => void;
  readonly variant?: ComponentProps<typeof Button>['variant'];
  readonly size?: ComponentProps<typeof Button>['size'];
  readonly confirm?: string;
  readonly disabled?: boolean;
  readonly testId?: string;
}) {
  const t = useTranslations('Console');
  const text = useErrorText();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiFail | null>(null);
  const [asking, setAsking] = useState(false);

  async function go(): Promise<void> {
    setAsking(false);
    setBusy(true);
    setError(null);
    const res = await run();
    setBusy(false);
    if (res.ok) {
      onDone?.(res.data);
    } else {
      setError(res);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      {asking ? (
        <span
          role="group"
          aria-label={confirm}
          className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2 text-sm"
        >
          <span>{confirm}</span>
          <Button type="button" size="sm" variant={variant} onClick={() => void go()}>
            {t('confirmYes')}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setAsking(false)}>
            {t('confirmNo')}
          </Button>
        </span>
      ) : (
        <Button
          type="button"
          size={size}
          variant={variant}
          disabled={busy || disabled}
          data-testid={testId}
          onClick={() => (confirm ? setAsking(true) : void go())}
        >
          {busy ? (busyLabel ?? t('working')) : label}
        </Button>
      )}
      {error ? (
        <span role="alert" className="max-w-xs text-xs text-destructive">
          {text(error)} <span className="font-mono">({error.code})</span>
        </span>
      ) : null}
    </span>
  );
}

export function LoadMore({
  hasMore,
  busy,
  error,
  onMore,
}: {
  readonly hasMore: boolean;
  readonly busy: boolean;
  readonly error: ApiFail | null;
  readonly onMore: () => void;
}) {
  const t = useTranslations('Console');
  if (!hasMore && !error) {
    return null;
  }
  return (
    <div className="mt-3 flex flex-col items-center gap-2">
      {error ? <ErrorNotice error={error} /> : null}
      {hasMore ? (
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onMore}>
          {busy ? t('loading') : t('loadMore')}
        </Button>
      ) : null}
    </div>
  );
}

export function KeyValue({
  items,
}: {
  readonly items: readonly { readonly k: string; readonly v: ReactNode }[];
}) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[12rem_1fr]">
      {items.map((item) => (
        <div key={item.k} className="contents">
          <dt className="font-display text-xs font-medium uppercase tracking-[0.02em] text-muted-foreground">
            {item.k}
          </dt>
          <dd className="min-w-0 break-words">{item.v}</dd>
        </div>
      ))}
    </dl>
  );
}
