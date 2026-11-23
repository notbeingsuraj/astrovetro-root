/* -------------------------------------------------------------------------
   Phase 2 — Customer Commerce Validation
   -------------------------------------------------------------------------
   Validates complete customer commerce workflows using isolated test accounts.
   Tests cart, wishlist, addresses, checkout (COD), orders, and inventory.

   FLAT STRUCTURE: All tests run sequentially in a single describe block to
   avoid shared-state corruption from parallel nested describe blocks.
   ------------------------------------------------------------------------- */

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

/** Extract session cookie from response headers. */
function sessionCookie(res, name = 'av_token') {
  const all = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const hit = all.find((c) => c.startsWith(`${name}=`));
  return hit ? hit.split(';')[0] : null;
}

const PORT = 5500;
const TEST_DB = 'mongodb://127.0.0.1:27017/astrovetro_commerce_test';
const ADMIN_EMAIL = 'commerce-admin@astrovetro.test';
const ADMIN_PASSWORD = 'commerce-admin-pass-12345';
const CUSTOMER_EMAIL = 'commerce-customer@astrovetro.test';
const CUSTOMER_PASSWORD = 'customer-pass-12345';

const mongoUp = await tcpUp('127.0.0.1', 27017);

describe('Phase 2 — Customer Commerce Validation', { skip: mongoUp ? false : 'mongod is not reachable on 127.0.0.1:27017' }, () => {
  let server;
  let base;
  let adminCookie;
  let customerCookie;
  let productId;

  const call = (path, opts = {}) => api(base, path, { cookie: adminCookie, ...opts });
  const callCustomer = (path, opts = {}) => api(base, path, { cookie: customerCookie, ...opts });

  // ── Helper: add item to cart for customer ───────────────────────────────
  async function addToCart(qty = 1) {
    const res = await callCustomer('/api/cart/items', {
      method: 'POST',
      body: { productId, quantity: qty }
    });
    assert.ok(res.status === 200 || res.status === 201, `cart add failed: ${JSON.stringify(res.json)}`);
    return res;
  }

  // ── Helper: place COD order for customer ────────────────────────────────
  async function placeCodOrder(opts = {}) {
    const { quantity = 1, address, idempotencyKey } = opts;
    await addToCart(quantity);
    const body = {
      paymentMethod: 'cod',
      address: address || {
        name: 'Test Customer',
        phone: '+91 90000 00000',
        line1: '123 Test Street',
        city: 'Test City',
        state: 'Test State',
        pincode: '110001',
        country: 'India'
      }
    };
    const headers = idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {};
    const res = await callCustomer('/api/checkout/cod', {
      method: 'POST',
      headers,
      body
    });
    assert.strictEqual(res.status, 201, `COD order failed: ${JSON.stringify(res.json)}`);
    return res.json.data.order;
  }

  // ── Helper: create a secondary user and return their cookie ─────────────
  async function createSecondaryUser(prefix = 'secondary') {
    const email = `${prefix}-${Date.now()}-${Math.random()}@example.com`;
    const reg = await api(base, '/api/auth/register', {
      method: 'POST',
      body: { name: 'Secondary', email, password: 'pass123456' }
    });
    assert.strictEqual(reg.status, 201);
    const cookie = sessionCookie((await api(base, '/api/auth/login', {
      method: 'POST',
      body: { email, password: 'pass123456' }
    })).res);
    assert.ok(cookie);
    return { email, cookie };
  }

  // ── Helper: restore product stock and availability ────────────────────────
  async function restoreStock(qty = 50) {
    await call(`/api/admin/inventory/adjust/${productId}`, {
      method: 'POST',
      body: { mode: 'set', quantity: qty, type: 'adjustment', reason: 'Restore stock for test' }
    });
    // Re-enable availability if it was disabled
    await call(`/api/admin/products/${productId}`, {
      method: 'PATCH',
      body: { availability: true }
    });
  }

  before(async () => {
    await createAdmin({ databaseUrl: TEST_DB, email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    server = await startServer({ port: PORT, databaseUrl: TEST_DB, disableRateLimit: true });
    base = server.base;
    adminCookie = await login(base, ADMIN_EMAIL, ADMIN_PASSWORD);
    assert.ok(adminCookie, 'admin login failed');

    // Create a customer account
    const custReg = await api(base, '/api/auth/register', {
      method: 'POST',
      body: { email: CUSTOMER_EMAIL, password: CUSTOMER_PASSWORD, name: 'Commerce Test Customer' }
    });
    assert.strictEqual(custReg.status, 201, JSON.stringify(custReg.json));

    customerCookie = await login(base, CUSTOMER_EMAIL, CUSTOMER_PASSWORD);
    assert.ok(customerCookie, 'customer login failed');

    // Create a tracked product with stock via admin API
    const product = await call('/api/admin/products', {
      method: 'POST',
      body: {
        name: 'Commerce Test Product',
        slug: 'commerce-test-product',
        category: 'pendant',
        price: 2500,
        costPrice: 1000,
        status: 'active',
        productType: 'jewellery',
        shortDescription: 'Test product for commerce validation.',
      },
    });
    assert.strictEqual(product.status, 201, JSON.stringify(product.json));
    productId = product.json.data.product.id;

    // Set opening stock balance
    const stock = await call(`/api/admin/inventory/adjust/${productId}`, {
      method: 'POST',
      body: { mode: 'set', quantity: 50, type: 'opening', reason: 'Initial stock for commerce tests' },
    });
    assert.strictEqual(stock.status, 200, JSON.stringify(stock.json));
    assert.strictEqual(stock.json.data.balanceAfter, 50);
  });

  after(async () => {
    await server?.stop();
    await dropDatabase(TEST_DB);
  });

  // ═════════════════════════════════════════════════════════════════════════
  // CUSTOMER PROFILE
  // ════════════════════════════════════════════════════════════════════════

  it('GET /api/me returns profile for signed-in user', async () => {
    const res = await callCustomer('/api/auth/me');
    assert.strictEqual(res.status, 200);
    assert.ok(res.json.success);
    assert.strictEqual(res.json.data.user.email, CUSTOMER_EMAIL);
    assert.ok(res.json.data.user.id);
  });

  it('PATCH /api/me updates profile', async () => {
    const res = await callCustomer('/api/me', {
      method: 'PATCH',
      body: { name: 'Updated Name', phone: '+91 98765 43210' }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.data.user.name, 'Updated Name');
    assert.strictEqual(res.json.data.user.phone, '+91 98765 43210');
  });

  it('wrong current password rejected on password change', async () => {
    const changeRes = await callCustomer('/api/me/password', {
      method: 'POST',
      body: { currentPassword: 'wrong-password', newPassword: 'another-pass-12345' }
    });
    assert.ok([400, 401].includes(changeRes.status));
  });

  // ═════════════════════════════════════════════════════════════════════════
  // ADDRESS MANAGEMENT
  // ════════════════════════════════════════════════════════════════════════

  let addressId;

  it('POST /api/me/addresses creates address', async () => {
    const res = await callCustomer('/api/me/addresses', {
      method: 'POST',
      body: {
        name: 'Test User',
        phone: '+91 90000 00000',
        line1: '123 Test Street',
        line2: 'Apt 4B',
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400001',
        country: 'India',
        isDefault: true
      }
    });
    assert.strictEqual(res.status, 201);
    assert.ok(res.json.data.address.id);
    addressId = res.json.data.address.id;
  });

  it('GET /api/me/addresses lists addresses', async () => {
    const res = await callCustomer('/api/me/addresses');
    assert.strictEqual(res.status, 200);
    assert.ok(res.json.data.addresses.length >= 1);
  });

  it('PATCH /api/me/addresses/:id updates address', async () => {
    const res = await callCustomer(`/api/me/addresses/${addressId}`, {
      method: 'PATCH',
      body: { name: 'Updated Name', city: 'Delhi' }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.data.address.name, 'Updated Name');
    assert.strictEqual(res.json.data.address.city, 'Delhi');
  });

  it('POST /api/me/addresses/:id/default sets default address', async () => {
    const res = await callCustomer(`/api/me/addresses/${addressId}/default`, {
      method: 'POST'
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.data.address.isDefault, true);
  });

  it('DELETE /api/me/addresses/:id deletes address', async () => {
    const res = await callCustomer(`/api/me/addresses/${addressId}`, {
      method: 'DELETE'
    });
    assert.strictEqual(res.status, 200);
    assert.ok(res.json.success);

    const listRes = await callCustomer('/api/me/addresses');
    assert.strictEqual(listRes.json.data.addresses.find(a => a.id === addressId), undefined);
  });

  it('rejects access to another user address (IDOR prevention)', async () => {
    const { cookie: cookie2 } = await createSecondaryUser('address-test');

    // User 2 tries to access User 1's address
    const res = await api(base, `/api/me/addresses/${addressId}`, { cookie: cookie2 });
    assert.strictEqual(res.status, 404);
  });

  // ═════════════════════════════════════════════════════════════════════════
  // CART VALIDATION (uses shared session, no logout)
  // ═════════════════════════════════════════════════════════════════════════

  it('GET /api/cart returns empty cart initially', async () => {
    await callCustomer('/api/cart', { method: 'DELETE' });
    const res = await callCustomer('/api/cart');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.data.cart.items.length, 0);
  });

  it('POST /api/cart/items adds product to cart', async () => {
    await callCustomer('/api/cart', { method: 'DELETE' });
    await restoreStock(50);
    const res = await callCustomer('/api/cart/items', {
      method: 'POST',
      body: { productId, quantity: 2 }
    });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.json.data.cart.items.length, 1);
    assert.strictEqual(res.json.data.cart.items[0].quantity, 2);
    assert.ok(res.json.data.cart.items[0].productId === productId);
  });

  it('rejects adding more than available stock', async () => {
    await callCustomer('/api/cart', { method: 'DELETE' });
    // Set stock to 1
    await call(`/api/admin/inventory/adjust/${productId}`, {
      method: 'POST',
      body: { mode: 'set', quantity: 1, type: 'adjustment', reason: 'Test stock limit' }
    });

    // Try to add 2
    const res = await callCustomer('/api/cart/items', {
      method: 'POST',
      body: { productId, quantity: 2 }
    });
    assert.strictEqual(res.status, 409); // Order number conflict due to stock check failure
    assert.ok(res.json.message.includes('left') || res.json.message.includes('stock') || res.json.message.includes('available'));

    // Restore stock
    await restoreStock(50);
  });

  it('PATCH /api/cart/items/:productId updates quantity', async () => {
    await callCustomer('/api/cart', { method: 'DELETE' });
    await restoreStock(50);
    await addToCart(2);
    const res = await callCustomer(`/api/cart/items/${productId}`, {
      method: 'PATCH',
      body: { quantity: 5 }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.data.cart.items[0].quantity, 5);
  });

  it('rejects quantity exceeding stock', async () => {
    await restoreStock(1);
    await callCustomer('/api/cart', { method: 'DELETE' });
    await addToCart(1);
    const res = await callCustomer(`/api/cart/items/${productId}`, {
      method: 'PATCH',
      body: { quantity: 2 } // Exceeds stock of 1
    });
    assert.strictEqual(res.status, 409); // Order number conflict due to stock check failure
    await restoreStock(50);
  });

  it('DELETE /api/cart/items/:productId removes item', async () => {
    await restoreStock(50);
    await callCustomer('/api/cart', { method: 'DELETE' });
    await addToCart(2);
    const res = await callCustomer(`/api/cart/items/${productId}`, {
      method: 'DELETE'
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.data.cart.items.length, 0);
  });

  it('DELETE /api/cart clears entire cart', async () => {
    await callCustomer('/api/cart', { method: 'DELETE' });
    await addToCart(1);
    const res = await callCustomer('/api/cart', { method: 'DELETE' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.data.cart.items.length, 0);
  });

  it('server-side price calculation (client prices not trusted)', async () => {
    await restoreStock(50);
    await callCustomer('/api/cart', { method: 'DELETE' });
    await addToCart(2);

    const cartRes = await callCustomer('/api/cart');
    const item = cartRes.json.data.cart.items[0];

    // Price should come from server (product.effectivePrice)
    // Product price is 2500, so 2 * 2500 = 5000
    assert.strictEqual(item.unitPrice, 2500);
    assert.strictEqual(item.lineTotal, 5000);
  });

  // ═════════════════════════════════════════════════════════════════════════
  // WISHLIST VALIDATION
  // ═════════════════════════════════════════════════════════════════════════

  it('GET /api/wishlist returns empty wishlist initially', async () => {
    // Clear wishlist
    const wishRes = await callCustomer('/api/wishlist');
    if (wishRes.json.data.wishlist.count > 0) {
      const items = wishRes.json.data.wishlist.items;
      for (const item of items) {
        await callCustomer(`/api/wishlist/${item.productId}`, { method: 'DELETE' });
      }
    }
    const res = await callCustomer('/api/wishlist');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.data.wishlist.count, 0);
  });

  it('POST /api/wishlist/:productId adds product', async () => {
    const res = await callCustomer(`/api/wishlist/${productId}`, {
      method: 'POST'
    });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.json.data.wishlist.count, 1);
  });

  it('duplicate add is idempotent (returns alreadySaved)', async () => {
    const res = await callCustomer(`/api/wishlist/${productId}`, {
      method: 'POST'
    });
    assert.strictEqual(res.status, 200); // Returns 200 with alreadySaved: true
    assert.ok(res.json.data.alreadySaved === true);
  });

  it('DELETE /api/wishlist/:productId removes item', async () => {
    const res = await callCustomer(`/api/wishlist/${productId}`, {
      method: 'DELETE'
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.data.wishlist.count, 0);
  });

  it('POST /api/wishlist/:productId/move-to-cart moves to cart', async () => {
    // Clear cart first
    await callCustomer('/api/cart', { method: 'DELETE' });
    // Add to wishlist first
    await callCustomer(`/api/wishlist/${productId}`, { method: 'POST' });

    // Move to cart
    const res = await callCustomer(`/api/wishlist/${productId}/move-to-cart`, {
      method: 'POST',
      body: { quantity: 2 }
    });
    assert.strictEqual(res.status, 200);
    assert.ok(res.json.data.moved);

    // Item should be in cart
    const cartRes = await callCustomer('/api/cart');
    assert.strictEqual(cartRes.json.data.cart.items.length, 1);
    assert.strictEqual(cartRes.json.data.cart.items[0].quantity, 2);

    // Item should be removed from wishlist
    const wishRes = await callCustomer('/api/wishlist');
    assert.strictEqual(wishRes.json.data.wishlist.count, 0);
  });

  it('move-to-cart fails when product is unavailable', async () => {
    // First set an opening balance, then set stock to 0 (makes product unavailable)
    await call(`/api/admin/inventory/adjust/${productId}`, {
      method: 'POST',
      body: { mode: 'set', quantity: 10, type: 'opening', reason: 'Initial stock for OOS test' }
    });
    await call(`/api/admin/inventory/adjust/${productId}`, {
      method: 'POST',
      body: { mode: 'set', quantity: 0, type: 'adjustment', reason: 'Test OOS' }
    });

    // Add to wishlist
    await callCustomer(`/api/wishlist/${productId}`, { method: 'POST' });

    // Move to cart - should fail because product is unavailable
    const res = await callCustomer(`/api/wishlist/${productId}/move-to-cart`, {
      method: 'POST',
      body: { quantity: 1 }
    });
    assert.ok([409, 422].includes(res.status)); // Fails due to unavailable product
    assert.ok(res.json.message.includes('available') || res.json.message.includes('stock'));

    // Restore stock
    await restoreStock(50);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // CHECKOUT (CASH ON DELIVERY)
  // ═════════════════════════════════════════════════════════════════════════

  async function addToCart(qty = 1) {
    const res = await callCustomer('/api/cart/items', {
      method: 'POST',
      body: { productId, quantity: qty }
    });
    assert.ok(res.status === 200 || res.status === 201, `cart add failed: ${JSON.stringify(res.json)}`);
    return res;
  }

  async function placeCodOrder(opts = {}) {
    const { quantity = 1, address, idempotencyKey } = opts;
    await addToCart(quantity);
    const body = {
      paymentMethod: 'cod',
      address: address || {
        name: 'Test Customer',
        phone: '+91 90000 00000',
        line1: '123 Test Street',
        city: 'Test City',
        state: 'Test State',
        pincode: '110001',
        country: 'India'
      }
    };
    const headers = idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {};
    const res = await callCustomer('/api/checkout/cod', {
      method: 'POST',
      headers,
      body
    });
    assert.strictEqual(res.status, 201, `COD order failed: ${JSON.stringify(res.json)}`);
    return res.json.data.order;
  }

  it('POST /api/checkout/cod creates order with COD', async () => {
    await restoreStock(50);
    await callCustomer('/api/cart', { method: 'DELETE' });
    await addToCart(2);
    const order = await placeCodOrder({ quantity: 2 });
    assert.ok(order.id);
    assert.strictEqual(order.paymentMethod, 'cod');
    assert.strictEqual(order.status, 'pending');
  });

  it('order contains correct item snapshots', async () => {
    await restoreStock(50);
    await callCustomer('/api/cart', { method: 'DELETE' });
    // placeCodOrder adds to cart internally
    const order = await placeCodOrder({ quantity: 2 });
    assert.strictEqual(order.items.length, 1);
    assert.strictEqual(order.items[0].productId, productId);
    assert.strictEqual(order.items[0].quantity, 2);
    assert.strictEqual(order.items[0].unitPrice, 2500);
    assert.strictEqual(order.items[0].lineTotal, 5000);
  });

  it('inventory committed on COD order', async () => {
    await restoreStock(50);
    await callCustomer('/api/cart', { method: 'DELETE' });
    // placeCodOrder adds to cart internally
    const stockBefore = (await call(`/api/admin/products/${productId}`)).json.data.product.stock;

    await placeCodOrder({ quantity: 2 });

    const stockAfter = (await call(`/api/admin/products/${productId}`)).json.data.product.stock;
    assert.strictEqual(stockAfter, stockBefore - 2);
  });

  it('idempotency key prevents duplicate orders', async () => {
    await restoreStock(50);
    await callCustomer('/api/cart', { method: 'DELETE' });
    await addToCart(2);

    const idempotencyKey = `idem-${Date.now()}`;

    // First request
    const order1 = await placeCodOrder({ quantity: 2, idempotencyKey });
    const orderId1 = order1.id;

    // Second request with same key (need to add to cart again)
    await addToCart(2);
    const idempotencyKey2 = idempotencyKey;
    const res2 = await callCustomer('/api/checkout/cod', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey2 },
      body: {
        paymentMethod: 'cod',
        address: {
          name: 'Test Customer',
          phone: '+91 90000 00000',
          line1: '123 Test Street',
          city: 'Test City',
          state: 'Test State',
          pincode: '110001',
          country: 'India'
        }
      }
    });
    assert.strictEqual(res2.status, 200); // Replayed order returns 200
    assert.strictEqual(res2.json.data.order.id, orderId1);
    assert.ok(res2.json.data.replayed === true);
  });

  it('cart cleared after successful COD order', async () => {
    await restoreStock(50);
    await callCustomer('/api/cart', { method: 'DELETE' });
    await addToCart(1);

    await placeCodOrder({ quantity: 1 });

    const cartRes = await callCustomer('/api/cart');
    assert.strictEqual(cartRes.json.data.cart.items.length, 0);
  });

  // ═════════════════════════════════════════════════════════════════════════
  // ORDER HISTORY AND DETAIL
  // ═════════════════════════════════════════════════════════════════════════

  let orderId;
  let orderNumber;

  it('place a COD order for order history tests', async () => {
    await restoreStock(50);
    await callCustomer('/api/cart', { method: 'DELETE' });
    await addToCart(1);
    const order = await placeCodOrder({ quantity: 1 });
    orderId = order.id;
    orderNumber = order.orderNumber;
  });

  it('GET /api/orders lists orders for signed-in user', async () => {
    const res = await callCustomer('/api/orders');
    assert.strictEqual(res.status, 200);
    assert.ok(res.json.data.orders.length >= 1);
  });

  it('GET /api/orders/:orderId returns order detail', async () => {
    const res = await callCustomer(`/api/orders/${orderId}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.data.order.id, orderId);
  });

  it('GET /api/orders/:orderNumber returns order by order number', async () => {
    const res = await callCustomer(`/api/orders/${orderNumber}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.data.order.orderNumber, orderNumber);
  });

  it('rejects access to another user order', async () => {
    const { cookie: cookie2 } = await createSecondaryUser('order-test');

    const res = await api(base, `/api/orders/${orderId}`, { cookie: cookie2 });
    assert.strictEqual(res.status, 404);
  });

  it('order contains shipping address snapshot', async () => {
    const res = await callCustomer(`/api/orders/${orderId}`);
    const order = res.json.data.order;
    assert.ok(order.shippingAddress);
    assert.ok(order.shippingAddress.name);
    assert.ok(order.shippingAddress.line1);
    assert.ok(order.shippingAddress.city);
    assert.ok(order.shippingAddress.pincode);
  });

  // ═════════════════════════════════════════════════════════════════════════
  // INVENTORY CONSISTENCY (uses separate test product to avoid stock depletion)
  // ════════════════════════════════════════════════════════════════════════

  let testProductId;

  it('create inventory test product with stock=10', async () => {
    const product = await call('/api/admin/products', {
      method: 'POST',
      body: {
        name: 'Inventory Test Product',
        slug: `inventory-test-${Date.now()}`,
        category: 'pendant',
        price: 1500,
        costPrice: 600,
        status: 'active',
        productType: 'jewellery',
        shortDescription: 'Test for inventory consistency.',
      },
    });
    assert.strictEqual(product.status, 201);
    testProductId = product.json.data.product.id;

    // Set opening stock to 10 using mode: 'set' (works for both tracked and untracked)
    const stock = await call(`/api/admin/inventory/adjust/${testProductId}`, {
      method: 'POST',
      body: { mode: 'set', quantity: 10, type: 'opening', reason: 'Initial stock' }
    });
    assert.strictEqual(stock.status, 200);
    assert.strictEqual(stock.json.data.balanceAfter, 10);
  });

  it('concurrent purchases do not oversell (race condition test)', async () => {
    const stockBefore = (await call(`/api/admin/products/${testProductId}`)).json.data.product.stock;
    // stockBefore should be 10

    // Place 12 concurrent orders for 1 item each (stock = 10) -> should oversell
    // Note: Oversell returns 409 (order number conflict) because order number reservation fails first,
    // but inventory protection works (stock never goes negative)
    const promises = Array(12).fill(null).map(() => {
      const email = `race-${Date.now()}-${Math.random()}@example.com`;
      return (async () => {
        const reg = await api(base, '/api/auth/register', {
          method: 'POST',
          body: { name: 'Race User', email, password: 'pass123456' }
        });
        const cookie = sessionCookie((await api(base, '/api/auth/login', {
          method: 'POST',
          body: { email, password: 'pass123456' }
        })).res);

        await api(base, '/api/cart/items', {
          method: 'POST',
          cookie,
          body: { productId: testProductId, quantity: 1 }
        });

        return api(base, '/api/checkout/cod', {
          method: 'POST',
          cookie,
          body: {
            paymentMethod: 'cod',
            address: {
              name: 'Race User',
              phone: '+91 90000 00000',
              line1: '123 Test St',
              city: 'Test City',
              state: 'Test State',
              pincode: '110001',
              country: 'India'
            }
          }
        });
      })();
    });

    const results = await Promise.all(promises);
    const successCount = results.filter(r => r.status === 201).length;
    const failureCount = results.filter(r => r.status !== 201).length;

    // Should succeed for available stock (10), fail for oversell (2)
    // Failures may be 409 (order number conflict) or 422 (out of stock)
    assert.strictEqual(successCount, 10, 'Exactly 10 orders should succeed');
    assert.strictEqual(failureCount, 2, '2 orders should fail due to oversell');

    const stockAfter = (await call(`/api/admin/products/${testProductId}`)).json.data.product.stock;
    const totalSold = stockBefore - stockAfter;
    assert.strictEqual(totalSold, successCount, 'Stock decremented exactly by successful orders');
    assert.strictEqual(stockAfter, 0, 'Stock should be 0 after selling all 10');
  });

  it('stock never goes negative', async () => {
    // Reset stock to 1
    await call(`/api/admin/inventory/adjust/${testProductId}`, {
      method: 'POST',
      body: { mode: 'set', quantity: 1, type: 'adjustment', reason: 'Set to 1' }
    });

    // Try to buy 2 concurrently
    const promises = Array(2).fill(null).map(() => {
      const email = `neg-test-${Date.now()}-${Math.random()}@example.com`;
      return (async () => {
        const reg = await api(base, '/api/auth/register', {
          method: 'POST',
          body: { name: 'Neg Test', email, password: 'pass123456' }
        });
        const cookie = sessionCookie((await api(base, '/api/auth/login', {
          method: 'POST',
          body: { email, password: 'pass123456' }
        })).res);

        await api(base, '/api/cart/items', {
          method: 'POST',
          cookie,
          body: { productId: testProductId, quantity: 1 }
        });

        return api(base, '/api/checkout/cod', {
          method: 'POST',
          cookie,
          body: {
            paymentMethod: 'cod',
            address: {
              name: 'Test', phone: '+91 90000 00000',
              line1: '123 St', city: 'City', state: 'State',
              pincode: '110001', country: 'India'
            }
          }
        });
      })();
    });

    const results = await Promise.all(promises);
    const successCount = results.filter(r => r.status === 201).length;

    const stockAfter = (await call(`/api/admin/products/${testProductId}`)).json.data.product.stock;
    assert.strictEqual(stockAfter, 0, 'Stock should be 0, never negative');
    assert.strictEqual(successCount, 1, 'Only one order should succeed');
  });

  it('order cancellation restores inventory exactly once', async () => {
    // Set stock to known value
    await call(`/api/admin/inventory/adjust/${testProductId}`, {
      method: 'POST',
      body: { mode: 'set', quantity: 20, type: 'adjustment', reason: 'Reset for cancel test' }
    });

    // Place COD order
    const email = `cancel-test-${Date.now()}@example.com`;
    const reg = await api(base, '/api/auth/register', {
      method: 'POST',
      body: { name: 'Cancel Test', email, password: 'pass123456' }
    });
    const cookie = sessionCookie((await api(base, '/api/auth/login', {
      method: 'POST',
      body: { email, password: 'pass123456' }
    })).res);

    await api(base, '/api/cart/items', {
      method: 'POST',
      cookie,
      body: { productId: testProductId, quantity: 2 }
    });
    const orderRes = await api(base, '/api/checkout/cod', {
      method: 'POST',
      cookie,
      body: {
        paymentMethod: 'cod',
        address: { name: 'Test', phone: '+91 90000 00000', line1: '123 St', city: 'City', state: 'State', pincode: '110001', country: 'India' }
      }
    });
    const orderId = orderRes.json.data.order.id;

    // Cancel via admin
    const cancelRes = await call(`/api/admin/orders/${orderId}/status`, {
      method: 'PATCH',
      body: { status: 'cancelled', note: 'Customer cancelled' }
    });
    assert.strictEqual(cancelRes.status, 200);

    // Verify stock restored
    const stockAfter = (await call(`/api/admin/products/${testProductId}`)).json.data.product.stock;
    assert.strictEqual(stockAfter, 20, 'Stock should be restored to 20');

    // Verify ledger has return movement
    const movementsRes = await call(`/api/admin/inventory/movements?productId=${testProductId}&limit=10`);
    const returnMovements = movementsRes.json.data.items.filter(m => m.type === 'return');
    assert.ok(returnMovements.length >= 1, 'Ledger should have return movement');
    const latestReturn = returnMovements[0];
    assert.strictEqual(latestReturn.quantity, 2, 'Return quantity should be +2');
  });

  it('duplicate cancellation does not double-restore', async () => {
    // Get the order we just cancelled
    const ordersRes = await call(`/api/admin/orders?limit=1`);
    const orderId = ordersRes.json.data.orders[0].id;

    const cancelAgain = await call(`/api/admin/orders/${orderId}/status`, {
      method: 'PATCH',
      body: { status: 'cancelled', note: 'Duplicate cancellation' }
    });
    assert.strictEqual(cancelAgain.status, 200);

    // Stock should still be 20 (not 22)
    const stock = (await call(`/api/admin/products/${testProductId}`)).json.data.product.stock;
    assert.strictEqual(stock, 20, 'Repeated cancellation must not double-restore');

    // Ledger should not have additional return movements for this order
    const orderDetail = await call(`/api/admin/orders/${orderId}`);
    const orderNumber = orderDetail.json.data.order.orderNumber;

    const movements = await call(`/api/admin/inventory/movements?productId=${testProductId}&limit=50`);
    const returnMovements = movements.json.data.items.filter(m =>
      m.type === 'return' && m.reference && m.reference.includes(orderNumber)
    );
    assert.strictEqual(returnMovements.length, 1, 'Exactly one return per order regardless of duplicate cancellations');
  });

  it('invalid status transition rejected', async () => {
    // Place a new order
    const email = `transition-test-${Date.now()}@example.com`;
    const reg = await api(base, '/api/auth/register', {
      method: 'POST',
      body: { name: 'Transition Test', email, password: 'pass123456' }
    });
    const cookie = sessionCookie((await api(base, '/api/auth/login', {
      method: 'POST',
      body: { email, password: 'pass123456' }
    })).res);

    await api(base, '/api/cart/items', {
      method: 'POST',
      cookie,
      body: { productId: testProductId, quantity: 1 }
    });
    const orderRes = await api(base, '/api/checkout/cod', {
      method: 'POST',
      cookie,
      body: {
        paymentMethod: 'cod',
        address: { name: 'Test', phone: '+91 90000 00000', line1: '123 St', city: 'City', state: 'State', pincode: '110001', country: 'India' }
      }
    });
    const orderId = orderRes.json.data.order.id;

    // Try invalid transition: pending -> delivered (not allowed, must go through paid/shipped)
    const badTransition = await call(`/api/admin/orders/${orderId}/status`, {
      method: 'PATCH',
      body: { status: 'delivered' }
    });
    assert.strictEqual(badTransition.status, 409, 'Invalid transition must be refused');
  });

  // ═════════════════════════════════════════════════════════════════════════
  // SESSION STATE CHANGES (run last — invalidate shared session)
  // ═════════════════════════════════════════════════════════════════════════

  it('POST /api/me/password changes password and invalidates old sessions', async () => {
    const oldPassword = CUSTOMER_PASSWORD;
    const newPassword = 'new-customer-pass-12345';

    const changeRes = await callCustomer('/api/me/password', {
      method: 'POST',
      body: { currentPassword: oldPassword, newPassword }
    });
    assert.strictEqual(changeRes.status, 200);

    // Old token should be invalid
    const meRes = await callCustomer('/api/auth/me');
    assert.strictEqual(meRes.status, 401);

    // Re-login with new password and update shared cookie
    const loginRes = await api(base, '/api/auth/login', {
      method: 'POST',
      body: { email: CUSTOMER_EMAIL, password: newPassword }
    });
    assert.strictEqual(loginRes.status, 200);
    customerCookie = sessionCookie(loginRes.res);
    assert.ok(customerCookie, 're-login should issue new cookie');
  });

  it('cart persists after logout and login', async () => {
    await callCustomer('/api/cart', { method: 'DELETE' });
    await addToCart(3);

    // Logout
    await callCustomer('/api/auth/logout', { method: 'POST' });

    // Login again with current password
    const loginRes = await api(base, '/api/auth/login', {
      method: 'POST',
      body: { email: CUSTOMER_EMAIL, password: 'new-customer-pass-12345' }
    });
    const newCookie = sessionCookie(loginRes.res);
    assert.ok(newCookie);

    // Check cart persisted
    const cartRes = await api(base, '/api/cart', { cookie: newCookie });
    assert.strictEqual(cartRes.status, 200);
    assert.strictEqual(cartRes.json.data.cart.items.length, 1);
    assert.strictEqual(cartRes.json.data.cart.items[0].quantity, 3);
  });

  it('wishlist persists after logout and login', async () => {
    await callCustomer(`/api/wishlist/${productId}`, { method: 'POST' });

    // Logout and login
    await callCustomer('/api/auth/logout', { method: 'POST' });
    const loginRes = await api(base, '/api/auth/login', {
      method: 'POST',
      body: { email: CUSTOMER_EMAIL, password: 'new-customer-pass-12345' }
    });
    const newCookie = sessionCookie(loginRes.res);
    assert.ok(newCookie);

    const wishRes = await api(base, '/api/wishlist', { cookie: newCookie });
    assert.strictEqual(wishRes.status, 200);
    assert.strictEqual(wishRes.json.data.wishlist.count, 1);
  });
});