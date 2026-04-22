// ============================================================
// useSessions — persistent chat session management
//
// Fixes applied vs original App.tsx:
//  ✓ IDs use crypto.randomUUID() — stable, no collision risk
//  ✓ Title logic: ellipsis only added when text is actually long
//  ✓ localStorage writes are debounced (500 ms) to prevent jank
//  ✓ Session cap (MAX_SESSIONS) to avoid unbounded growth
//  ✓ JSON parse wrapped in try/catch
//  ✓ Separate createSession helper keeps state shape consistent
// ============================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import type { ChatSession, Message, TokenUsage } from '../types';

const SESSION_STORAGE_KEY = 'insight-stream-sessions';
const ACTIVE_SESSION_KEY = 'insight-stream-active-session';
const MAX_SESSIONS = 20;
const DEBOUNCE_MS = 500;

const WELCOME_MESSAGE: Message = {
  id: 'welcome',
  role: 'assistant',
  content: 'Welcome to InsightStream. Ready to dive into your BigQuery data.',
};

function makeSession(): ChatSession {
  return {
    id: crypto.randomUUID(),
    title: 'New Analysis',
    messages: [{ ...WELCOME_MESSAGE, id: `welcome-${Date.now()}` }],
    tokens: { prompt: 0, response: 0, total: 0 },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function deriveTitle(messages: Message[], fallback: string): string {
  const first = messages.find((m) => m.role === 'user');
  if (!first?.content) return fallback;
  const text = first.content.trim();
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

export function useSessions() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [tokenUsage, setTokenUsage] = useState<TokenUsage>({ prompt: 0, response: 0, total: 0 });

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Persist to localStorage (debounced) ───────────────────

  const persist = useCallback((updated: ChatSession[]) => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      try {
        localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(updated));
      } catch (err) {
        console.error('[useSessions] Failed to persist sessions:', err);
      }
    }, DEBOUNCE_MS);
  }, []);

  // ── Boot: load from localStorage ─────────────────────────

  useEffect(() => {
    let initial: ChatSession[];
    let targetId: string | null = null;

    try {
      const raw = localStorage.getItem(SESSION_STORAGE_KEY);
      const activeId = localStorage.getItem(ACTIVE_SESSION_KEY);
      initial = raw ? (JSON.parse(raw) as ChatSession[]) : [];

      if (initial.length > 0) {
        targetId =
          activeId && initial.find((s) => s.id === activeId) ? activeId : initial[0].id;
      }
    } catch {
      initial = [];
    }

    if (initial.length === 0 || !targetId) {
      const fresh = makeSession();
      initial = [fresh];
      targetId = fresh.id;
      persist(initial);
      localStorage.setItem(ACTIVE_SESSION_KEY, targetId);
    }

    const active = initial.find((s) => s.id === targetId)!;
    setSessions(initial);
    setActiveSessionId(targetId);
    setMessages(active.messages);
    setTokenUsage(active.tokens ?? { prompt: 0, response: 0, total: 0 });
  }, [persist]);

  // ── Sync active session when messages/tokens change ───────

  useEffect(() => {
    if (!activeSessionId) return;

    setSessions((prev) => {
      const updated = prev.map((s) => {
        if (s.id !== activeSessionId) return s;
        return {
          ...s,
          messages,
          tokens: tokenUsage,
          updatedAt: Date.now(),
          title: deriveTitle(messages, s.title),
        };
      });
      persist(updated);
      return updated;
    });
  }, [messages, tokenUsage, activeSessionId, persist]);

  // ── Actions ────────────────────────────────────────────────

  const createNewSession = useCallback(() => {
    const session = makeSession();
    setSessions((prev) => {
      const updated = [session, ...prev].slice(0, MAX_SESSIONS);
      persist(updated);
      return updated;
    });
    setActiveSessionId(session.id);
    setMessages(session.messages);
    setTokenUsage({ prompt: 0, response: 0, total: 0 });
    localStorage.setItem(ACTIVE_SESSION_KEY, session.id);
    window.alert('New analysis session created.');
  }, [persist]);

  const switchSession = useCallback((id: string) => {
    setSessions((prev) => {
      const target = prev.find((s) => s.id === id);
      if (!target) return prev;
      setActiveSessionId(id);
      setMessages(target.messages);
      setTokenUsage(target.tokens ?? { prompt: 0, response: 0, total: 0 });
      localStorage.setItem(ACTIVE_SESSION_KEY, id);
      return prev;
    });
  }, []);

  const deleteSession = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      setSessions((prev) => {
        const updated = prev.filter((s) => s.id !== id);
        persist(updated);

        // If we deleted the active session, switch to the next available one
        if (id === activeSessionId) {
          if (updated.length > 0) {
            const next = updated[0];
            setActiveSessionId(next.id);
            setMessages(next.messages);
            setTokenUsage(next.tokens ?? { prompt: 0, response: 0, total: 0 });
            localStorage.setItem(ACTIVE_SESSION_KEY, next.id);
          } else {
            // No sessions left — create a fresh one
            const fresh = makeSession();
            const withFresh = [fresh];
            persist(withFresh);
            setActiveSessionId(fresh.id);
            setMessages(fresh.messages);
            setTokenUsage({ prompt: 0, response: 0, total: 0 });
            localStorage.setItem(ACTIVE_SESSION_KEY, fresh.id);
            return withFresh;
          }
        }
        window.alert('Session deleted successfully.');
        return updated;
      });
    },
    [activeSessionId, persist],
  );

  /** Called on logout — wipes all sessions and starts fresh. */
  const clearAllSessions = useCallback(() => {
    clearTimeout(debounceRef.current);
    localStorage.removeItem(SESSION_STORAGE_KEY);
    localStorage.removeItem(ACTIVE_SESSION_KEY);
    const fresh = makeSession();
    setSessions([fresh]);
    setActiveSessionId(fresh.id);
    setMessages(fresh.messages);
    setTokenUsage({ prompt: 0, response: 0, total: 0 });
    persist([fresh]);
    localStorage.setItem(ACTIVE_SESSION_KEY, fresh.id);
  }, [persist]);

  return {
    sessions,
    activeSessionId,
    messages,
    setMessages,
    tokenUsage,
    setTokenUsage,
    createNewSession,
    switchSession,
    deleteSession,
    clearAllSessions,
  };
}
