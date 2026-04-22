// ============================================================
// Client-side structured logger
// — Removed circular import of Message (was unused)
// — Logs are batched and flushed asynchronously so UI is never blocked
// — Fails silently on send errors to prevent infinite error loops
// ============================================================

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  message: string;
  context?: unknown;
  timestamp: string;
}

const MAX_QUEUE = 50; // drop oldest entries if the server is unreachable

class ClientLogger {
  private queue: LogEntry[] = [];
  private flushing = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  private scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, 0);
  }

  private async flush() {
    if (this.flushing || this.queue.length === 0) return;
    this.flushing = true;

    // Take up to 10 entries at once
    const batch = this.queue.splice(0, 10);

    try {
      await fetch('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(batch),
      });
    } catch {
      // Intentional: never let a logging failure break the app.
    } finally {
      this.flushing = false;
      // If more entries arrived while we were flushing, schedule another pass
      if (this.queue.length > 0) this.scheduleFlush();
    }
  }

  private record(level: LogLevel, message: string, context?: unknown) {
    const entry: LogEntry = {
      level,
      message,
      context,
      timestamp: new Date().toISOString(),
    };

    // Mirror to browser console for local debugging
    console[level](`[${level.toUpperCase()}] ${message}`, context ?? '');

    // Cap queue to avoid unbounded memory growth when server is down
    if (this.queue.length >= MAX_QUEUE) {
      this.queue.shift();
    }
    this.queue.push(entry);
    this.scheduleFlush();
  }

  info(message: string, context?: unknown) {
    this.record('info', message, context);
  }

  warn(message: string, context?: unknown) {
    this.record('warn', message, context);
  }

  error(message: string, context?: unknown) {
    this.record('error', message, context);
  }

  logAuthError(error: unknown) {
    this.error('Authentication Error', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }

  logQueryError(question: string, error: unknown) {
    this.error('BigQuery Query Error', {
      question,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export const logger = new ClientLogger();
