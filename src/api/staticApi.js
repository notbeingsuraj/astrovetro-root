/* -------------------------------------------------------------------------
   Static API — the database-free implementation of the Astro Vetro API
   -------------------------------------------------------------------------

   Serves the read endpoints the storefront needs from the static catalogue,
   and refuses everything else with an honest 503.

   The split is deliberate:

     READS that are pure content  -> answered from the provider
                                     (products, services, journal, voices)
     ANYTHING needing persistence -> 503 DATABASE_NOT_CONFIGURED
                                     (orders, bookings, auth, accounts,
                                      contact, newsletter, admin, and every
                                      write, including deletes)

   A write returning 503 is the whole point. Silently accepting an order into a
   JavaScript array would tell a customer their purchase was placed when no
   record of it exists anywhere. Failing loudly is the correct behaviour for a
   catalogue that cannot honour a transaction, and it is why the site is
   usable as a storefront before it is usable as a checkout.

   NOTE: no body parser is mounted here on purpose. Consuming the request
   stream would break API_TARGET proxying, which must be able to forward
   bodies untouched. Nothing in this router needs a body anyway - every write
   is refused before it is read.
   ------------------------------------------------------------------------- */

import { Router } from 'express';
import { getDataProvider, ProviderNotConfiguredError } from '../providers/index.js';

const router = Router();
const provider = getDataProvider();

/* Identifies the response as coming from a provider that has no database
   behind it. The UI ignores unknown meta keys; this is here so a request can be
   attributed during debugging, and so the deployment can be verified from the
   outside. */
const mode = { provider: provider.name, database: false };

const ok = (res, data, meta = {}) => res.json({ success: true, data, meta: { ...meta, ...mode } });

/* The single refusal used for every endpoint that needs persistence. */
function notConfigured(res, req) {
  return res.status(503).json({
    success: false,
    message: 'Persistent data services are not configured yet.',
    error: {
      code: 'DATABASE_NOT_CONFIGURED',
      message: 'Persistent data services are not configured yet.',
      endpoint: req.originalUrl,
      /* Naming the exact route makes the gap obvious in the browser console
         instead of surfacing as a generic failure. */
      detail: `"${req.method} ${req.originalUrl.split('?')[0]}" needs a database, which this deployment does not have. Browsing the shop, crystals, rituals and journal works without one.`,
    },
  });
}

/* ── Deployment status ───────────────────────────────────────────────────
   Not part of the storefront. Lets a deploy be checked without a browser:
   GET /api/status -> 200 { provider, database: false, writable: false } */
router.get('/status', (_req, res) => {
  res.json({
    success: true,
    data: {
      provider: provider.name,
      database: false,
      writable: false,
      note: 'Catalogue browsing only. Orders, bookings, accounts, contact and newsletter are unavailable until a database is configured.',
    },
    meta: mode,
  });
});

/* ── Catalogue reads ────────────────────────────────────────────────────── */

router.get('/products', async (req, res, next) => {
  try {
    const { data, meta } = await provider.listProducts(req.query);
    return ok(res, data, meta);
  } catch (err) {
    return next(err);
  }
});

/* Declared before /products/:slug so "intentions" is not read as a slug. */
router.get('/products/intentions', async (_req, res, next) => {
  try {
    return ok(res, await provider.listIntentions());
  } catch (err) {
    return next(err);
  }
});

router.get('/products/:slug', async (req, res, next) => {
  try {
    return ok(res, await provider.getProduct(req.params.slug));
  } catch (err) {
    return next(err);
  }
});

router.get('/services', async (req, res, next) => {
  try {
    return ok(res, await provider.listServices(req.query));
  } catch (err) {
    return next(err);
  }
});

router.get('/services/:slug', async (req, res, next) => {
  try {
    return ok(res, await provider.getService(req.params.slug));
  } catch (err) {
    return next(err);
  }
});

router.get('/articles', async (req, res, next) => {
  try {
    return ok(res, await provider.listArticles(req.query));
  } catch (err) {
    return next(err);
  }
});

router.get('/articles/:slug', async (req, res, next) => {
  try {
    return ok(res, await provider.getArticle(req.params.slug));
  } catch (err) {
    return next(err);
  }
});

router.get('/testimonials', async (_req, res, next) => {
  try {
    return ok(res, await provider.listTestimonials());
  } catch (err) {
    return next(err);
  }
});

/* ── Everything else needs persistence ───────────────────────────────────
   Includes every non-GET method. The two handlers are separate so a write
   reads as "not allowed yet" rather than "no such route". */
router.all(/.*/, (req, res) => {
  if (req.method !== 'GET') {
    res.status(503);
  }
  return notConfigured(res, req);
});

/* ── Errors ─────────────────────────────────────────────────────────────
   A provider that refuses is a deployment state, not a crash: answer 503.
   Anything else is a genuine fault and must surface as 500. */
router.use((err, _req, res, _next) => {
  if (err instanceof ProviderNotConfiguredError || err?.code === 'DATABASE_NOT_CONFIGURED') {
    return res.status(503).json({
      success: false,
      message: err.message,
      error: { code: 'DATABASE_NOT_CONFIGURED', message: err.message },
    });
  }

  console.error('[api] unexpected error:', err);
  return res.status(500).json({
    success: false,
    message: 'Something went wrong while loading this content.',
    error: { code: 'INTERNAL_ERROR', message: 'Something went wrong while loading this content.' },
  });
});

export default router;