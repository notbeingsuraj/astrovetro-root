import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import cors from 'cors';
import { createProxyMiddleware } from 'http-proxy-middleware';
import staticApi from './src/api/staticApi.js';
import commerceApi from './src/api/commerceApi.js';
import { connectDB, isConnected, disconnectDB } from './src/db/connect.js';
import { env, assertProductionSecrets } from './src/config/env.js';
import { seedIfEmpty } from './src/db/seed.js';
import { setStorageAdapter, getAvailableAdapters } from './src/utils/storage.js';

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

/* A production deploy must never silently fall back to the read-only static
   catalogue. Doing so would turn a broken database connection into a shop that
   looks healthy and quietly refuses every checkout, so the missing secrets are
   a hard failure there and only there. */
if (env.isProduction) assertProductionSecrets();

/* Initialize storage adapter from STORAGE_ADAPTER env (defaults to 'local').
   Fails fast if an unknown adapter is explicitly configured. */
const storageAdapter = process.env.STORAGE_ADAPTER || 'local';
if (!getAvailableAdapters().includes(storageAdapter)) {
  throw new Error(`Unknown storage adapter: ${storageAdapter}. Available: ${getAvailableAdapters().join(', ')}`);
}
setStorageAdapter(storageAdapter);
console.log(`[storage] using adapter: ${storageAdapter}`);

/* Which provider answers /api. Resolved lazily because connecting is async and
   the app has to be constructed synchronously for both `listen` and the
   serverless export.

   A failed connection resolves to the static provider rather than rejecting, so
   a database outage degrades the site to catalogue-only instead of taking it
   offline. The reason is logged either way — a fallback that is silent is
   indistinguishable from a working database. */
const apiPlan = (() => {
  if (apiDisabled) return { kind: 'disabled' };
  if (API_TARGET) return { kind: 'proxy' };

  if (!env.databaseUrl) {
    return {
      kind: 'static',
      ready: Promise.resolve(),
      log: () => console.log('[api] DATABASE_URL not set - static catalogue, no accounts or orders'),
    };
  }

  const ready = (async () => {
    try {
      /* connectDB() RESOLVES to false when the connection fails — it does not
         throw. Treating resolution as success used to mount commerceApi over a
         dead connection, which turned every catalogue read into a 500 and took
         the whole storefront down whenever mongod was not running. The return
         value is the contract, so it is checked. */
      const connected = await connectDB();
      if (!connected) {
        console.error('[api] MongoDB unreachable - falling back to the static catalogue');
        return staticApi;
      }
      await seedIfEmpty({ quiet: true });
      console.log('[api] MongoDB connected - accounts, cart, wishlist, addresses, orders and tracking are live');
      return commerceApi;
    } catch (err) {
      console.error(`[api] MongoDB unavailable (${err.message}) - falling back to the static catalogue`);
      return staticApi;
    }
  })();

  return { kind: 'database', ready };
})();

const app = express();

app.disable('x-powered-by');

/* Trust proxy configuration — required when running behind a reverse proxy
   (nginx, Vercel, AWS ALB, Cloudflare, etc.) so that:
   - req.ip reflects the real client IP (not the proxy IP)
   - express-rate-limit keys by client IP, not proxy IP
   - Secure cookies work correctly (X-Forwarded-Proto)

   Set TRUST_PROXY to:
   - '1' or 'true'  : trust first hop (single proxy, e.g., Vercel, Heroku)
   - '2'            : trust two hops (e.g., Cloudflare -> nginx)
   - 'loopback'     : trust loopback addresses only (localhost dev)
   - 'linklocal'    : trust link-local addresses only
   - 'uniquelocal'  : trust unique local addresses only
   - Comma-separated IPs/CIDRs for explicit trusted proxies
   - Omit in development where there's no proxy */
const trustProxy = process.env.TRUST_PROXY;
const validTrustProxyValues = ['1', 'true', '2', 'loopback', 'linklocal', 'uniquelocal'];
if (trustProxy && trustProxy !== 'false' && trustProxy !== '0') {
  // Allow comma-separated IPs/CIDRs or known keywords
  const isKeyword = validTrustProxyValues.includes(trustProxy);
  const isIpList = /^(\s*\d{1,3}(?:\.\d{1,3}){3}(?:\/\d{1,2})?\s*(?:,\s*\d{1,3}(?:\.\d{1,3}){3}(?:\/\d{1,2})?\s*)*)+$/.test(trustProxy);
  if (!isKeyword && !isIpList) {
    throw new Error(`Invalid TRUST_PROXY value: "${trustProxy}". Use a number (1, 2), keyword (loopback, linklocal, uniquelocal), or comma-separated IPs/CIDRs.`);
  }
  app.set('trust proxy', trustProxy === 'true' ? 1 : trustProxy);
  console.log(`[proxy] trust proxy enabled: ${app.get('trust proxy')}`);
} else if (!env.isProduction) {
  console.log('[proxy] trust proxy disabled (development mode)');
}

/* Security headers. The CSP is deliberately permissive about inline styles and
   the Razorpay script, because the site uses inline style attributes and the
   payment dialog is loaded from Razorpay's origin. script-src is NOT opened to
   unsafe-inline beyond what the existing pages already require — see the note
   above `helmet` usage in README before tightening. `connect-src` must include
   Razorpay so the checkout script can reach its API, and 'self' so the app's own
   /api calls work. */
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", 'https://checkout.razorpay.com'],
        frameSrc: ["'self'", 'https://api.razorpay.com', 'https://checkout.razorpay.com'],
        connectSrc: ["'self'", 'https://api.razorpay.com', 'https://lumberjack.razorpay.com'],
        imgSrc: ["'self'", 'data:', 'https:'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
      },
    },
    /* The Vercel deployment terminates TLS itself; HSTS is set at the edge. */
    strictTransportSecurity: env.isProduction ? undefined : false,
    crossOriginEmbedderPolicy: false,
  })
);

/* Needed for the httpOnly session cookie. Registered before any /api route so
   the auth middleware can read it. */
app.use(cookieParser());

/* CORS — allow credentialed requests from the configured frontend origin.
   Only applied to /api routes; static files are served same-origin.
   Wildcard origin is rejected when credentials are enabled (security best practice). */
const corsOrigin = env.frontendUrl;
if (corsOrigin === '*') {
  throw new Error('CORS origin cannot be "*" when credentials are enabled. Set FRONTEND_URL to a specific origin.');
}
app.use('/api', cors({
  origin: corsOrigin,
  credentials: true,               // allow cookies/auth headers
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
  maxAge: 86400,                   // cache preflight for 24h
}));
console.log(`[cors] enabled for ${corsOrigin}`);

if (apiDisabled) {
  app.use('/api', (_req, res) => {
    res.status(503).json({
      success: false,
      message: 'The API is unavailable.',
      error: { code: 'API_UNAVAILABLE', message: 'The API is unavailable.' },
    });
  });
  console.log('[api] AV_DISABLE_API=1 - every /api request will fail (resilience testing)');
} else if (apiPlan.kind === 'proxy') {
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
} else if (apiPlan.kind === 'static') {
  app.use('/api', staticApi);
  apiPlan.log();
} else {
  /* The one branch that cannot be wired synchronously. The first request waits
     for the connection; everything after it is a direct pass-through, because
     the promise is already resolved and awaiting a settled promise is a
     microtask, not a round trip. */
  let resolved = null;
  app.use('/api', async (req, res, next) => {
    if (!resolved) resolved = await apiPlan.ready;
    return resolved(req, res, next);
  });
}

/* Health check endpoint — for load balancers, orchestrators, and monitoring.
   Returns 200 if the server is running, with database status if connected. */
app.get('/health', async (_req, res) => {
  const dbStatus = isConnected() ? 'connected' : 'disconnected';
  const checks = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    database: dbStatus,
    environment: env.nodeEnv,
  };
  res.json(checks);
});

/* "/": the gateway — the isolated Crystals | Rituals entry screen — so the home
   page needs its own address and /home.html is no longer a redirect target.
   /home without the extension still lands there. */
app.get('/home', (_req, res) => res.redirect(301, '/home.html'));

/* Crystals is not a page of its own any more — the collection is the shop, and
   the gateway's Crystals panel and the navbar both lead there. Forward both
   spellings so old bookmarks, external links and cached indexes land on the
   shop instead of 404ing. Declared before the static handler, which would
   otherwise serve public/crystals.html straight out of public/. */
app.get('/crystals', (_req, res) => res.redirect(301, '/shop.html'));
app.get('/crystals.html', (_req, res) => res.redirect(301, '/shop.html'));

/* Dynamic customer routes. Declared before the static handler, which would
   otherwise try to serve these paths as files and 404.

   Each one is a real URL with a real document behind it, but the pages are not
   individually addressable HTML files — the order and tracking pages read the
   identifier out of the path and render from the API. A refresh, a bookmark or a
   pasted link therefore behaves the same as a click.

   The identifier is validated before it reaches the page. Not for security —
   the API re-checks ownership on every request — but so an obvious typo like
   /orders/abc redirects to the order list instead of loading a page that then
   shows an error. The pattern is what is checked, never the value against any
   expected set. */
const ORDER_REF = /^[A-Za-z0-9][A-Za-z0-9-]{1,63}$/;

const sendPage = (file) => (_req, res) => res.sendFile(path.join(PUBLIC_DIR, file));

/* Order detail and tracking are separate documents, not one page with two
   modes. Sharing order.html meant /tracking/AV-1234 loaded a page expecting a
   different payload and rendered an error for a perfectly valid link. */
/* A reference that cannot be an order id goes to the list rather than loading a
   page that can only fail. The redirect is what the comment above promises, so
   the two stay in step. */
app.get('/orders/:orderId', (req, res) =>
  ORDER_REF.test(req.params.orderId)
    ? sendPage('order.html')(req, res)
    : res.redirect(301, '/orders')
);
app.get('/tracking/:orderId', (req, res) =>
  ORDER_REF.test(req.params.orderId)
    ? sendPage('tracking.html')(req, res)
    : res.redirect(301, '/orders')
);

/* Order history has its own document, matching /orders rather than
   /order.html?number=..., so the route reads the same as the URL. */
app.get('/orders', sendPage('orders.html'));

/* Order history used to live at /order.html with a ?id= query. Both spellings
   still work, so old links and bookmarks do not break. */
app.get('/order-history', (_req, res) => res.redirect(301, '/orders'));

/* Rituals are a real content section backed by the database, with a document
   per ritual. The index and detail pages are separate files; the slug is
   validated so an obviously malformed link lands on the index rather than a
   page that can only fail. */
const SLUG_REF = /^[a-z0-9][a-z0-9-]{0,159}$/;

app.get('/rituals', sendPage('rituals.html'));
app.get('/rituals/:slug', (req, res) =>
  SLUG_REF.test(req.params.slug) ? sendPage('ritual.html')(req, res) : res.redirect(301, '/rituals')
);

/* A collection is a filter on the shop, not a separate catalogue. Keeping one
   shop page means stock, sorting and search behave identically everywhere. */
app.get('/collections/:slug', (req, res) =>
  SLUG_REF.test(req.params.slug)
    ? res.redirect(302, `/shop.html?collection=${encodeURIComponent(req.params.slug)}`)
    : res.redirect(302, '/shop.html')
);

/* Admin dashboard: canonical routes. The dashboard requires admin auth and
   is enforced server-side by the API; serving the static page is safe as the
   client will redirect unauthenticated/non-admin users via the existing flow. */
app.get('/admin', sendPage('admin.html'));
app.get('/admin/', sendPage('admin.html'));

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

/* Global error handler — must be after all routes */
app.use((err, _req, res, _next) => {
  console.error('[error]', err?.stack || err);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
  });
});

/* Capture unhandled promise rejections and uncaught exceptions */
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason?.stack || reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err?.stack || err);
});

/* Locally this file is the process: run it and it listens. On Vercel it is a
   serverless function, where binding a port is wrong — the platform invokes
   the exported handler and manages the socket itself. Calling listen() there
   either hangs the build or leaves the function unreachable, so the two cases
   are kept apart and the app is exported either way. */
const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

if (!isServerless) {
  const server = app.listen(PORT, () => {
    console.log(`Astro Vetro frontend running at http://localhost:${PORT}`);
    console.log(
      API_TARGET
        ? `Proxying /api -> ${API_TARGET}`
        : 'No API_TARGET - catalogue served from the static provider'
    );
  });

  /* Graceful shutdown — finish in-flight requests, close DB connections. */
  const shutdown = async (signal) => {
    console.log(`[shutdown] ${signal} received, closing server...`);
    server.close(async () => {
      console.log('[shutdown] HTTP server closed');
      await disconnectDB();
      console.log('[shutdown] Database disconnected');
      process.exit(0);
    });
    /* Force exit after 10s if connections don't close */
    setTimeout(() => {
      console.error('[shutdown] Force exit after timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

export default app;