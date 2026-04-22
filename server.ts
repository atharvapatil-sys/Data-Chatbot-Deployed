// ============================================================
// InsightStream — local dev / Docker entry point
//
// Development : Express + Vite dev server (HMR, React fast refresh)
// Production  : Express + serves pre-built dist/ as static files
//
// For Vercel deployment use api/index.ts instead — it imports
// createApp() directly and exports it as a serverless handler.
// ============================================================

import 'dotenv/config';
import { createApp } from './src/server/createApp';

const PORT = parseInt(process.env.PORT || '3000', 10);
const IS_PROD = process.env.NODE_ENV === 'production';

async function startServer() {
  // Production: createApp serves ./dist as static files + SPA fallback.
  // Development: Vite middleware is injected below after the API routes.
  const app = createApp({ serveStatic: IS_PROD });

  if (!IS_PROD) {
    // Dynamically import Vite so it is never bundled into a production image.
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[INFO][startup] Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('[FATAL] Server failed to start:', err);
  process.exit(1);
});
