import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { createProxyMiddleware } from 'http-proxy-middleware';
import staticApi from './src/api/staticApi.js';
import commerceApi from './src/api/commerceApi.js';
import { connectDB, isConnected } from './src/db/connect.js';
import { env, assertProductionSecrets } from './src/config/env.js';
import { seedIfEmpty } from './src/db/seed.js';

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
      await connectDB();
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