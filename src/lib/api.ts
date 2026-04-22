// ============================================================
// Typed API client with CSRF token management
// All state-changing requests include:
//   - X-CSRF-Token  (server validates against session)
//   - X-Requested-With: XMLHttpRequest  (CORS secondary check)
//   - credentials: 'include'  (send cookies)
// ============================================================

import { logger } from './logger';

// ── CSRF token cache ────────────────────────────────────────
let _csrfToken: string | null = null;

/**
 * Fetches (and caches) the CSRF token from the server.
 * The token is tied to the current session cookie.
 */
export async function getCsrfToken(): Promise<string> {
  if (_csrfToken) return _csrfToken;

  try {
    const res = await fetch('/api/csrf-token', {
      credentials: 'include',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    if (!res.ok) throw new Error(`CSRF fetch failed (${res.status})`);
    const { token } = (await res.json()) as { token: string };
    _csrfToken = token;
    return token;
  } catch (err) {
    logger.error('Failed to obtain CSRF token', err);
    throw err;
  }
}

/**
 * Clears the cached CSRF token.
 * Call this after logout or after receiving a 403 (stale token).
 */
export function clearCsrfToken(): void {
  _csrfToken = null;
}

// ── Error helpers ───────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function parseError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

// ── GET ─────────────────────────────────────────────────────

export async function apiGet<T>(
  url: string,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
    signal,
  });

  if (res.status === 401) {
    throw new ApiError('Session expired. Please reconnect your Google account.', 401);
  }
  if (!res.ok) {
    throw new ApiError(await parseError(res), res.status);
  }
  return res.json() as Promise<T>;
}

// ── POST ────────────────────────────────────────────────────

export async function apiPost<T>(
  url: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  let token: string;
  try {
    token = await getCsrfToken();
  } catch {
    throw new ApiError('Could not obtain security token. Please refresh the page.', 0);
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': token,
      'X-Requested-With': 'XMLHttpRequest',
    },
    credentials: 'include',
    body: JSON.stringify(body),
    signal,
  });

  if (res.status === 401) {
    throw new ApiError('Session expired. Please reconnect your Google account.', 401);
  }
  if (res.status === 403) {
    // Token may be stale (e.g. server restarted); clear so next call re-fetches
    clearCsrfToken();
    throw new ApiError('Request blocked. Please try again.', 403);
  }
  if (!res.ok) {
    throw new ApiError(await parseError(res), res.status);
  }
  return res.json() as Promise<T>;
}
