import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProxyMiddleware } from 'http-proxy-middleware';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 5173);
const API_TARGET = process.env.API_TARGET || 'http://localhost:5002';

const app = express();

app.disable('x-powered-by');

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
    console.log(`Proxying /api -> ${API_TARGET}`);
  });
}

export default app;