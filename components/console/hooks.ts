// SPDX-License-Identifier: AGPL-3.0-only

'use client';

import { useCallback, useEffect, useState } from 'react';
import { type ApiFail, type ApiResult, api } from '@/lib/console/api';

type Loaded<T> = { readonly key: string; readonly result: ApiResult<T>; readonly data: T | null };

/**
 * GET a path and keep the last good data while a reload is in flight. Pass `null` to stay idle.
 * `loading` is true only until the first answer for the current path.
 */
export function useApi<T>(path: string | null): {
  readonly data: T | null;
  readonly error: ApiFail | null;
  readonly loading: boolean;
  readonly reload: () => void;
} {
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<Loaded<T> | null>(null);
  const key = `${path ?? ''}#${tick}`;

  useEffect(() => {
    if (path === null) {
      return;
    }
    let cancelled = false;
    void api<T>(path).then((result) => {
      if (cancelled) {
        return;
      }
      setState((prev) => ({
        key,
        result,
        data: result.ok ? result.data : (prev?.data ?? null),
      }));
    });
    return () => {
      cancelled = true;
    };
  }, [path, key]);

  const answered = path !== null && state?.key === key ? state.result : null;
  return {
    data: state?.data ?? null,
    error: answered && !answered.ok ? answered : null,
    loading: path !== null && answered === null,
    reload: useCallback(() => setTick((n) => n + 1), []),
  };
}

type More<T> = {
  readonly forData: unknown;
  readonly items: readonly T[];
  readonly next: string | null | undefined;
  readonly busy: boolean;
  readonly error: ApiFail | null;
};

/**
 * A cursor-paginated list: `path` returns `{ [listKey]: T[], nextCursor }`. `loadMore` appends
 * the next page; a reload (or a new path) starts over from the first page.
 */
export function usePaged<T>(
  path: string,
  listKey: string,
): {
  readonly items: readonly T[];
  readonly loading: boolean;
  readonly error: ApiFail | null;
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
  readonly moreError: ApiFail | null;
  readonly loadMore: () => Promise<void>;
  readonly reload: () => void;
} {
  const first = useApi<Record<string, unknown>>(path);
  const [more, setMore] = useState<More<T>>({
    forData: null,
    items: [],
    next: undefined,
    busy: false,
    error: null,
  });

  const firstItems = (first.data?.[listKey] as T[] | undefined) ?? [];
  const firstCursor = (first.data?.nextCursor as string | number | null | undefined) ?? null;
  const fresh = more.forData === first.data;
  const nextCursor = fresh && more.next !== undefined ? more.next : firstCursor;
  const items = fresh ? [...firstItems, ...more.items] : firstItems;

  async function loadMore(): Promise<void> {
    if (nextCursor === null || nextCursor === undefined) {
      return;
    }
    const base: More<T> = fresh
      ? more
      : { forData: first.data, items: [], next: undefined, busy: false, error: null };
    setMore({ ...base, busy: true, error: null });
    const sep = path.includes('?') ? '&' : '?';
    const res = await api<Record<string, unknown>>(
      `${path}${sep}cursor=${encodeURIComponent(String(nextCursor))}`,
    );
    if (!res.ok) {
      setMore({ ...base, busy: false, error: res });
      return;
    }
    setMore({
      forData: first.data,
      items: [...base.items, ...((res.data[listKey] as T[] | undefined) ?? [])],
      next: (res.data.nextCursor as string | null | undefined) ?? null,
      busy: false,
      error: null,
    });
  }

  return {
    items,
    loading: first.loading && first.data === null,
    error: first.error,
    hasMore: nextCursor !== null && nextCursor !== undefined,
    loadingMore: more.busy,
    moreError: more.error,
    loadMore,
    reload: first.reload,
  };
}

/**
 * id -> name for staff accounts, for showing who did something instead of a bare id. Only
 * admins may read the roster; for anyone else the map is empty and the caller shows a short id.
 */
export function useStaffNames(enabled: boolean): (id: string | null | undefined) => string {
  const roster = useApi<{ supervisors: { id: string; name: string }[] }>(
    enabled ? '/supervisors?includeInactive=1' : null,
  );
  const map = new Map((roster.data?.supervisors ?? []).map((p) => [p.id, p.name]));
  return (id) => (id ? (map.get(id) ?? id.slice(0, 8)) : '');
}
