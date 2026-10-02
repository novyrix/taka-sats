// SPDX-License-Identifier: AGPL-3.0-only
/// <reference lib="webworker" />

/**
 * The Taka Sats service worker (DESIGN §6.4). Built by
 * `@serwist/next` (see `next.config.ts`) during `next build --webpack` — the
 * webpack build is required because `@serwist/next@9` injects the precache
 * manifest via a webpack plugin (Turbopack can't, hence the flag on `build`).
 *
 * What it does now:
 *   - **Precache** the built app shell (`self.__SW_MANIFEST`), so a cold start
 *     with no network still boots the PWA. The authed, per-session data is
 *     served from IndexedDB by `lib/sync`, not from here.
 *   - **Runtime caching** via Serwist's `defaultCache` (Next's recommended
 *     per-asset-class strategies: NetworkFirst for pages/data, StaleWhileRevalidate
 *     for static assets, CacheFirst for images/fonts).
 *   - `navigationPreload`, `skipWaiting`, `clientsClaim`, `reloadOnOnline`
 *     (the last from `next.config.ts`).
 *
 * Still to come (M4): a Background Sync handler that drains `lib/sync`'s
 * `outbox` to `POST /api/v1/sync/events` when connectivity returns. The
 * `message` hook below is where a client-driven drain will plug in.
 */

import { defaultCache } from '@serwist/next/worker';
import { type PrecacheEntry, type SerwistGlobalConfig, Serwist } from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    // The precache manifest injected at build time. Referenced exactly once
    // below — the injector rejects a source that names it more than once.
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST ?? [],
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
});

serwist.addEventListeners();

// M4 hook: a page can ask the SW to attempt an outbox drain (e.g. right after
// coming back online). No-op until the sync loop lands.
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  if ((event.data as { type?: string } | null)?.type === 'takasats:drain-outbox') {
    // TODO(M4): kick the batch sync loop.
  }
});
