// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A tiny same-origin client for `/api/v1`, used by the operator console. Every call resolves to
 * a result value, never throws: the UI switches on `code` (the stable API error code) and shows
 * a translated message, never the English `message`. BROWSER ONLY (uses `fetch` with cookies).
 */

export type ApiOk<T> = { readonly ok: true; readonly status: number; readonly data: T };
export type ApiFail = {
  readonly ok: false;
  readonly status: number;
  /** The API error `code`, or `network` / `bad_response` when no API answer was received. */
  readonly code: string;
  /** English, for diagnostics only. */
  readonly message: string;
  readonly details?: unknown;
};
export type ApiResult<T> = ApiOk<T> | ApiFail;

type ErrorBody = { error?: { code?: unknown; message?: unknown; details?: unknown } };

export async function api<T>(
  path: string,
  init: { readonly method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; readonly body?: unknown } = {},
): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method: init.method ?? 'GET',
      credentials: 'same-origin',
      ...(init.body !== undefined && {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(init.body),
      }),
    });
  } catch {
    return { ok: false, status: 0, code: 'network', message: 'Network error' };
  }

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }

  if (res.ok) {
    if (json === null || typeof json !== 'object') {
      return { ok: false, status: res.status, code: 'bad_response', message: 'Unexpected reply' };
    }
    return { ok: true, status: res.status, data: json as T };
  }

  const err = (json as ErrorBody | null)?.error;
  return {
    ok: false,
    status: res.status,
    code: typeof err?.code === 'string' ? err.code : `http_${res.status}`,
    message: typeof err?.message === 'string' ? err.message : `HTTP ${res.status}`,
    ...(err?.details !== undefined && { details: err.details }),
  };
}

/** Build `?a=1&b=2` from a record, skipping empty values. */
export function query(params: Record<string, string | number | undefined | null>): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      usp.set(key, String(value));
    }
  }
  const text = usp.toString();
  return text ? `?${text}` : '';
}
