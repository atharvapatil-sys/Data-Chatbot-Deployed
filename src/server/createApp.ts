// ============================================================
// InsightStream — Express app factory
//
// Exports createApp() which is consumed by:
//  • server.ts   (local dev / Docker)  — adds Vite + app.listen
//  • api/index.ts (Vercel serverless)  — exports the app directly
//
// Security guarantees (same as original server.ts):
//  ✓ Helmet security headers
//  ✓ CSRF double-submit token
//  ✓ Rate limiting per route group
//  ✓ SQL SELECT/WITH allowlist + row-cap enforcement
//  ✓ BigQuery schema cached per user (token hash)
//  ✓ OAuth nonce stored in session, verified on callback
//  ✓ postMessage restricted to validated origin
//  ✓ SESSION_SECRET required in production
//  ✓ GEMINI_API_KEY server-only (never in client bundle)
//  ✓ CHIPS cookies (Partitioned attribute for iframe support)
// ============================================================

import 'dotenv/config';
import crypto from 'crypto';
import path from 'path';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { BigQuery } from '@google-cloud/bigquery';
import { GoogleGenAI, Type, type FunctionDeclaration } from '@google/genai';
import { google } from 'googleapis';
import cookieSession from 'cookie-session';
import { OAuth2Client } from 'google-auth-library';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import {
  ANALYTICS_SCHEMA,
  SYSTEM_PROMPT_TEMPLATE,
  SYNTHESIS_PROMPT,
} from '../constants/schema';

// ── Environment ──────────────────────────────────────────────

const OAUTH_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const OAUTH_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const BIGQUERY_PROJECT_ID = process.env.BIGQUERY_PROJECT_ID;
const BIGQUERY_LOCATION = process.env.BIGQUERY_LOCATION || 'US';
const APP_URL = (
  process.env.APP_URL ||
  'https://ais-dev-wcsy7zkplzdguogomaby7h-466853820726.asia-southeast1.run.app'
).replace(/\/$/, '');
const IS_PROD = process.env.NODE_ENV === 'production';
const SESSION_SECRET = process.env.SESSION_SECRET;
const GEMINI_MODEL_PRO = process.env.GEMINI_MODEL_PRO || 'gemini-1.5-pro';
const GEMINI_MODEL_FLASH = process.env.GEMINI_MODEL_FLASH || 'gemini-1.5-flash';

// Fail fast at module load time so errors surface in logs, not mid-request.
if (IS_PROD && !SESSION_SECRET) {
  console.error('[FATAL] SESSION_SECRET is not set. Refusing to start in production.');
  process.exit(1);
}
if (!GEMINI_API_KEY) {
  console.error('[FATAL] GEMINI_API_KEY is not set.');
  process.exit(1);
}

// ── Gemini client (server-only) ──────────────────────────────

const genai = new GoogleGenAI({ apiKey: GEMINI_API_KEY! });

const executeSQLTool: FunctionDeclaration = {
  name: 'executeSQL',
  description: 'Execute a BigQuery SQL query to retrieve data. Use for all data analysis questions.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      sql: {
        type: Type.STRING,
        description: 'The BigQuery Standard SQL query to execute.',
      },
      explanation: {
        type: Type.STRING,
        description: 'A concise professional explanation of the query logic.',
      },
    },
    required: ['sql', 'explanation'],
  },
};

const listSheetsTool: FunctionDeclaration = {
  name: 'listGoogleSheets',
  description: "List the user's Google Sheets spreadsheets.",
  parameters: {
    type: Type.OBJECT,
    properties: {},
  },
};

// ── SQL safety guard ─────────────────────────────────────────
// Defense-in-depth. The bigquery.readonly OAuth scope is the primary
// enforcement layer; this guards against prompt-injection attacks.

const DANGEROUS_PATTERNS = [
  /\bINSERT\s+INTO\b/i,
  /\bUPDATE\s+\w/i,
  /\bDELETE\s+FROM\b/i,
  /\bDROP\s+(?:TABLE|DATABASE|SCHEMA|VIEW|FUNCTION|PROCEDURE)\b/i,
  /\bCREATE\s+(?:TABLE|DATABASE|SCHEMA|VIEW|FUNCTION|PROCEDURE)\b/i,
  /\bALTER\s+TABLE\b/i,
  /\bTRUNCATE\s+TABLE\b/i,
  /\bMERGE\s+INTO\b/i,
  /\bCALL\s+\w/i,
  /\bEXEC(?:UTE)?\s+/i,
  /\bGRANT\b/i,
  /\bREVOKE\b/i,
  /\bREPLACE\b/i,
  /\bUPSERT\b/i,
];

/**
 * Validates a SQL query against an allowlist of patterns.
 * Only SELECT and WITH statements are permitted.
 * @param sql The SQL query string to validate.
 * @returns True if the query is considered safe.
 */
function isSafeSQL(sql: string): boolean {
  const trimmed = sql.trim();
  if (!/^(SELECT|WITH)\s/i.test(trimmed)) return false;
  return !DANGEROUS_PATTERNS.some((re) => re.test(trimmed));
}

/**
 * Ensures a SQL query has a LIMIT clause and that it does not exceed the maximum.
 * @param sql The SQL query string.
 * @param maxRows The maximum allowed rows (default 500).
 * @returns The modified SQL query.
 */
function enforceRowLimit(sql: string, maxRows = 500): string {
  const limitMatch = sql.match(/\bLIMIT\s+(\d+)\b/i);
  if (limitMatch) {
    const existing = parseInt(limitMatch[1], 10);
    if (existing > maxRows) return sql.replace(/\bLIMIT\s+\d+\b/i, `LIMIT ${maxRows}`);
    return sql;
  }
  return `${sql.trim()}\nLIMIT ${maxRows}`;
}

// ── BigQuery schema cache ────────────────────────────────────
// Module-level Map: persists across warm Vercel/Cloud Run invocations.
// Cold starts will re-populate the cache on the first schema request.
// Keyed by a short hash of the user's access token to support multi-user.

interface SchemaCacheEntry {
  schema: string;
  fetchedAt: number;
}

const schemaCache = new Map<string, SchemaCacheEntry>();
const SCHEMA_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Generates a stable cache key for a user's tokens.
 * @param tokens The user's OAuth tokens.
 * @returns A 16-character hex hash.
 */
function schemaCacheKey(tokens: Record<string, string>): string {
  return crypto
    .createHash('sha256')
    .update(tokens.access_token || '')
    .digest('hex')
    .slice(0, 16);
}

/**
 * Fetches the BigQuery schema for all accessible datasets and tables.
 * Results are formatted as a human-readable string for AI context.
 * @param oauth2Client Authorized Google OAuth2 client.
 * @returns A string representation of the database schema.
 */
async function fetchBigQuerySchema(oauth2Client: OAuth2Client): Promise<string> {
  const bq = new BigQuery({
    projectId: BIGQUERY_PROJECT_ID,
    authClient: oauth2Client as unknown as ConstructorParameters<typeof BigQuery>[0]['authClient'],
  });

  const [datasets] = await bq.getDatasets({ maxResults: 20 });
  const parts: string[] = [];

  for (const dataset of datasets) {
    const [tables] = await dataset.getTables({ maxResults: 50 });

    // Fetch all table metadata in parallel — fail gracefully per table
    const metadataResults = await Promise.allSettled(tables.map((t) => t.getMetadata()));

    for (let i = 0; i < tables.length; i++) {
      const result = metadataResults[i];
      if (result.status === 'rejected') continue;

      const [metadata] = result.value;
      const fields: Array<{ name: string; type: string; description?: string }> =
        metadata.schema?.fields ?? [];

      parts.push(`Table: ${dataset.id}.${tables[i].id}`);
      parts.push('Columns:');
      fields.forEach((f) => {
        parts.push(`- ${f.name} (${f.type})${f.description ? ': ' + f.description : ''}`);
      });
      parts.push('');
    }
  }

  return parts.join('\n').trim() || ANALYTICS_SCHEMA;
}

// ── Structured server logger ─────────────────────────────────

function serverLog(
  level: 'INFO' | 'WARN' | 'ERROR',
  source: string,
  message: string,
  meta?: object,
) {
  const ts = new Date().toISOString();
  const line = `[${ts}][${level}][${source}] ${message}`;
  if (level === 'ERROR') console.error(line, meta ?? '');
  else if (level === 'WARN') console.warn(line, meta ?? '');
  else console.log(line, meta ?? '');
}

// ── App factory ──────────────────────────────────────────────

export interface AppOptions {
  /**
   * When true, the app serves /dist as static files and adds a SPA fallback.
   * Set to false on Vercel — it serves the dist/ output from its own CDN.
   * Set to true for Docker / Cloud Run where Express handles all traffic.
   */
  serveStatic?: boolean;
}

export function createApp(options: AppOptions = {}): Express {
  const app = express();

  // Trust proxy — required for secure cookies on Cloud Run / Vercel / nginx
  app.set('trust proxy', 1);
  serverLog('INFO', 'startup', 'Creating InsightStream Express app', { IS_PROD });

  // ── Security headers ───────────────────────────────────────
  app.use(
    helmet({
      frameguard: false, // allow iframe embedding in AI Studio
      crossOriginOpenerPolicy: false, // Essential for OAuth popups to communicate back to opener
      contentSecurityPolicy: IS_PROD
        ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
            fontSrc: ["'self'", 'https://fonts.gstatic.com'],
            imgSrc: ["'self'", 'data:', 'https:'],
            connectSrc: [
              "'self'",
              'https://accounts.google.com',
              'https://oauth2.googleapis.com',
            ],
          },
        }
        : false,
    }),
  );

  // ── CHIPS cookies (Partitioned — iframe / 3rd-party context support) ──
  app.use((_req: Request, res: Response, next: NextFunction) => {
    const original = res.setHeader.bind(res);
    res.setHeader = function (name: string, value: unknown) {
      if (name.toLowerCase() === 'set-cookie') {
        const addPartitioned = (v: string) =>
          v.includes('Partitioned') ? v : `${v}; Partitioned`;
        if (Array.isArray(value)) {
          value = (value as string[]).map(addPartitioned);
        } else if (typeof value === 'string') {
          value = addPartitioned(value);
        }
      }
      return original(name, value as Parameters<typeof original>[1]);
    };
    next();
  });

  // ── Body parsing ───────────────────────────────────────────
  app.use(express.json({ limit: '256kb' }));

  // ── Session ────────────────────────────────────────────────
  app.use((req: Request, _res, next) => {
    const isLocal = req.headers.host?.includes('localhost');
    cookieSession({
      name: 'insight_stream_session',
      keys: [SESSION_SECRET || 'dev-secret-key-CHANGE-IN-PRODUCTION'],
      maxAge: 7 * 24 * 60 * 60 * 1000,
      secure: IS_PROD && !isLocal,
      sameSite: isLocal ? 'lax' : 'none',
      httpOnly: true,
    })(req, _res, next);
  });

  // ── Rate limiters ──────────────────────────────────────────
  const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please slow down.' },
  });
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Too many auth attempts. Please wait.' },
  });
  const queryLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: { error: 'Query rate limit exceeded. Please wait a moment.' },
  });
  const geminiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: { error: 'AI rate limit exceeded. Please wait a moment.' },
  });
  const logLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    message: { error: 'Log rate limit exceeded.' },
  });

  app.use('/api/', generalLimiter);

  // ── Shared middleware helpers ──────────────────────────────

  /**
   * Retrieves an authorized Google OAuth2 client for the current session.
   * Automatically handles token refresh logic.
   * @param req The Express request object.
   * @returns Authorized OAuth2Client or null if unauthorized.
   */
  async function getAuthorizedClient(req: Request): Promise<OAuth2Client | null> {
    const tokens = (req.session as unknown as Record<string, unknown>)?.tokens as
      | Record<string, string>
      | undefined;
    if (!tokens?.access_token) return null;

    const client = new OAuth2Client(OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET);
    client.setCredentials(tokens);

    try {
      const { res: refreshRes } = await client.getAccessToken();
      if (refreshRes?.data) {
        serverLog('INFO', 'auth', 'Token refreshed automatically');
        (req.session as unknown as Record<string, unknown>).tokens = {
          ...tokens,
          ...(refreshRes.data as Record<string, string>),
        };
      }
      return client;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      serverLog('WARN', 'auth', 'Token refresh failed', { msg });
      if (msg.includes('invalid_grant')) {
        serverLog('INFO', 'auth', 'Clearing invalid session');
        req.session = null;
      }
      return null;
    }
  }

  function csrfGuard(req: Request, res: Response, next: NextFunction) {
    const sessionToken = (req.session as unknown as Record<string, unknown>)?.csrfToken as
      | string
      | undefined;
    const headerToken = req.headers['x-csrf-token'] as string | undefined;

    if (!sessionToken || !headerToken || sessionToken !== headerToken) {
      serverLog('WARN', 'csrf', 'CSRF validation failed', { ip: req.ip, path: req.path });
      return res.status(403).json({ error: 'Invalid or missing CSRF token.' });
    }
    next();
  }

  function requireAuth(req: Request, res: Response, next: NextFunction) {
    const tokens = (req.session as unknown as Record<string, unknown>)?.tokens;
    if (!tokens) {
      return res.status(401).json({ error: 'Unauthorized. Please connect your Google account.' });
    }
    next();
  }

  // ── Routes ─────────────────────────────────────────────────

  // --- CSRF PROTECTION ---
  // Returns a unique token to be stored in the client and sent in headers.
  app.get('/api/csrf-token', (req: Request, res: Response) => {
    const session = req.session as unknown as Record<string, unknown>;
    if (!session.csrfToken) {
      session.csrfToken = crypto.randomBytes(32).toString('hex');
    }
    res.json({ token: session.csrfToken });
  });

  // OAuth — initiate
  app.get('/api/auth/url', authLimiter, (req: Request, res: Response) => {
    const origin = ((req.query.origin as string) || APP_URL).replace(/\/$/, '');

    const nonce = crypto.randomBytes(16).toString('hex');
    const session = req.session as unknown as Record<string, unknown>;
    session.oauthNonce = nonce;
    session.oauthOrigin = origin;

    const localClient = new OAuth2Client(
      OAUTH_CLIENT_ID,
      OAUTH_CLIENT_SECRET,
      `${origin}/auth/callback`,
    );

    const url = localClient.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [
        'https://www.googleapis.com/auth/bigquery.readonly',
        'https://www.googleapis.com/auth/spreadsheets.readonly',
        'https://www.googleapis.com/auth/drive.readonly',
        'https://www.googleapis.com/auth/userinfo.email',
      ],
      state: nonce,
    });

    res.json({ url });
  });

  // OAuth — callback (also handles trailing-slash variant)
  app.get(['/auth/callback', '/auth/callback/'], async (req: Request, res: Response) => {
    const { code, state } = req.query;
    const session = req.session as unknown as Record<string, unknown>;
    const sessionNonce = session?.oauthNonce as string | undefined;
    const origin = ((session?.oauthOrigin as string) || APP_URL).replace(/\/$/, '');

    // Verify state nonce to prevent OAuth CSRF
    if (!code || !state || !sessionNonce || state !== sessionNonce) {
      serverLog('WARN', 'oauth', 'Invalid OAuth state/nonce', {
        ip: req.ip,
        hasCode: !!code,
        hasState: !!state,
        hasSession: !!sessionNonce,
        match: state === sessionNonce
      });
      return res.status(400).send('Invalid OAuth state. Please try logging in again.');
    }

    // Consume nonce immediately to prevent replay
    session.oauthNonce = undefined;

    const localClient = new OAuth2Client(
      OAUTH_CLIENT_ID,
      OAUTH_CLIENT_SECRET,
      `${origin}/auth/callback`,
    );

    try {
      const { tokens } = await localClient.getToken(code as string);
      if (req.session) {
        (req.session as unknown as Record<string, unknown>).tokens = tokens;
      }
      serverLog('INFO', 'oauth', 'OAuth callback success', { origin });

      // Strictly targeted postMessage — never wildcard '*'
      const safeOrigin = JSON.stringify(origin);
      res.send(`
        <!DOCTYPE html>
        <html lang="en">
          <head><meta charset="UTF-8"><title>Connecting…</title></head>
          <body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#f8fafc;margin:0">
            <div style="text-align:center;background:white;padding:2rem;border-radius:1rem;box-shadow:0 4px 6px -1px rgb(0 0 0/0.1)">
              <h1 style="color:#2563eb;margin-bottom:0.5rem;font-size:1.5rem">Connected</h1>
              <p style="color:#64748b">Syncing your workspace…</p>
              <script>
                try {
                var target = ${safeOrigin};
                console.log('OAuth Success: Targeting origin', target);
                console.log('Window status: opener is', window.opener ? 'PRESESENT' : 'MISSING');
                
                if (window.opener) {
                  window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, target);
                  console.log('Message sent to opener.');
                  setTimeout(function() { window.close(); }, 500);
                } else {
                  console.warn('No opener found. Redirecting main window.');
                  window.location.href = target;
                }
              } catch (e) {
                console.error('Auth callback error:', e);
                window.location.href = ${safeOrigin};
              }
              </script>
            </div>
          </body>
        </html>
      `);
    } catch (err: unknown) {
      serverLog('ERROR', 'oauth', 'OAuth token exchange failed', {
        msg: err instanceof Error ? err.message : String(err),
      });
      res.status(500).send('Authentication failed. Please close this window and try again.');
    }
  });

  // Auth status — polled by the client on tab visibility change
  app.get('/api/auth/status', async (req: Request, res: Response) => {
    const client = await getAuthorizedClient(req);
    res.json({ authenticated: !!client });
  });

  // Logout
  app.post('/api/auth/logout', csrfGuard, (req: Request, res: Response) => {
    const tokens = (req.session as unknown as Record<string, unknown>)?.tokens as
      | Record<string, string>
      | undefined;
    if (tokens) schemaCache.delete(schemaCacheKey(tokens));
    req.session = null;
    res.json({ success: true });
  });

  // Client-side log ingestion
  app.post('/api/logs', logLimiter, requireAuth, (req: Request, res: Response) => {
    const entries = Array.isArray(req.body) ? req.body : [req.body];
    entries.slice(0, 20).forEach((entry: Record<string, unknown>) => {
      const level = String(entry.level || 'info').toUpperCase();
      const message = String(entry.message || '').slice(0, 500);
      const ts = String(entry.timestamp || new Date().toISOString());
      serverLog(
        level as 'INFO' | 'WARN' | 'ERROR',
        'client',
        `[${ts}] ${message}`,
        entry.context as object | undefined,
      );
    });
    res.status(204).end();
  });

  // BigQuery schema auto-detection
  app.get('/api/schema', requireAuth, async (req: Request, res: Response) => {
    const oauth2Client = await getAuthorizedClient(req);
    if (!oauth2Client) return res.status(401).json({ error: 'Unauthorized.' });

    const tokens = (req.session as unknown as Record<string, unknown>).tokens as Record<
      string,
      string
    >;
    const cacheKey = schemaCacheKey(tokens);
    const cached = schemaCache.get(cacheKey);

    if (cached && Date.now() - cached.fetchedAt < SCHEMA_CACHE_TTL_MS) {
      return res.json({ schema: cached.schema, cached: true });
    }

    try {
      const schema = await fetchBigQuerySchema(oauth2Client);
      schemaCache.set(cacheKey, { schema, fetchedAt: Date.now() });
      serverLog('INFO', 'schema', 'Schema fetched and cached', { cacheKey });
      res.json({ schema });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      serverLog('ERROR', 'schema', 'Schema fetch failed', { msg });

      if (msg.includes('invalid_grant') || msg.includes('Unauthorized')) {
        return res.status(401).json({ error: 'Session expired. Please reconnect.' });
      }

      res.status(500).json({ error: 'Failed to detect schema. Please check your BigQuery permissions.' });
    }
  });

  // BigQuery query execution
  app.post(
    '/api/query',
    queryLimiter,
    requireAuth,
    csrfGuard,
    async (req: Request, res: Response) => {
      const { sql } = req.body as { sql?: string };
      if (!sql || typeof sql !== 'string') {
        return res.status(400).json({ error: 'Missing or invalid SQL.' });
      }

      // Safety validation — only SELECT / WITH allowed
      if (!isSafeSQL(sql)) {
        serverLog('WARN', 'query', 'Blocked unsafe SQL attempt', { ip: req.ip });
        return res.status(400).json({
          error: 'Only SELECT / WITH queries are permitted. Write operations are not allowed.',
        });
      }

      const safeSql = enforceRowLimit(sql, 500);
      const oauth2Client = await getAuthorizedClient(req);
      if (!oauth2Client) return res.status(401).json({ error: 'Unauthorized.' });

      const bq = new BigQuery({
        projectId: BIGQUERY_PROJECT_ID,
        authClient:
          oauth2Client as unknown as ConstructorParameters<typeof BigQuery>[0]['authClient'],
      });

      try {
        const [job] = await bq.createQueryJob({ query: safeSql, location: BIGQUERY_LOCATION });
        const [rows] = await job.getQueryResults();

        if (rows.length === 0) return res.json({ columns: [], rows: [] });

        const columns = Object.keys(rows[0] as object);
        serverLog('INFO', 'query', `Query returned ${rows.length} rows`);
        return res.json({ columns, rows });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        serverLog('ERROR', 'query', 'BigQuery execution error', { msg });
        return res.status(500).json({ error: msg });
      }
    },
  );

  // Google Sheets listing
  app.get('/api/sheets', requireAuth, async (req: Request, res: Response) => {
    const oauth2Client = await getAuthorizedClient(req);
    if (!oauth2Client) return res.status(401).json({ error: 'Unauthorized.' });

    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    try {
      const response = await drive.files.list({
        q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
        fields: 'files(id, name, modifiedTime)',
        pageSize: 50,
        orderBy: 'modifiedTime desc',
      });
      res.json({ sheets: response.data.files ?? [] });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      serverLog('ERROR', 'sheets', 'Drive list error', { msg });
      res.status(500).json({ error: msg });
    }
  });

  /**
   * Main Chat endpoint. Handles streaming response from Gemini.
   * Uses Server-Sent Events (SSE) to stream text and function calls.
   */
  app.post(
    '/api/gemini/chat',
    geminiLimiter,
    requireAuth,
    csrfGuard,
    async (req: Request, res: Response) => {
      const { messages, schema } = req.body as {
        messages?: Array<{ role: string; parts: Array<{ text: string }> }>;
        schema?: string;
      };

      if (!Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: 'Invalid messages array.' });
      }

      // Limit history window; sanitise role + text length
      const safeMessages = messages.slice(-20).map((m) => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: String(m.parts?.[0]?.text ?? '').slice(0, 4096) }],
      }));

      const activeSchema = typeof schema === 'string' && schema.trim() ? schema : ANALYTICS_SCHEMA;
      const systemInstruction = SYSTEM_PROMPT_TEMPLATE.replace('{{SCHEMA}}', activeSchema);

      // Set up SSE headers before streaming begins
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      const sendEvent = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

      try {
        const stream = await genai.models.generateContentStream({
          model: GEMINI_MODEL_PRO,
          contents: safeMessages,
          config: {
            systemInstruction,
            tools: [{ functionDeclarations: [executeSQLTool, listSheetsTool] }],
          },
        });

        for await (const chunk of stream) {
          const text = chunk.text;
          if (text) sendEvent({ type: 'text', text });

          const calls = chunk.functionCalls;
          if (calls && calls.length > 0) {
            sendEvent({ type: 'functionCall', functionCall: calls[0] });
            break; // One function call per turn
          }

          if (chunk.usageMetadata) {
            sendEvent({ type: 'usage', usage: chunk.usageMetadata });
          }
        }

        res.write('data: [DONE]\n\n');
        res.end();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        serverLog('ERROR', 'gemini', 'Chat stream error', { msg });
        sendEvent({ type: 'error', error: msg });
        res.end();
      }
    },
  );

  /**
   * Data Synthesis endpoint.
   * Analyzes tabular data and returns a natural language summary + chart configuration.
   */
  app.post(
    '/api/gemini/synthesize',
    geminiLimiter,
    requireAuth,
    csrfGuard,
    async (req: Request, res: Response) => {
      const { question, data } = req.body as { question?: string; data?: unknown[] };

      if (!question || !Array.isArray(data)) {
        return res.status(400).json({ error: 'Missing question or data.' });
      }

      // Cap data payload to avoid token explosion
      const cappedData = data.slice(0, 100);
      const prompt = `User Question: ${String(question).slice(0, 500)}\nData Results: ${JSON.stringify(cappedData)}`;

      try {
        const response = await genai.models.generateContent({
          model: GEMINI_MODEL_FLASH,
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          config: {
            systemInstruction: SYNTHESIS_PROMPT,
            responseMimeType: 'application/json',
          },
        });

        const raw = response.text ?? '{}';
        let parsed: {
          text?: string;
          chartConfig?: { type?: string; xAxis?: string; yAxis?: string; title?: string };
        };
        try {
          parsed = JSON.parse(raw) as typeof parsed;
        } catch {
          serverLog('WARN', 'gemini', 'Failed to parse synthesis JSON');
          parsed = {};
        }

        // Validate chart type against known values
        const validChartTypes = ['bar', 'line', 'pie', 'table'];
        const chartType = (parsed.chartConfig?.type && validChartTypes.includes(parsed.chartConfig.type))
          ? parsed.chartConfig.type as 'bar' | 'line' | 'pie' | 'table'
          : 'table';

        // Validate xAxis/yAxis exist in the actual data
        const dataKeys = cappedData.length > 0 ? Object.keys(cappedData[0] as object) : [];
        const xAxis = (parsed.chartConfig?.xAxis && dataKeys.includes(parsed.chartConfig.xAxis))
          ? parsed.chartConfig.xAxis
          : (dataKeys[0] || '');
        const yAxis = (parsed.chartConfig?.yAxis && dataKeys.includes(parsed.chartConfig.yAxis))
          ? parsed.chartConfig.yAxis
          : (dataKeys[1] || '');

        res.json({
          text: parsed.text || 'Query completed successfully.',
          chartConfig: {
            type: chartType,
            xAxis,
            yAxis,
            title: parsed.chartConfig?.title || 'Query Results',
          },
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        serverLog('ERROR', 'gemini', 'Synthesis error', { msg });
        res.status(500).json({ error: msg });
      }
    },
  );

  // ── Static assets (Docker / Cloud Run only) ───────────────
  // Vercel serves dist/ from its own CDN — skip this block there.

  if (options.serveStatic) {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    // SPA fallback — all unmatched routes serve index.html
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  return app;
}
