// ============================================================
// App.tsx — thin orchestrator
// All business logic lives in dedicated hooks; this file only
// wires them together and renders the top-level layout.
// ============================================================

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { AnimatePresence } from 'motion/react';

import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { Composer } from './components/Composer';
import { MessageBubble } from './components/MessageBubble';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ScrollArea } from '@/components/ui/scroll-area';

import { useAuth } from './hooks/useAuth';
import { useSessions } from './hooks/useSessions';
import { useChat, MAX_MESSAGES } from './hooks/useChat';
import { clearCsrfToken } from './lib/api';
import { ANALYTICS_SCHEMA } from './constants/schema';

/**
 * Main Application Component.
 * Acts as a thin orchestrator that wires together the authentication,
 * session management, and chat logic hooks.
 */
export default function App() {
  // ── Schema state ──────────────────────────────────────────
  const [schema, setSchema] = useState(ANALYTICS_SCHEMA);

  // ── Session management ────────────────────────────────────
  const {
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
  } = useSessions();

  // ── Auth ──────────────────────────────────────────────────
  const { isAuthenticated, isCheckingAuth, setIsAuthenticated, handleLogin, handleLogout } =
    useAuth(setSchema);

  // Full logout: clear sessions + CSRF token + reset schema
  const fullLogout = useCallback(async () => {
    await handleLogout();
    clearCsrfToken();
    clearAllSessions();
    setSchema(ANALYTICS_SCHEMA);
  }, [handleLogout, clearAllSessions]);

  // ── UI state ──────────────────────────────────────────────
  const [input, setInput] = useState('');
  const [reviewBeforeExecuting, setReviewBeforeExecuting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Chat ──────────────────────────────────────────────────
  const { handleSend, approveAndExecute, abortCurrent, isTyping } = useChat({
    messages,
    setMessages,
    setTokenUsage,
    schema,
    reviewBeforeExecuting,
    onAuthExpired: () => setIsAuthenticated(false),
  });

  // When user switches sessions, abort any in-flight stream
  const handleSwitchSession = useCallback(
    (id: string) => {
      abortCurrent();
      switchSession(id);
    },
    [abortCurrent, switchSession],
  );

  // ── Auto-scroll ───────────────────────────────────────────
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    // Delayed scroll accounts for chart rendering
    const t = setTimeout(() => {
      el.scrollTop = el.scrollHeight;
    }, 120);
    return () => clearTimeout(t);
  }, [messages, isTyping]);

  // ── Send helpers ──────────────────────────────────────────
  const submitQuery = useCallback(() => {
    const q = input.trim();
    if (!q) return;
    setInput('');
    void handleSend(q);
  }, [input, handleSend]);

  const handleSuggestedQuery = useCallback(
    (q: string) => {
      void handleSend(q);
    },
    [handleSend],
  );

  const handleApproveSQL = useCallback(
    (messageId: string, sql: string, explanation: string, parentMessageId: string) => {
      void approveAndExecute(messageId, sql, explanation, parentMessageId);
    },
    [approveAndExecute],
  );

  const handleCancelReview = useCallback(
    (messageId: string) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? { ...m, needsReview: false, content: 'Query review cancelled.' }
            : m,
        ),
      );
    },
    [setMessages],
  );

  return (
    <ErrorBoundary>
      <div className="flex h-screen flex-col bg-slate-50 text-slate-900 font-sans technical-grid">
        {/* ── Header ────────────────────────────────────────── */}
        <Header
          isAuthenticated={isAuthenticated}
          isCheckingAuth={isCheckingAuth}
          tokenUsage={tokenUsage}
          schema={schema}
          onLogin={handleLogin}
          onLogout={fullLogout}
        />

        {/* ── Main content ──────────────────────────────────── */}
        <main className="flex flex-1 overflow-hidden">
          {/* Chat area */}
          <div className="relative flex flex-1 flex-col overflow-hidden">
            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-6" ref={scrollRef}>
              <div className="mx-auto max-w-3xl space-y-8 pb-4">
                <AnimatePresence initial={false}>
                  {messages.map((message) => (
                    <MessageBubble
                      key={message.id}
                      message={message}
                      onApproveSQL={handleApproveSQL}
                      onCancelReview={handleCancelReview}
                    />
                  ))}
                </AnimatePresence>
              </div>
            </div>

            {/* Input composer */}
            <Composer
              input={input}
              onChange={setInput}
              onSend={submitQuery}
              isTyping={isTyping}
              messageCount={messages.length}
              maxMessages={MAX_MESSAGES}
              reviewBeforeExecuting={reviewBeforeExecuting}
              onToggleReview={setReviewBeforeExecuting}
            />
          </div>

          {/* ── Sidebar ──────────────────────────────────────── */}
          <Sidebar
            isAuthenticated={isAuthenticated}
            sessions={sessions}
            activeSessionId={activeSessionId}
            onNewSession={createNewSession}
            onSwitchSession={handleSwitchSession}
            onDeleteSession={deleteSession}
            onSuggestedQuery={handleSuggestedQuery}
          />
        </main>
      </div>
    </ErrorBoundary>
  );
}
