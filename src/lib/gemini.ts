// ============================================================
// Gemini API client — browser side
// All calls are proxied through the Express server.
// The GEMINI_API_KEY never leaves the server.
// ============================================================

import type { GeminiChunk, SynthesisResult } from '../types';
import { getCsrfToken, clearCsrfToken, ApiError } from './api';

// ── Chat (SSE streaming) ─────────────────────────────────────

/**
 * Streams AI chat responses from the server via Server-Sent Events.
 * Yields typed GeminiChunk objects until the stream ends or is aborted.
 */
export async function* chatWithAI(
  messages: Array<{ role: string; parts: Array<{ text: string }> }>,
  schema: string,
  signal?: AbortSignal,
): AsyncGenerator<GeminiChunk> {
  const token = await getCsrfToken();

  const response = await fetch('/api/gemini/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': token,
      'X-Requested-With': 'XMLHttpRequest',
    },
    credentials: 'include',
    body: JSON.stringify({ messages, schema }),
    signal,
  });

  if (response.status === 403) {
    clearCsrfToken();
    throw new ApiError('Request blocked. Please try again.', 403);
  }
  if (response.status === 401) {
    throw new ApiError('Session expired. Please reconnect your Google account.', 401);
  }
  if (!response.ok || !response.body) {
    let msg = `Chat request failed (${response.status})`;
    try {
      const err = (await response.json()) as { error?: string };
      if (err.error) msg = err.error;
    } catch { /* ignore */ }
    throw new ApiError(msg, response.status);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE frames are delimited by double-newline
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';

      for (const frame of frames) {
        if (!frame.startsWith('data: ')) continue;
        const payload = frame.slice(6).trim();
        if (payload === '[DONE]') return;
        try {
          yield JSON.parse(payload) as GeminiChunk;
        } catch {
          // Skip malformed frames; server logs them
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ── Synthesis (standard JSON response) ──────────────────────

/**
 * Asks the server to synthesize a human-readable summary and chart config
 * from raw BigQuery results.
 */
export async function synthesizeResults(
  question: string,
  data: Record<string, unknown>[],
  signal?: AbortSignal,
): Promise<SynthesisResult> {
  const token = await getCsrfToken();

  const response = await fetch('/api/gemini/synthesize', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': token,
      'X-Requested-With': 'XMLHttpRequest',
    },
    credentials: 'include',
    body: JSON.stringify({ question, data }),
    signal,
  });

  if (response.status === 403) {
    clearCsrfToken();
    throw new ApiError('Request blocked. Please try again.', 403);
  }
  if (response.status === 401) {
    throw new ApiError('Session expired. Please reconnect your Google account.', 401);
  }
  if (!response.ok) {
    let msg = `Synthesis failed (${response.status})`;
    try {
      const err = (await response.json()) as { error?: string };
      if (err.error) msg = err.error;
    } catch { /* ignore */ }
    throw new ApiError(msg, response.status);
  }

  return response.json() as Promise<SynthesisResult>;
}
