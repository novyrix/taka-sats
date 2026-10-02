// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A new route can never ship unguarded. This walks EVERY route file under `app/api`, calls every
 * HTTP method it exports with no session, and requires `401`, except for an explicit allow list of
 * public routes (and each of those must be listed on purpose). It needs no database: a guarded
 * handler must refuse before it touches anything.
 */

import { readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(async () => null) }));
vi.mock('@/lib/jobs', () => ({
  enqueueProcessPayoutSafely: vi.fn(),
  enqueueSweepPayoutsSafely: vi.fn(),
}));

type Handler = (
  request: NextRequest,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response>;

const API_DIR = join(process.cwd(), 'app', 'api');
type RouteModule = Record<string, unknown>;
/** './v1/health/route.ts' -> loader, found by walking the directory (a new route is picked up with no edit). */
const routes: Record<string, () => Promise<RouteModule>> = Object.fromEntries(
  (readdirSync(API_DIR, { recursive: true, encoding: 'utf8' }) as string[])
    .filter((file) => file.split(sep).pop() === 'route.ts')
    .map((file) => [
      `./${file.split(sep).join('/')}`,
      () => import(/* @vite-ignore */ join(API_DIR, file)) as Promise<RouteModule>,
    ]),
);

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

/**
 * Public on purpose, each with the reason. Anything else answering without a session is a bug.
 * `auth/[...nextauth]` is Auth.js itself (sign-in must be reachable); the internal job route is
 * guarded by a bearer secret instead of a session (and refuses without it).
 */
const PUBLIC: Readonly<Record<string, string>> = {
  './v1/health/route.ts': 'liveness probe, no data',
  './v1/meta/route.ts': 'deployment facts, no personal data',
  './v1/stats/summary/route.ts': 'privacy-filtered public counters',
  './auth/[...nextauth]/route.ts': 'Auth.js sign-in endpoints',
};

/** Guarded by something other than a session; must still refuse an anonymous caller. */
const BEARER: ReadonlySet<string> = new Set(['./v1/internal/jobs/enqueue/route.ts']);

const UUID = '00000000-0000-4000-8000-000000000000';

function paramsFor(path: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const match of path.matchAll(/\[(?:\.\.\.)?([^\]]+)\]/g)) {
    params[match[1] as string] = UUID;
  }
  return params;
}

function requestFor(path: string, method: string): NextRequest {
  const url = `http://localhost/api/${path
    .replace(/^\.\//, '')
    .replace(/\/route\.ts$/, '')
    .replace(/\[(?:\.\.\.)?[^\]]+\]/g, UUID)}`;
  return new NextRequest(url, {
    method,
    ...(method === 'GET' ? {} : { headers: { 'content-type': 'application/json' }, body: '{}' }),
  });
}

describe('every API route refuses an anonymous caller', () => {
  const entries = Object.entries(routes);

  it('finds the routes (the glob did not silently match nothing)', () => {
    expect(entries.length).toBeGreaterThan(40);
  });

  it('every allow-list entry still exists (no stale exceptions)', () => {
    for (const path of [...Object.keys(PUBLIC), ...BEARER]) {
      expect(routes[path], path).toBeDefined();
    }
  });

  for (const [path, load] of entries) {
    if (path in PUBLIC) {
      continue;
    }
    it(`${path}: 401 without a session`, async () => {
      const loaded = await load();
      const methods = METHODS.filter((m) => typeof loaded[m] === 'function');
      expect(methods.length, 'exports no HTTP method').toBeGreaterThan(0);
      for (const method of methods) {
        const handler = loaded[method] as Handler;
        const response = await handler(requestFor(path, method), {
          params: Promise.resolve(paramsFor(path)),
        });
        expect(response.status, `${method} ${path}`).toBe(401);
      }
    });
  }

  it('public routes other than Auth.js are read only (GET)', async () => {
    for (const path of Object.keys(PUBLIC)) {
      if (path.startsWith('./auth/')) {
        continue;
      }
      const loaded = await (routes[path] as () => Promise<RouteModule>)();
      const exported = METHODS.filter((m) => typeof loaded[m] === 'function');
      expect(exported, path).toEqual(['GET']);
    }
  });
});
