// ============================================================
// InsightStream — Vercel Serverless Function entry point
//
// Vercel routes all /api/* and /auth/* traffic here via the
// rewrites defined in vercel.json. The dist/ build output is
// served directly from Vercel's CDN (no Express static needed).
//
// ⚠ Streaming (SSE) — function duration limits:
//   Hobby plan : 10s max → long Gemini responses may time out.
//                Upgrade to Pro or use Vercel's streaming edge config.
//   Pro plan   : 60s max (configured via "maxDuration" in vercel.json).
//   Edge runtime is NOT used here — cookie-session requires Node.js.
//
// ⚠ In-memory caches (e.g. schemaCache):
//   Persist within a warm lambda invocation chain.
//   Reset on every cold start — the cache repopulates on demand.
// ============================================================

import { createApp } from '../src/server/createApp';

// Export the Express app as the default Vercel Node.js handler.
// Vercel's Node.js runtime accepts an Express app directly.
export default createApp({ serveStatic: false });
