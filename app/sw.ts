// SPDX-License-Identifier: AGPL-3.0-only
/// <reference lib="webworker" />

/**
 * Service worker source (DESIGN §6.4). M0 scaffold only.
 *
 * M3-1 turns this into the real offline layer: precache the app shell, a
 * runtime strategy per asset class, and Background Sync draining the outbox
 * (`lib/sync`). For now it just installs and claims clients so the wiring is
 * exercised end to end. Built by `@serwist/next` (see `next.config.ts`).
 */

import { defaultCache } from '@serwist/next/worker';
import { type PrecacheEntry, type SerwistGlobalConfig, Serwist } from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  ...(self.__SW_MANIFEST ? { precacheEntries: self.__SW_MANIFEST } : {}),
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
});

serwist.addEventListeners();
