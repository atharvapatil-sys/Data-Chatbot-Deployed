// ============================================================
// useAuth — Google OAuth authentication hook
//
// Responsibilities:
//  - Check auth status on mount and on tab-visibility-change
//  - Kick off BigQuery schema detection when authenticated
//  - Handle the OAUTH_AUTH_SUCCESS postMessage from the OAuth popup
//  - Expose login / logout handlers
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import { logger } from '../lib/logger';
import { clearCsrfToken } from '../lib/api';
import { ANALYTICS_SCHEMA } from '../constants/schema';

export function useAuth(onSchemaDetected: (schema: string) => void) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  // ── Schema detection ───────────────────────────────────────

  const detectSchema = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const res = await fetch('/api/schema', {
          credentials: 'include',
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
          signal,
        });
        if (!res.ok) {
          logger.warn('Schema detection returned non-OK status', { status: res.status });
          return;
        }
        const data = (await res.json()) as { schema?: string };
        if (data.schema) onSchemaDetected(data.schema);
      } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') return;
        // Schema detection is non-critical — app falls back to ANALYTICS_SCHEMA
        logger.warn('Schema detection failed', err);
      }
    },
    [onSchemaDetected],
  );

  // ── Auth status check ──────────────────────────────────────

  const checkAuthStatus = useCallback(
    async (signal?: AbortSignal): Promise<boolean> => {
      try {
        setIsCheckingAuth(true);
        const res = await fetch('/api/auth/status', {
          credentials: 'include',
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
          signal,
        });
        if (!res.ok) return false;
        const { authenticated } = (await res.json()) as { authenticated: boolean };
        setIsAuthenticated(authenticated);
        return authenticated;
      } catch (err) {
        if ((err as { name?: string }).name !== 'AbortError') {
          logger.error('Auth status check failed', err);
        }
        return false;
      } finally {
        setIsCheckingAuth(false);
      }
    },
    [],
  );

  // ── Initial check + visibility-based refresh ──────────────
  // Uses tab-visibility instead of a polling interval to avoid
  // unnecessary requests while the user is away.

  useEffect(() => {
    const controller = new AbortController();

    const run = async () => {
      const authed = await checkAuthStatus(controller.signal);
      if (authed) await detectSchema(controller.signal);
    };

    void run();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void run();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      controller.abort();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [checkAuthStatus, detectSchema]);

  // ── OAuth popup callback ───────────────────────────────────

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Only accept messages from the same origin as this window
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== 'OAUTH_AUTH_SUCCESS') return;

      setIsAuthenticated(true);
      // Small delay to let the session cookie propagate before we fetch the schema
      setTimeout(() => void detectSchema(), 800);
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [detectSchema]);

  // ── Login ──────────────────────────────────────────────────

  const handleLogin = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/auth/url?origin=${encodeURIComponent(window.location.origin)}`,
        { credentials: 'include' },
      );
      if (!res.ok) throw new Error('Failed to get auth URL');
      const { url } = (await res.json()) as { url: string };
      // noopener prevents the popup from accessing window.opener (security)
      // but we still need opener for postMessage — omit 'noopener' intentionally
      window.open(url, 'google_oauth', 'width=600,height=700');
    } catch (err) {
      logger.logAuthError(err);
    }
  }, []);

  // ── Logout ─────────────────────────────────────────────────

  const handleLogout = useCallback(async () => {
    clearCsrfToken();
    try {
      // We need a fresh CSRF token for logout (the POST endpoint requires it)
      const tokenRes = await fetch('/api/csrf-token', { credentials: 'include' });
      const { token } = (await tokenRes.json()) as { token: string };

      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'X-CSRF-Token': token,
          'X-Requested-With': 'XMLHttpRequest',
        },
      });
    } catch (err) {
      logger.error('Logout request failed', err);
    } finally {
      setIsAuthenticated(false);
      // Reset schema to default after logout to prevent stale data
      onSchemaDetected(ANALYTICS_SCHEMA);
    }
  }, [onSchemaDetected]);

  return {
    isAuthenticated,
    isCheckingAuth,
    setIsAuthenticated,
    handleLogin,
    handleLogout,
  };
}
