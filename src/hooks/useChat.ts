// ============================================================
// useChat — AI interaction hook
//
// Fixes applied vs original App.tsx:
//  ✓ AbortController per-request — switching sessions cancels in-flight streams
//  ✓ Token usage: only the FINAL chunk's usageMetadata is accumulated
//    (prevents multi-count from streamed intermediate chunks)
//  ✓ parentMessageId stored on assistant message — review-mode Execute
//    button looks up the correct user question without fragile Date.now() math
//  ✓ MAX_MESSAGES label matches the actual constant (50)
//  ✓ Context window trimmed to HISTORY_WINDOW (last 10 messages)
//    to avoid unbounded token growth
//  ✓ isProcessing guard prevents double-submits
//  ✓ 401 responses set isAuthenticated = false immediately
// ============================================================

import { useCallback, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { chatWithAI, synthesizeResults } from '../lib/gemini';
import { apiPost, ApiError } from '../lib/api';
import { logger } from '../lib/logger';
import type { Message, TokenUsage, GeminiChunk } from '../types';

export const MAX_MESSAGES = 50;
const HISTORY_WINDOW = 10; // last N messages sent as context to Gemini

interface UseChatOptions {
  messages: Message[];
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setTokenUsage: Dispatch<SetStateAction<TokenUsage>>;
  schema: string;
  reviewBeforeExecuting: boolean;
  onAuthExpired: () => void;
}

/**
 * The core chat hook that orchestrates the AI interaction cycle.
 * It handles message state, streaming responses from Gemini, 
 * tool-calling for SQL generation, and query execution against BigQuery.
 */
export function useChat({
  messages,
  setMessages,
  setTokenUsage,
  schema,
  reviewBeforeExecuting,
  onAuthExpired,
}: UseChatOptions) {
  const abortRef = useRef<AbortController | null>(null);
  const isProcessingRef = useRef(false);
  // Keep a mutable ref so callbacks always see the latest messages
  const messagesRef = useRef<Message[]>(messages);
  messagesRef.current = messages;

  // ── Abort any in-flight request ────────────────────────────

  const abortCurrent = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    isProcessingRef.current = false;
  }, []);

  // ── BigQuery execution ─────────────────────────────────────

  const executeSQL = useCallback(
    async (
      messageId: string,
      question: string,
      sql: string,
      explanation: string,
      signal: AbortSignal,
    ) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId ? { ...m, loading: true, needsReview: false } : m,
        ),
      );

      const queryData = await apiPost<{
        columns: string[];
        rows: Record<string, unknown>[];
      }>('/api/query', { sql }, signal);

      const synthesis = await synthesizeResults(question, queryData.rows, signal);

      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? {
              ...m,
              content: synthesis.text,
              sql,
              explanation,
              data: queryData.rows,
              chartConfig: synthesis.chartConfig,
              loading: false,
            }
            : m,
        ),
      );
    },
    [setMessages],
  );

  // ── List Google Sheets ────────────────────────────────────

  const listSheets = useCallback(
    async (signal: AbortSignal): Promise<Array<{ id: string; name: string }>> => {
      const res = await fetch('/api/sheets', {
        credentials: 'include',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        signal,
      });
      if (res.status === 401) {
        onAuthExpired();
        throw new ApiError('Session expired. Please reconnect.', 401);
      }
      if (!res.ok) throw new ApiError('Failed to list Google Sheets.', res.status);
      const data = (await res.json()) as { sheets: Array<{ id: string; name: string }> };
      return data.sheets ?? [];
    },
    [onAuthExpired],
  );

  // ── Main send handler ─────────────────────────────────────

  const handleSend = useCallback(
    async (queryText: string) => {
      if (isProcessingRef.current) return;
      if (!queryText.trim()) return;

      if (messagesRef.current.length >= MAX_MESSAGES) {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: `This chat has reached the ${MAX_MESSAGES}-message limit. Please start a new session to continue.`,
          },
        ]);
        return;
      }

      // Cancel any previous request
      abortCurrent();
      const controller = new AbortController();
      abortRef.current = controller;
      isProcessingRef.current = true;

      const userMsgId = crypto.randomUUID();
      const assistantMsgId = crypto.randomUUID();

      // Append user + loading-assistant messages atomically
      setMessages((prev) => [
        ...prev,
        { id: userMsgId, role: 'user', content: queryText },
        {
          id: assistantMsgId,
          role: 'assistant',
          content: '',
          loading: true,
          parentMessageId: userMsgId,
        },
      ]);

      try {
        // Build a trimmed context window — prevents unbounded token growth
        const history = messagesRef.current
          .filter((m) => !m.loading && m.content)
          .slice(-HISTORY_WINDOW)
          .map((m) => ({ role: m.role, parts: [{ text: m.content }] }));
        history.push({ role: 'user', parts: [{ text: queryText }] });

        const stream = chatWithAI(history, schema, controller.signal);

        let fullText = '';
        let functionCall: { name: string; args: Record<string, unknown> } | null = null;

        let usage: GeminiChunk['usage'] | null = null;

        for await (const chunk of stream) {
          if (controller.signal.aborted) break;

          if (chunk.type === 'text' && chunk.text) {
            fullText += chunk.text;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId ? { ...m, content: fullText, loading: false } : m,
              ),
            );
          }

          if (chunk.type === 'functionCall' && chunk.functionCall) {
            functionCall = chunk.functionCall;
            break;
          }

          if (chunk.type === 'usage' && chunk.usage) {
            usage = chunk.usage;
          }

          if (chunk.type === 'error') {
            throw new Error(chunk.error ?? 'Unknown AI error');
          }
        }

        if (usage) {
          setTokenUsage((prev) => ({
            prompt: prev.prompt + (usage!.promptTokenCount ?? 0),
            response: prev.response + (usage!.candidatesTokenCount ?? 0),
            total: prev.total + (usage!.totalTokenCount ?? 0),
          }));
        }

        if (controller.signal.aborted) return;

        // ── Handle tool calls ─────────────────────────────
        if (functionCall?.name === 'executeSQL') {
          const { sql, explanation } = functionCall.args as {
            sql: string;
            explanation: string;
          };

          if (reviewBeforeExecuting) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? {
                    ...m,
                    content: "I've generated the SQL query. Please review it before I execute it.",
                    sql,
                    explanation,
                    needsReview: true,
                    loading: false,
                  }
                  : m,
              ),
            );
          } else {
            await executeSQL(assistantMsgId, queryText, sql, explanation, controller.signal);
          }
        } else if (functionCall?.name === 'listGoogleSheets') {
          const sheets = await listSheets(controller.signal);
          const content =
            sheets.length > 0
              ? `Found **${sheets.length}** spreadsheet(s) in your Google Drive:\n\n${sheets
                .map((s) => `- **${s.name}** (\`${s.id}\`)`)
                .join('\n')}`
              : 'No Google Sheets spreadsheets were found in your Drive.';

          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId ? { ...m, content, loading: false } : m,
            ),
          );
        } else if (!fullText) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? {
                  ...m,
                  content:
                    "I'm not sure how to handle that request. Could you rephrase your data question?",
                  loading: false,
                }
                : m,
            ),
          );
        }
      } catch (err: unknown) {
        if (controller.signal.aborted) return; // Intentional abort — no error UI

        const error = err instanceof Error ? err : new Error(String(err));
        logger.logQueryError(queryText, error);

        if (err instanceof ApiError && err.status === 401) {
          onAuthExpired();
        }

        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? { ...m, content: `Error: ${error.message}`, loading: false }
              : m,
          ),
        );
      } finally {
        isProcessingRef.current = false;
      }
    },
    [schema, reviewBeforeExecuting, setMessages, setTokenUsage, executeSQL, listSheets, abortCurrent, onAuthExpired],
  );

  // ── Approve and execute a reviewed SQL query ──────────────
  // Uses the stored parentMessageId to look up the original user question.

  const approveAndExecute = useCallback(
    async (messageId: string, sql: string, explanation: string, parentMessageId: string) => {
      if (isProcessingRef.current) return;

      const parentMsg = messagesRef.current.find((m) => m.id === parentMessageId);
      const question = parentMsg?.content ?? '';

      abortCurrent();
      const controller = new AbortController();
      abortRef.current = controller;
      isProcessingRef.current = true;

      try {
        await executeSQL(messageId, question, sql, explanation, controller.signal);
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        const error = err instanceof Error ? err : new Error(String(err));
        logger.logQueryError(question, error);
        if (err instanceof ApiError && err.status === 401) onAuthExpired();
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId ? { ...m, content: `Error: ${error.message}`, loading: false } : m,
          ),
        );
      } finally {
        isProcessingRef.current = false;
      }
    },
    [executeSQL, abortCurrent, onAuthExpired, setMessages],
  );

  const isTyping = messages.some((m) => m.loading);

  return {
    handleSend,
    approveAndExecute,
    abortCurrent,
    isTyping,
    MAX_MESSAGES,
  };
}
