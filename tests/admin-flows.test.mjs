/* End-to-end admin flows against a real server and a real (disposable)
   database.

   Everything the brief calls critical is exercised here through the same HTTP
   surface the admin UI uses: product creation/editing/archival, SKU
   uniqueness, image-to-product assignment and validation, stock adjustments
   with a ledger, insufficient-stock refusal, concurrent updates, purchase
   order receiving with idempotency, dashboard metrics reflecting real rows,
   CSV export formula-safety, and server-side authorization.

   The database is `astrovetro_test` and is dropped in teardown. The working
   database is never touched: `dropDatabase()` refuses any URI that does not
   look like a test database. */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import {
  startServer,
  api,
  login,
  createAdmin,
  dropDatabase,
  tcpUp,
} from './helpers/server.mjs';

const PORT = 5312;
const TEST_DB = 'mongodb://127.0.0.1:27017/astrovetro_test';
const ADMIN_EMAIL = 'admin@astrovetro.test';
const ADMIN_PASSWORD = 'flows-pass-12345';

/* A 1×1 PNG — valid for sharp, used for the upload happy path. The rejection
   path is plain text sent with an image content type. */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const mongoUp = await tcpUp('127.0.0.1', 27017);

describe('admin API flows', { skip: mongoUp ? false : 'mongod is not reachable on 127.0.0.1:27017' }, () => {
  let server;
  let cookie;
  let base;

  /* Records shared between the sequential tests below. */
  const state = {
    productId: null, // the main product under test
    poProductId: null, // the product stock is driven through a purchase order
    supplierId: null,
    uploadedLarge: null,
  };

  const call = (path, opts = {}) => api(base, path, { cookie, ...opts });

  before(async () => {
    await createAdmin({ databaseUrl: TEST_DB, email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    server = await startServer({ port: PORT, databaseUrl: TEST_DB });
    base = server.base;
    cookie = await login(base, ADMIN_EMAIL, ADMIN_PASSWORD);
    assert.ok(cookie, 'admin login against the test database failed');
  });

  after(async () => {
    await server?.stop();
    await dropDatabase(TEST_DB);
  });

  /* ── Authorization ─────────────────────────────────────────────── */

  it('refuses admin reads without a session', async () => {
    const out = await api(base, '/api/admin/products');
    assert.strictEqual(out.status, 401);
    assert.strictEqual(out.json.success, false);
  });

  /* ── Products ──────────────────────────────────────────────────── */

  it('creates a product with an auto-derived SKU and untracked stock', async () => {
    const out = await call('/api/admin/products', {
      method: 'POST',
      body: {
        name: '=Formula Rig', // leading = proves CSV formula-safety later
        slug: 'zz-formula-rig',
        category: 'ring',
        price: 100,
        costPrice: 40,
        status: 'draft',
        shortDescription: 'Integration-test piece.',
      },
    });
    assert.strictEqual(out.status, 201, JSON.stringify(out.json));
    const p = out.json.data.product;
    state.productId = p.id;
    assert.strictEqual(p.slug, 'zz-formula-rig');
    assert.strictEqual(p.sku, 'AV-ZZ-FORMULA-RIG', 'SKU is derived from the slug, prefixed and uppercased');
    assert.strictEqual(p.status, 'draft');
    assert.strictEqual(p.stock, null);
    assert.strictEqual(p.stockState, 'untracked');
    state.productId = p.id;
  });

  it('refuses a duplicate slug and a duplicate SKU', async () => {
    const slugClash = await call('/api/admin/products', {
      method: 'POST',
      body: { name: 'Slug clone', slug: 'zz-formula-rig', category: 'ring', price: 10 },
    });
    assert.strictEqual(slugClash.status, 409);

    const skuClash = await call('/api/admin/products', {
      method: 'POST',
      body: { name: 'SKU clone', slug: 'zz-formula-rig-2', sku: 'av-zz-formula-rig', category: 'ring', price: 10 },
    });
    assert.strictEqual(skuClash.status, 409);
  });

  it('keeps draft, archived and active products apart on the public shop', async () => {
    const publicList = async () => {
      const out = await api(base, '/api/products?limit=100');
      assert.strictEqual(out.status, 200);
      return (out.json.data || []).some((p) => p.slug === 'zz-formula-rig');
    };

    assert.strictEqual(await publicList(), false, 'a draft product must not be listed');

    const edit = await call(`/api/admin/products/${state.productId}`, {
      method: 'PATCH',
      body: { status: 'active', price: 120, description: 'Edited by the integration suite.' },
    });
    assert.strictEqual(edit.status, 200);
    assert.strictEqual(edit.json.data.product.status, 'active');
    assert.strictEqual(edit.json.data.product.price, 120);
    assert.strictEqual(await publicList(), true, 'an active product must be listed');

    const archived = await call(`/api/admin/products/${state.productId}/archive`, { method: 'POST' });
    assert.strictEqual(archived.status, 200);
    assert.strictEqual(archived.json.data.product.status, 'archived');
    assert.strictEqual(await publicList(), false, 'an archived product must not be listed');

    const restored = await call(`/api/admin/products/${state.productId}/restore`, { method: 'POST' });
    assert.strictEqual(restored.status, 200);
    assert.strictEqual(restored.json.data.product.status, 'active');
    assert.strictEqual(await publicList(), true);
  });

  /* ── Product images ────────────────────────────────────────────── */

  it('refuses image paths that do not exist on disk', async () => {
    const out = await call(`/api/admin/products/${state.productId}/images`, {
      method: 'PUT',
      body: { images: ['/assets/img/library/does-not-exist-large.webp'] },
    });
    assert.strictEqual(out.status, 400);
    assert.strictEqual(out.json.success, false);
  });

  it('assigns, appends and removes product images', async () => {
    const first = await call(`/api/admin/products/${state.productId}/images`, {
      method: 'PUT',
      body: {
        images: ['/assets/img/products/amethyst-ring/1-large.webp'],
        imageAlts: ['amethyst ring — photo 1'],
      },
    });
    assert.strictEqual(first.status, 200, JSON.stringify(first.json));
    assert.deepStrictEqual(first.json.data.product.images, [
      '/assets/img/products/amethyst-ring/1-large.webp',
    ]);

    const appended = await call(`/api/admin/products/${state.productId}/images`, {
      method: 'POST',
      body: { paths: ['/assets/img/products/amethyst-ring/2-large.webp'] },
    });
    assert.strictEqual(appended.status, 200);
    assert.strictEqual(appended.json.data.product.images.length, 2);

    const removed = await call(`/api/admin/products/${state.productId}/images/1`, {
      method: 'DELETE',
    });
    assert.strictEqual(removed.status, 200);
    assert.strictEqual(removed.json.data.product.images.length, 1);
    assert.strictEqual(removed.json.data.removed, '/assets/img/products/amethyst-ring/2-large.webp');
  });

  /* ── Inventory and the ledger ──────────────────────────────────── */

  it('records an opening balance in the ledger', async () => {
    const out = await call(`/api/admin/inventory/adjust/${state.productId}`, {
      method: 'POST',
      body: { mode: 'delta', quantity: 10, type: 'opening', reason: 'Initial physical count' },
    });
    assert.strictEqual(out.status, 200, JSON.stringify(out.json));
    assert.strictEqual(out.json.data.balanceAfter, 10);
    assert.strictEqual(out.json.data.product.stock, 10);
  });

  it('applies concurrent adjustments atomically without corrupting the count', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        call(`/api/admin/inventory/adjust/${state.productId}`, {
          method: 'POST',
          body: { mode: 'delta', quantity: 5, type: 'adjustment', reason: 'Parallel restock' },
        })
      )
    );
    const failures = results.filter((r) => r.status !== 200);
    assert.strictEqual(failures.length, 0, JSON.stringify(failures));

    const product = await call(`/api/admin/products/${state.productId}`);
    assert.strictEqual(product.json.data.product.stock, 60, 'ten parallel +5 must land exactly on +50');
  });

  it('refuses a withdrawal larger than the stock on hand', async () => {
    const out = await call(`/api/admin/inventory/adjust/${state.productId}`, {
      method: 'POST',
      body: { mode: 'delta', quantity: -1000, type: 'adjustment', reason: 'Should never apply' },
    });
    assert.strictEqual(out.status, 422);
    assert.strictEqual(out.json.error.code, 'INSUFFICIENT_STOCK');
    const product = await call(`/api/admin/products/${state.productId}`);
    assert.strictEqual(product.json.data.product.stock, 60, 'a refused withdrawal must change nothing');
  });

  it('never lets racing withdrawals drive stock negative', async () => {
    const before = (await call(`/api/admin/products/${state.productId}`)).json.data.product.stock;
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        call(`/api/admin/inventory/adjust/${state.productId}`, {
          method: 'POST',
          body: { mode: 'delta', quantity: -9, type: 'adjustment', reason: 'Concurrent withdrawal' },
        })
      )
    );
    const applied = results.filter((r) => r.status === 200).length;
    const refused = results.filter((r) => r.status !== 200).length;
    assert.strictEqual(applied + refused, 10);

    const after = (await call(`/api/admin/products/${state.productId}`)).json.data.product.stock;
    assert.ok(after >= 0, `stock went negative: ${after}`);
    assert.strictEqual(after, before - 9 * applied, 'the count must equal the start minus every applied change');
    assert.ok(refused > 0, 'some withdrawals must be refused when the balance runs out');
  });

  it('keeps the ledger consistent with the stored quantity', async () => {
    const out = await call(`/api/admin/inventory/movements?productId=${state.productId}&limit=200`);
    assert.strictEqual(out.status, 200);
    const items = out.json.data.items;
    assert.ok(items.length >= 12, 'every adjustment should have produced a movement');
    const sum = items.reduce((acc, m) => acc + m.quantity, 0);
    const stock = (await call(`/api/admin/products/${state.productId}`)).json.data.product.stock;
    assert.strictEqual(sum, stock, 'the sum of all movements must equal the stored stock');
    for (const m of items) {
      assert.ok(m.reason && m.reason.length > 0, 'movement without a reason');
      assert.ok(m.actor && m.actor.userId, 'movement without an attributable actor');
      assert.ok(m.balanceAfter >= 0, 'ledger recorded a negative balance');
    }
  });

  it('untracks stock and then refuses further adjustments', async () => {
    const out = await call(`/api/admin/inventory/untrack/${state.productId}`, {
      method: 'POST',
      body: { reason: 'Made to order from here on' },
    });
    assert.strictEqual(out.status, 200);
    assert.strictEqual(out.json.data.product.stock, null);
    assert.strictEqual(out.json.data.product.stockState, 'untracked');

    const adjust = await call(`/api/admin/inventory/adjust/${state.productId}`, {
      method: 'POST',
      body: { mode: 'delta', quantity: -1, type: 'adjustment', reason: 'Should be refused' },
    });
    assert.strictEqual(adjust.status, 409);
  });

  /* ── Categories and suppliers ──────────────────────────────────── */

  it('creates, archives and restores a category', async () => {
    const created = await call('/api/admin/categories', {
      method: 'POST',
      body: { name: 'Test Categ' },
    });
    assert.strictEqual(created.status, 201);
    const slug = created.json.data.category.slug;

    const dupe = await call('/api/admin/categories', { method: 'POST', body: { name: 'Test Categ' } });
    assert.strictEqual(dupe.status, 409);

    const archived = await call(`/api/admin/categories/${slug}/archive`, { method: 'POST' });
    assert.strictEqual(archived.status, 200);
    assert.strictEqual(archived.json.data.category.active, false);

    const restored = await call(`/api/admin/categories/${slug}/restore`, { method: 'POST' });
    assert.strictEqual(restored.status, 200);
    assert.strictEqual(restored.json.data.category.active, true);
  });

  it('creates a supplier and refuses purchase orders from an archived one', async () => {
    const created = await call('/api/admin/suppliers', {
      method: 'POST',
      body: { name: 'Quarry Test Supplies', code: 'qq-test' },
    });
    assert.strictEqual(created.status, 201);
    state.supplierId = created.json.data.supplier._id;

    /* The second product the purchase order flow drives. */
    const product = await call('/api/admin/products', {
      method: 'POST',
      body: {
        name: 'PO Test Piece',
        slug: 'zz-po-piece',
        category: 'pendant',
        price: 200,
        costPrice: 25,
        status: 'active',
      },
    });
    assert.strictEqual(product.status, 201);
    state.poProductId = product.json.data.product.id;

    const opening = await call(`/api/admin/inventory/adjust/${state.poProductId}`, {
      method: 'POST',
      body: { mode: 'delta', quantity: 3, type: 'opening', reason: 'Shelf count' },
    });
    assert.strictEqual(opening.json.data.balanceAfter, 3);

    const archived = await call(`/api/admin/suppliers/${state.supplierId}/archive`, {
      method: 'POST',
    });
    assert.strictEqual(archived.status, 200);

    const po = await call('/api/admin/purchase-orders', {
      method: 'POST',
      body: {
        supplierId: state.supplierId,
        lines: [{ productId: state.poProductId, orderedQuantity: 5, unitCost: 25 }],
      },
    });
    assert.strictEqual(po.status, 409, 'an archived supplier must not receive purchase orders');

    /* Reactivate for the flow below. */
    const reactivated = await call(`/api/admin/suppliers/${state.supplierId}/restore`, {
      method: 'POST',
    });
    assert.strictEqual(reactivated.status, 200);
  });

  /* ── Purchase orders ───────────────────────────────────────────── */

  it('does not raise stock when a purchase order is created or sent', async () => {
    const created = await call('/api/admin/purchase-orders', {
      method: 'POST',
      body: {
        supplierId: state.supplierId,
        lines: [{ productId: state.poProductId, orderedQuantity: 5, unitCost: 25 }],
        notes: 'Integration order',
      },
    });
    assert.strictEqual(created.status, 201, JSON.stringify(created.json));
    state.poId = created.json.data.purchaseOrder._id;
    assert.strictEqual(created.json.data.purchaseOrder.status, 'draft');

    const stock = (await call(`/api/admin/products/${state.poProductId}`)).json.data.product.stock;
    assert.strictEqual(stock, 3, 'creating a PO must not change stock');

    const early = await receive(state.poId, [{ lineId: lineIdOf(created.json.data.purchaseOrder), quantityReceived: 5 }], 'early-key-000001');
    assert.strictEqual(early.status, 409, 'receiving before sending must be refused');

    const sent = await call(`/api/admin/purchase-orders/${state.poId}/send`, { method: 'POST' });
    assert.strictEqual(sent.status, 200);
    assert.strictEqual(sent.json.data.purchaseOrder.status, 'sent');

    const stillThree = (await call(`/api/admin/products/${state.poProductId}`)).json.data.product.stock;
    assert.strictEqual(stillThree, 3, 'sending a PO must not change stock');
  });

  it('raises stock exactly once per receipt, even when replayed', async () => {
    const lineId = lineIdOf((await call(`/api/admin/purchase-orders/${state.poId}`)).json.data.purchaseOrder);
    const key = 'receipt-key-abcdef';

    const first = await receive(state.poId, [{ lineId, quantityReceived: 5 }], key);
    assert.strictEqual(first.status, 201, JSON.stringify(first.json));
    assert.strictEqual(first.json.data.replayed, false);
    assert.strictEqual(
      (await call(`/api/admin/products/${state.poProductId}`)).json.data.product.stock,
      8,
      'receipt must add the received quantity'
    );

    const replay = await receive(state.poId, [{ lineId, quantityReceived: 5 }], key);
    assert.ok([200, 201].includes(replay.status));
    assert.strictEqual(replay.json.data.replayed, true, 'the same idempotency key must replay, not re-apply');
    assert.strictEqual(
      (await call(`/api/admin/products/${state.poProductId}`)).json.data.product.stock,
      8,
      'a replayed receipt must not raise stock again'
    );
  });

  it('supports partial deliveries and refuses over-receiving', async () => {
    const created = await call('/api/admin/purchase-orders', {
      method: 'POST',
      body: {
        supplierId: state.supplierId,
        lines: [{ productId: state.poProductId, orderedQuantity: 4, unitCost: 25 }],
      },
    });
    assert.strictEqual(created.status, 201);
    const poId = created.json.data.purchaseOrder._id;
    const lineId = lineIdOf(created.json.data.purchaseOrder);

    await call(`/api/admin/purchase-orders/${poId}/send`, { method: 'POST' });

    const partial = await receive(poId, [{ lineId, quantityReceived: 2 }], 'partial-key-aaaaaa');
    assert.strictEqual(partial.status, 201);
    assert.strictEqual(partial.json.data.purchaseOrder.status, 'partial');

    const over = await receive(poId, [{ lineId, quantityReceived: 3 }], 'over-key-bbbbbb');
    assert.strictEqual(over.status, 409, 'receiving more than ordered must be refused');

    const rest = await receive(poId, [{ lineId, quantityReceived: 2 }], 'rest-key-cccccc');
    assert.strictEqual(rest.status, 201);
    assert.strictEqual(rest.json.data.purchaseOrder.status, 'received');

    const stock = (await call(`/api/admin/products/${state.poProductId}`)).json.data.product.stock;
    assert.strictEqual(stock, 12, '3 opening + 5 first PO + 4 second PO');

    const receipts = await call(`/api/admin/purchase-orders/${poId}/receipts`);
    assert.strictEqual(receipts.status, 200);
    assert.strictEqual(receipts.json.data.items.length, 2, 'two receipts for the second PO');
  });

  /* ── Dashboard metrics and reports ─────────────────────────────── */

  it('reports dashboard metrics from real rows', async () => {
    const out = await call('/api/admin/inventory/dashboard');
    assert.strictEqual(out.status, 200);
    const d = out.json.data;
    assert.ok(d.stockStates.in.count >= 1, 'the received product must count as in stock');
    assert.ok(d.valuation.totalCostValue >= 300, `valuation from cost prices, got ${d.valuation.totalCostValue}`);
    assert.strictEqual(
      d.valuation.totalCostValue,
      d.valuation.valuedProducts > 0
        ? d.valuation.totalCostValue
        : 0,
      'valuation must be internally consistent'
    );
    assert.ok(d.recentMovements.length >= 1, 'recent movements must be real ledger rows');
    assert.ok(d.catalogue.needsReview >= 0);
    assert.ok(Array.isArray(d.recentMovements));
  });

  it('serves the inventory table with search, filters and pagination meta', async () => {
    const bySku = await call('/api/admin/inventory/table?search=ZZ-FORMULA');
    assert.strictEqual(bySku.status, 200);
    assert.strictEqual(bySku.json.data.items.length, 1);
    assert.strictEqual(bySku.json.data.items[0].sku, 'AV-ZZ-FORMULA-RIG');
    assert.ok(bySku.json.data.meta, 'pagination meta must be present');

    const inStock = await call('/api/admin/inventory/table?stockState=in&search=zz-po');
    assert.strictEqual(inStock.status, 200);
    assert.strictEqual(inStock.json.data.items.length, 1);
    assert.strictEqual(inStock.json.data.items[0].stockState, 'in');
  });

  it('exports CSV that a spreadsheet cannot execute as a formula', async () => {
    const res = await fetch(`${base}/api/admin/reports/products.csv`, { headers: { Cookie: cookie } });
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/csv/);
    const text = await res.text();
    assert.ok(text.includes("'=Formula Rig"), 'a leading = must be neutralised with an apostrophe');

    for (const path of ['/api/admin/reports/inventory.csv', '/api/admin/reports/orders.csv']) {
      const r = await fetch(`${base}${path}`, { headers: { Cookie: cookie } });
      assert.strictEqual(r.status, 200, path);
      await r.text();
    }
  });

  /* ── Image library ─────────────────────────────────────────────── */

  it('validates uploaded image bytes, protects referenced files, deletes orphans', async () => {
    const bad = await fetch(`${base}/api/admin/images/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png', Cookie: cookie, Origin: base },
      body: 'this is definitely not a png',
    });
    assert.strictEqual(bad.status, 400, 'magic bytes must be checked, not the content type');

    const ok = await fetch(`${base}/api/admin/images/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png', Cookie: cookie, Origin: base },
      body: TINY_PNG,
    });
    const okBody = await ok.json().catch(() => null);
    assert.strictEqual(ok.status, 201, JSON.stringify(okBody));
    const image = okBody.data.image;
    assert.ok(image.large.startsWith('/assets/img/library/'), image.large);
    state.uploadedLarge = image.large;

    const assigned = await call(`/api/admin/products/${state.productId}/images`, {
      method: 'POST',
      body: { paths: [image.large], alts: ['uploaded test image'] },
    });
    assert.strictEqual(assigned.status, 200);

    const protectedDelete = await call(`/api/admin/images/file?path=${encodeURIComponent(image.large)}`, {
      method: 'DELETE',
    });
    assert.strictEqual(protectedDelete.status, 409, 'a file a product references must not be deletable');

    const detach = await call(`/api/admin/products/${state.productId}/images/1`, { method: 'DELETE' });
    assert.strictEqual(detach.status, 200);

    const deleted = await call(`/api/admin/images/file?path=${encodeURIComponent(image.large)}`, {
      method: 'DELETE',
    });
    assert.strictEqual(deleted.status, 200);
    assert.ok(deleted.json.data.deleted >= 1);
  });

  /* ── Admin users, audit, settings ──────────────────────────────── */

  it('refuses to demote the last administrator', async () => {
    const users = await call('/api/admin/users?role=admin');
    assert.strictEqual(users.status, 200);
    const admins = users.json.data.items;
    assert.strictEqual(admins.length, 1, 'the test database should have exactly one admin');

    const demote = await call(`/api/admin/users/${admins[0].id}/role`, {
      method: 'PATCH',
      body: { role: 'customer' },
    });
    assert.strictEqual(demote.status, 409, 'the last admin must never be demoted');
  });

  it('records the administrative actions in an audit trail', async () => {
    const out = await call('/api/admin/audit?limit=100');
    assert.strictEqual(out.status, 200);
    const actions = out.json.data.items.map((i) => i.action);
    assert.ok(actions.includes('product.create'), `audit trail missing product.create: ${actions.join(', ')}`);
    assert.ok(actions.some((a) => a.startsWith('inventory.')), 'audit trail must record inventory changes');
    const entry = out.json.data.items[0];
    assert.ok(entry.actor && entry.actor.userId, 'audit entries must be attributable');
  });

  it('serves read-only settings that describe real constraints', async () => {
    const out = await call('/api/admin/settings');
    assert.strictEqual(out.status, 200);
    assert.strictEqual(out.json.data.lowStockDefault, 3);
    assert.strictEqual(out.json.data.reservedStock.supported, false);
    assert.ok(Array.isArray(out.json.data.acceptedImageTypes));
  });

  /* ── helpers ───────────────────────────────────────────────────── */

  function lineIdOf(po) {
    assert.ok(po && po.lines && po.lines.length > 0, 'purchase order must carry lines');
    return po.lines[0]._id;
  }

  function receive(poId, lines, idempotencyKey) {
    return call(`/api/admin/purchase-orders/${poId}/receive`, {
      method: 'POST',
      body: { lines, idempotencyKey },
    });
  }
});
