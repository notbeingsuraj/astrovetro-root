import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProxyMiddleware } from 'http-proxy-middleware';
import staticApi from './src/api/staticApi.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 5173);

/* OPTIONAL. Two ways this server can answer /api, in priority order:

   1. API_TARGET set   -> proxy to the full backend. Unchanged behaviour, and
                          the path a real deployment takes once a backend exists.
   2. API_TARGET unset -> answer from the static catalogue in-process.

   Nothing requires API_TARGET. That is deliberate: an unset target used to fall
   back to http://localhost:5002, which on Vercel meant every page load fell
   through to a proxy aimed at a socket that does not exist there, turning the
   whole catalogue into 502s. An absent backend is now an explicit, supported
   mode rather than an accident. */
const API_TARGET = process.env.API_TARGET ? process.env.API_TARGET.replace(/\/$/, '') : null;

/* Test affordance only. AV_DISABLE_API=1 makes every /api request fail, which is
   how the resilience suite proves the site survives an API that is not merely
   empty but entirely absent. Never set in a real deployment. */
const apiDisabled = process.env.AV_DISABLE_API === '1';

const app = express();

app.disable('x-powered-by');

if (apiDisabled) {
  app.use('/api', (_req, res) => {
    res.status(503).json({
      success: false,
      message: 'The API is unavailable.',
      error: { code: 'API_UNAVAILABLE', message: 'The API is unavailable.' },
    });
  });
  console.log('[api] AV_DISABLE_API=1 - every /api request will fail (resilience testing)');
} else if (API_TARGET) {
  app.use(
    '/api',
    createProxyMiddleware({
      target: API_TARGET,
      changeOrigin: true,
      pathRewrite: (path) => (path.startsWith('/api') ? path : `/api${path}`),
      logLevel: 'warn',
      onError: (_err, _req, res) => {
        res.status(502).json({
          success: false,
          error: {
            code: 'BACKEND_UNAVAILABLE',
            message: `The Astro Vetro backend at ${API_TARGET} is not reachable.`,
          },
        });
      },
    })
  );
  console.log(`[api] proxying /api -> ${API_TARGET}`);
} else {
  app.use('/api', staticApi);
  console.log('[api] API_TARGET not set - serving the static catalogue (no database required)');
}

/* "/" is the gateway — the isolated Crystals | Rituals entry screen — so the
   home page needs its own address and /home.html is no longer a redirect
   target. /home without the extension still lands there. */
app.get('/home', (_req, res) => res.redirect(301, '/home.html'));

app.use(express.static(PUBLIC_DIR, { index: 'index.html', extensions: ['html'] }));

/* Real 404s. A catch-all that serves index.html for every unknown path makes
   broken links look like they work, hides typos, and returns HTML with a 200
   for missing assets, which then fail confusingly in the browser.
   Requests that look like a file (they have an extension) get a bare 404 so a
   broken <script>/<img> does not receive a page of HTML. */
app.use((req, res) => {
  const wantsFile = path.extname(req.path) !== '';
  res.status(404);
  if (wantsFile) {
    res.type('text/plain').send('Not found');
    return;
  }
  res.sendFile(path.join(PUBLIC_DIR, '404.html'), (err) => {
    if (err) res.type('text/plain').send('Not found');
  });
});

/* Locally this file is the process: run it and it listens. On Vercel it is a
   serverless function, where binding a port is wrong — the platform invokes
   the exported handler and manages the socket itself. Calling listen() there
   either hangs the build or leaves the function unreachable, so the two cases
   are kept apart and the app is exported either way. */
const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

if (!isServerless) {
  app.listen(PORT, () => {
    console.log(`Astro Vetro frontend running at http://localhost:${PORT}`);
    console.log(
      API_TARGET
        ? `Proxying /api -> ${API_TARGET}`
        : 'No API_TARGET - catalogue served from the static provider'
    );
  });
}

export default app;