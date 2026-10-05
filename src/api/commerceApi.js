/* -------------------------------------------------------------------------
   Commerce API
   -------------------------------------------------------------------------

   The full customer API, mounted at /api when a database is connected.

   Composition order matters and is deliberate:

     1. Catalogue reads first, so they are not shadowed by anything below.
     2. The webhook, on the RAW body. It must be registered before the JSON body
        parser, because verifying a webhook signature means hashing the exact
        bytes the provider sent. Re-serialising a parsed object changes the bytes
        and the signature never matches.
     3. The JSON parser, with a size limit.
     4. requireSameOrigin — CSRF defence for the cookie-authenticated routes.
     5. The routers.
     6. Not-found and error handling.

   This router only ever runs with a live database. When DATABASE_URL is absent,
   server.js mounts src/api/staticApi.js instead and every write is refused with
   DATABASE_NOT_CONFIGURED, exactly as before.
   ------------------------------------------------------------------------- */

import express, { Router } from 'express';
import { env } from '../config/env.js';
import { dbProvider } from '../providers/dbProvider.js';
import { requireSameOrigin } from '../middleware/auth.js';
import { notFoundHandler, errorHandler } from '../middleware/errorHandler.js';
import { paymentWebhook } from '../controllers/orderController.js';

import authRoutes from '../routes/auth.js';
import cartRoutes from '../routes/cart.js';
import wishlistRoutes from '../routes/wishlist.js';
import addressRoutes from '../routes/addresses.js';
import orderRoutes from '../routes/orders.js';
import checkoutRoutes from '../routes/checkout.js';
import adminRoutes from '../routes/admin.js';
import * as accountCtrl from '../controllers/accountController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const ok = (res, data, meta = {}) => res.json({ success: true, data, meta });

/* ── Catalogue reads ─────────────────────────────────────────────────────────
   The same routes and the same envelope as staticApi.js, answered from the
   database. Nothing in the storefront branches on which one is live.
   ------------------------------------------------------------------------ */
router.get('/status', (_req, res) =>
  res.json({
    success: true,
    data: {
      provider: dbProvider.name,
      database: true,
      writable: true,
      /* Card/UPI availability, reported rather than discovered by opening a
         payment dialog that cannot complete. Derived from whether Razorpay
         credentials are present, which is the same condition
         razorpay.isPaymentConfigured() enforces. */
      paymentsLive: env.paymentLive,
      note: 'Commerce is live: accounts, saved addresses, cart, wishlist, orders and tracking are all persistent.',
    },
    meta: { provider: dbProvider.name, database: true, paymentsLive: env.paymentLive },
  })
);

router.get('/products', async (req, res, next) => {
  try {
    const { data, meta } = await dbProvider.listProducts(req.query);
    return ok(res, data, meta);
  } catch (err) {
    return next(err);
  }
});

router.get('/products/intentions', async (_req, res, next) => {
  try {
    return ok(res, await dbProvider.listIntentions());
  } catch (err) {
    return next(err);
  }
});

router.get('/products/:slug', async (req, res, next) => {
  try {
    return ok(res, await dbProvider.getProduct(req.params.slug));
  } catch (err) {
    return next(err);
  }
});

router.get('/services', async (req, res, next) => {
  try {
    const { data, meta } = await dbProvider.listServices(req.query);
    return ok(res, data, meta);
  } catch (err) {
    return next(err);
  }
});

router.get('/services/:slug', async (req, res, next) => {
  try {
    return ok(res, await dbProvider.getService(req.params.slug));
  } catch (err) {
    return next(err);
  }
});

router.get('/articles', async (req, res, next) => {
  try {
    const { data, meta } = await dbProvider.listArticles(req.query);
    return ok(res, data, meta);
  } catch (err) {
    return next(err);
  }
});

router.get('/articles/:slug', async (req, res, next) => {
  try {
    return ok(res, await dbProvider.getArticle(req.params.slug));
  } catch (err) {
    return next(err);
  }
});

router.get('/testimonials', async (_req, res, next) => {
  try {
    return ok(res, await dbProvider.listTestimonials());
  } catch (err) {
    return next(err);
  }
});

/* ── Webhook, on the raw body ───────────────────────────────────────────────
   Registered before express.json() so the bytes are intact. No session, no CSRF
   check: the request is authenticated by its signature instead, which is the
   only thing Razorpay sends.
   ------------------------------------------------------------------------ */
router.post('/webhooks/razorpay', express.raw({ type: 'application/json', limit: '256kb' }), paymentWebhook);

/* Everything below this line is a normal JSON API called by our own pages. */
router.use(express.json({ limit: '64kb' }));
router.use(express.urlencoded({ extended: false, limit: '64kb' }));
router.use(requireSameOrigin);

/* ── Auth ────────────────────────────────────────────────────────────────── */
router.use('/auth', authRoutes);

/* ── Account ─────────────────────────────────────────────────────────────── */
router.get('/me', requireAuth, accountCtrl.getAccountSummary);
router.patch('/me', requireAuth, accountCtrl.updateProfile);
router.post('/me/password', requireAuth, accountCtrl.changePassword);
router.delete('/me', requireAuth, accountCtrl.deleteAccount);
router.use('/me/addresses', addressRoutes);

/* ── Commerce ────────────────────────────────────────────────────────────── */
router.use('/cart', cartRoutes);
router.use('/wishlist', wishlistRoutes);
router.use('/orders', orderRoutes);
router.use('/checkout', checkoutRoutes);
router.use('/admin', adminRoutes);

/* ── Fallbacks ─────────────────────────────────────────────────────────────
   An unknown /api path must not fall through to the static handler, which
   would answer it with a page of HTML and a 200.
   ------------------------------------------------------------------------ */
router.use(notFoundHandler);
router.use(errorHandler);

export default router;
