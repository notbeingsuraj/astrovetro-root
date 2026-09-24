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

app.use(express.static(PUBLIC_DIR, { index: 'index.html', extensions: ['html'] }));

app.use((_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Astro Vetro frontend running at http://localhost:${PORT}`);
  console.log(`Proxying /api -> ${API_TARGET}`);
});