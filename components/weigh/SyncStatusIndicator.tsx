// SPDX-License-Identifier: AGPL-3.0-only

'use client';

import { CircleCheck, CircleDashed, KeyRound, RefreshCw, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type ComponentType, type SVGProps, useCallback, useEffect, useRef, useState } from 'react';
import { SIGN_IN_REQUIRED_EVENT, sessionSummary } from '@/lib/sync';
import { cn } from '@/lib/utils';

/** Fired by the weigh flow after an event is queued, so the bar can refresh. */
export const QUEUE_CHANGED_EVENT = 'takasats:queue-changed';

type Counts = { queued: number; syncing: number; needsAttention: number; failed: number };
type Mode = 'signedOut' | 'needsAttention' | 'syncing' | 'queued' | 'allSynced';

const COLLAPSE_MS = 3000;
const ICONS: Record<Mode, ComponentType<SVGProps<SVGSVGElement>>> = {
  signedOut: KeyRound,
  needsAttention: TriangleAlert,
  syncing: RefreshCw,
  queued: CircleDashed,
  allSynced: CircleCheck,
};

/**
 * The sticky sync-status bar (DESIGN section 11.3). It says the one thing the supervisor most
 * needs to know, always as shape + colour + text, and every state is a tap target:
 *   signed out      - the session ended; the saved collections are safe; tap to sign in
 *   needs attention - the server refused something; tap to see which one and why
 *   syncing         - a drain is running
 *   queued          - saved on the phone, waiting for a connection
 *   all synced      - shown for three seconds after the last item is confirmed, then gone
 * It is empty when there is nothing to say.
 */
export function SyncStatusIndicator() {
  const t = useTranslations('Sync.bar');
  const [counts, setCounts] = useState<Counts>({
    queued: 0,
    syncing: 0,
    needsAttention: 0,
    failed: 0,
  });
  const [signedOut, setSignedOut] = useState(false);
  const [celebrate, setCelebrate] = useState(false);

  const hadPending = useRef(false);

  const refresh = useCallback(() => {
    void sessionSummary().then((summary) => {
      const next = {
        queued: summary.byState.queued,
        syncing: summary.byState.syncing,
        needsAttention: summary.byState.needs_attention,
        failed: summary.byState.failed,
      };
      const pendingNow = next.queued + next.syncing > 0;
      // The last waiting item just got confirmed: show "All synced" for a moment.
      if (hadPending.current && !pendingNow && next.needsAttention === 0) {
        setCelebrate(true);
        window.setTimeout(() => setCelebrate(false), COLLAPSE_MS);
      }
      hadPending.current = pendingNow;
      setCounts(next);
    });
  }, []);

  useEffect(() => {
    refresh();
    const onSignIn = (e: Event) => {
      setSignedOut(Boolean((e as CustomEvent<{ required: boolean }>).detail?.required));
    };
    window.addEventListener(QUEUE_CHANGED_EVENT, refresh);
    window.addEventListener(SIGN_IN_REQUIRED_EVENT, onSignIn);
    return () => {
      window.removeEventListener(QUEUE_CHANGED_EVENT, refresh);
      window.removeEventListener(SIGN_IN_REQUIRED_EVENT, onSignIn);
    };
  }, [refresh]);

  const waiting = counts.queued + counts.failed;
  let mode: Mode | null = null;
  if (signedOut) {
    mode = 'signedOut';
  } else if (counts.needsAttention > 0) {
    mode = 'needsAttention';
  } else if (counts.syncing > 0) {
    mode = 'syncing';
  } else if (waiting > 0) {
    mode = 'queued';
  } else if (celebrate) {
    mode = 'allSynced';
  }

  if (mode === null) {
    return null;
  }

  const Icon = ICONS[mode];
  const count =
    mode === 'signedOut'
      ? waiting + counts.syncing
      : mode === 'needsAttention'
        ? counts.needsAttention
        : mode === 'syncing'
          ? counts.syncing
          : waiting;
  const href =
    mode === 'signedOut' ? '/login' : mode === 'needsAttention' ? '/session' : '/session';

  return (
    <Link
      href={href}
      role="status"
      data-testid="sync-bar"
      data-mode={mode}
      className={cn(
        'sticky top-0 z-10 flex min-h-[44px] items-center gap-2 border-b border-border bg-background px-4 py-2',
        'font-display text-xs font-medium uppercase tracking-[0.02em] active:bg-accent/40',
        mode === 'needsAttention' || mode === 'signedOut'
          ? 'text-foreground'
          : 'text-muted-foreground',
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          'size-4 shrink-0',
          mode === 'syncing' && 'animate-spin motion-reduce:animate-none',
        )}
      />
      <span>{t(mode, { count })}</span>
    </Link>
  );
}
