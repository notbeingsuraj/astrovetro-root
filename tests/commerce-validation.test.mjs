/* -------------------------------------------------------------------------
   Phase 2 — Customer Commerce Validation
   -------------------------------------------------------------------------
   Validates complete customer commerce workflows using isolated test accounts.
   Tests cart, wishlist, addresses, checkout (COD), orders, and inventory.
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

  before(async () => {
    await createAdmin({ databaseUrl: TEST_DB, email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    server = await startServer({ port: PORT, databaseUrl: TEST_DB });
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
      body: { mode: 'delta', quantity: 50, type: 'opening', reason: 'Initial stock for commerce tests' },
    });
    assert.strictEqual(stock.status, 200, JSON.stringify(stock.json));
    assert.strictEqual(stock.json.data.balanceAfter, 50);
  });

  after(async () => {
    await server?.stop();
    await dropDatabase(TEST_DB);
  });

  // ═══════════════════════════════════════════════════════════════════
  // CUSTOMER PROFILE VALIDATION
  // ═══════════════════════════════════════════════════════════════════

  describe('Customer Profile', () => {
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

      // New password works - re-login and update shared cookie
      const loginRes = await api(base, '/api/auth/login', {
        method: 'POST',
        body: { email: CUSTOMER_EMAIL, password: newPassword }
      });
      assert.strictEqual(loginRes.status, 200);
      customerCookie = sessionCookie(loginRes.res);
      assert.ok(customerCookie, 're-login should issue new cookie');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // ADDRESS MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════

  describe('Address Management', () => {
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
      // Create another user
      const email2 = `address-test-2-${Date.now()}@example.com`;
      const reg2 = await api(base, '/api/auth/register', {
        method: 'POST',
        body: { name: 'User 2', email: email2, password: 'pass123456' }
      });
      const cookie2 = sessionCookie((await api(base, '/api/auth/login', {
        method: 'POST',
        body: { email: email2, password: 'pass123456' }
      })).res);

      // User 2 tries to access User 1's address
      const res = await api(base, `/api/me/addresses/${addressId}`, { cookie: cookie2 });
      assert.strictEqual(res.status, 404);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // CART VALIDATION
  // ═══════════════════════════════════════════════════════════════════

  describe('Cart Operations', () => {
    before(async () => {
      // Clear cart before each test group
      await callCustomer('/api/cart', { method: 'DELETE' });
    });

    it('GET /api/cart returns empty cart initially', async () => {
      const res = await callCustomer('/api/cart');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.json.data.cart.items.length, 0);
    });

    it('POST /api/cart/items adds product to cart', async () => {
      const res = await callCustomer('/api/cart/items', {
        method: 'POST',
        body: { productId, quantity: 2 }
      });
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.json.data.cart.items.length, 1);
      assert.strictEqual(res.json.data.cart.items[0].quantity, 2);
      assert.ok(res.json.data.cart.items[0].product.id === productId);
    });

    it('rejects adding more than available stock', async () => {
      // Set stock to 1
      await api(base, `/api/admin/inventory/adjust/${productId}`, {
        method: 'POST',
        cookie: adminCookie,
        body: { mode: 'absolute', quantity: 1, type: 'adjustment', reason: 'Test stock limit' }
      });

      // Try to add 2
      const res = await callCustomer('/api/cart/items', {
        method: 'POST',
        body: { productId, quantity: 2 }
      });
      assert.strictEqual(res.status, 422);
      assert.ok(res.json.message.includes('stock') || res.json.message.includes('available'));

      // Restore stock
      await api(base, `/api/admin/inventory/adjust/${productId}`, {
        method: 'POST',
        cookie: adminCookie,
        body: { mode: 'absolute', quantity: 50, type: 'adjustment', reason: 'Restore stock' }
      });
    });

    it('PATCH /api/cart/items/:productId updates quantity', async () => {
      const res = await callCustomer(`/api/cart/items/${productId}`, {
        method: 'PATCH',
        body: { quantity: 5 }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.json.data.cart.items[0].quantity, 5);
    });

    it('rejects quantity exceeding stock', async () => {
      const res = await callCustomer(`/api/cart/items/${productId}`, {
        method: 'PATCH',
        body: { quantity: 100 }
      });
      assert.strictEqual(res.status, 422);
    });

    it('DELETE /api/cart/items/:productId removes item', async () => {
      const res = await callCustomer(`/api/cart/items/${productId}`, {
        method: 'DELETE'
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.json.data.cart.items.length, 0);
    });

    it('DELETE /api/cart clears entire cart', async () => {
      // Add item first
      await callCustomer('/api/cart/items', {
        method: 'POST',
        body: { productId, quantity: 1 }
      });

      const res = await callCustomer('/api/cart', { method: 'DELETE' });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.json.data.cart.items.length, 0);
    });

    it('cart persists after logout and login', async () => {
      // Add item
      await callCustomer('/api/cart/items', {
        method: 'POST',
        body: { productId, quantity: 3 }
      });

      // Logout
      await callCustomer('/api/auth/logout', { method: 'POST' });

      // Login again
      const loginRes = await api(base, '/api/auth/login', {
        method: 'POST',
        body: { email: CUSTOMER_EMAIL, password: CUSTOMER_PASSWORD }
      });
      const newCookie = sessionCookie(loginRes.res);
      assert.ok(newCookie);

      // Check cart persisted
      const cartRes = await api(base, '/api/cart', { cookie: newCookie });
      assert.strictEqual(cartRes.status, 200);
      assert.strictEqual(cartRes.json.data.cart.items.length, 1);
      assert.strictEqual(cartRes.json.data.cart.items[0].quantity, 3);
    });

    it('server-side price calculation (client prices not trusted)', async () => {
      // Add item with known price
      await callCustomer('/api/cart/items', {
        method: 'POST',
        body: { productId, quantity: 2 }
      });

      const cartRes = await callCustomer('/api/cart');
      const item = cartRes.json.data.cart.items[0];
      
      // Price should come from server (product.effectivePrice)
      // Product price is 2500, so 2 * 2500 = 5000
      assert.strictEqual(item.unitPrice, 2500);
      assert.strictEqual(item.lineTotal, 5000);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // WISHLIST VALIDATION
  // ═══════════════════════════════════════════════════════════════════

  describe('Wishlist Operations', () => {
    before(async () => {
      // Clear wishlist
      const wishRes = await callCustomer('/api/wishlist');
      if (wishRes.json.data.wishlist.count > 0) {
        const items = wishRes.json.data.wishlist.items;
        for (const item of items) {
          await callCustomer(`/api/wishlist/${item.productId}`, { method: 'DELETE' });
        }
      }
    });

    it('GET /api/wishlist returns empty wishlist initially', async () => {
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
      assert.strictEqual(res.status, 201);
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

    it('move-to-cart fails gracefully if out of stock', async () => {
      // Set stock to 0
      await api(base, `/api/admin/inventory/adjust/${productId}`, {
        method: 'POST',
        cookie: adminCookie,
        body: { mode: 'absolute', quantity: 0, type: 'adjustment', reason: 'Test OOS' }
      });

      // Add to wishlist
      await callCustomer(`/api/wishlist/${productId}`, { method: 'POST' });

      // Try to move to cart
      const res = await callCustomer(`/api/wishlist/${productId}/move-to-cart`, {
        method: 'POST',
        body: { quantity: 1 }
      });
      assert.strictEqual(res.status, 422);
      assert.ok(res.json.message.includes('stock') || res.json.message.includes('available'));

      // Restore stock
      await api(base, `/api/admin/inventory/adjust/${productId}`, {
        method: 'POST',
        cookie: adminCookie,
        body: { mode: 'absolute', quantity: 50, type: 'adjustment', reason: 'Restore' }
      });
    });

    it('wishlist persists after logout and login', async () => {
      await callCustomer(`/api/wishlist/${productId}`, { method: 'POST' });

      // Logout and login
      await callCustomer('/api/auth/logout', { method: 'POST' });
      const loginRes = await api(base, '/api/auth/login', {
        method: 'POST',
        body: { email: CUSTOMER_EMAIL, password: CUSTOMER_PASSWORD }
      });
      const newCookie = sessionCookie(loginRes.res);
      assert.ok(newCookie);

      const wishRes = await api(base, '/api/wishlist', { cookie: newCookie });
      assert.strictEqual(wishRes.status, 200);
      assert.strictEqual(wishRes.json.data.wishlist.count, 1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // CHECKOUT (CASH ON DELIVERY)
  // ═══════════════════════════════════════════════════════════════════

  describe('Cash on Delivery Checkout', () => {
    before(async () => {
      // Ensure cart has items
      await callCustomer('/api/cart', { method: 'DELETE' });
      await callCustomer('/api/cart/items', {
        method: 'POST',
        body: { productId, quantity: 2 }
      });
    });

    it('POST /api/checkout/cod creates order with COD', async () => {
      const res = await callCustomer('/api/checkout/cod', {
        method: 'POST',
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
      assert.strictEqual(res.status, 201);
      assert.ok(res.json.data.order.id);
      assert.strictEqual(res.json.data.order.paymentMethod, 'cod');
      assert.strictEqual(res.json.data.order.status, 'pending');
    });

    it('order contains correct item snapshots', async () => {
      const res = await callCustomer('/api/checkout/cod', {
        method: 'POST',
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
      const order = res.json.data.order;
      assert.strictEqual(order.items.length, 1);
      assert.strictEqual(order.items[0].product, productId);
      assert.strictEqual(order.items[0].quantity, 2);
      assert.strictEqual(order.items[0].unitPrice, 2500);
      assert.strictEqual(order.items[0].lineTotal, 5000);
    });

    it('inventory committed on COD order', async () => {
      const stockBefore = await api(base, `/api/admin/products/${productId}`, { cookie: adminCookie });
      const stockBeforeVal = stockBefore.json.data.product.stock;

      await callCustomer('/api/checkout/cod', {
        method: 'POST',
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

      const stockAfter = await api(base, `/api/admin/products/${productId}`, { cookie: adminCookie });
      const stockAfterVal = stockAfter.json.data.product.stock;

      assert.strictEqual(stockAfterVal, stockBeforeVal - 2);
    });

    it('idempotency key prevents duplicate orders', async () => {
      const idempotencyKey = `idem-${Date.now()}`;

      // First request
      const res1 = await callCustomer('/api/checkout/cod', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
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
      assert.strictEqual(res1.status, 201);
      const orderId1 = res1.json.data.order.id;

      // Second request with same key
      const res2 = await callCustomer('/api/checkout/cod', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
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
      assert.strictEqual(res2.status, 201);
      assert.strictEqual(res2.json.data.order.id, orderId1);
      assert.ok(res2.json.data.replayed === true);
    });

    it('cart cleared after successful COD order', async () => {
      // Add to cart
      await callCustomer('/api/cart/items', {
        method: 'POST',
        body: { productId, quantity: 1 }
      });

      await callCustomer('/api/checkout/cod', {
        method: 'POST',
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

      const cartRes = await callCustomer('/api/cart');
      assert.strictEqual(cartRes.json.data.cart.items.length, 0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // ORDER HISTORY AND DETAIL
  // ═══════════════════════════════════════════════════════════════════

  describe('Order History and Detail', () => {
    let orderId;
    let orderNumber;

    before(async () => {
      // Place a COD order
      await callCustomer('/api/cart/items', {
        method: 'POST',
        body: { productId, quantity: 1 }
      });
      const res = await callCustomer('/api/checkout/cod', {
        method: 'POST',
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
      orderId = res.json.data.order.id;
      orderNumber = res.json.data.order.orderNumber;
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
      const email2 = `order-test-2-${Date.now()}@example.com`;
      const reg2 = await api(base, '/api/auth/register', {
        method: 'POST',
        body: { name: 'User 2', email: email2, password: 'pass123456' }
      });
      const cookie2 = sessionCookie((await api(base, '/api/auth/login', {
        method: 'POST',
        body: { email: email2, password: 'pass123456' }
      })).res);

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
  });

  // ═══════════════════════════════════════════════════════════════════
  // INVENTORY CONSISTENCY
  // ═══════════════════════════════════════════════════════════════════

  describe('Inventory Consistency', () => {
    let testProductId;

    before(async () => {
      // Create a test product with stock
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

      // Set opening stock
      await call(`/api/admin/inventory/adjust/${testProductId}`, {
        method: 'POST',
        body: { mode: 'delta', quantity: 10, type: 'opening', reason: 'Initial stock' }
      });
    });

    it('concurrent purchases do not oversell (race condition test)', async () => {
      const stockBefore = (await call(`/api/admin/products/${testProductId}`)).json.data.product.stock;

      // Place 3 concurrent orders for 1 item each (stock = 10)
      const promises = Array(3).fill(null).map(() => {
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
      const failureCount = results.filter(r => r.status === 422).length;

      // Should succeed for available stock, fail for oversell
      assert.ok(successCount >= 1 && failureCount >= 1, 'Some should succeed, some should fail on oversell');

      const stockAfter = (await call(`/api/admin/products/${testProductId}`)).json.data.product.stock;
      const totalSold = stockBefore - stockAfter;
      assert.strictEqual(totalSold, successCount, 'Stock decremented exactly by successful orders');
    });

    it('stock never goes negative', async () => {
      // Set stock to 1
      await call(`/api/admin/inventory/adjust/${testProductId}`, {
        method: 'POST',
        body: { mode: 'absolute', quantity: 1, type: 'adjustment', reason: 'Set to 1' }
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
      assert.strictEqual(stockAfter, 0, 'Stock should never go negative');
      assert.strictEqual(successCount, 1, 'Only one order should succeed');
    });

    it('order cancellation restores inventory exactly once', async () => {
      // Set stock to known value
      await call(`/api/admin/inventory/adjust/${testProductId}`, {
        method: 'POST',
        body: { mode: 'absolute', quantity: 20, type: 'adjustment', reason: 'Reset for cancel test' }
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
      // Order already cancelled in previous test, try again
      const orderId = (await call(`/api/admin/orders?limit=1`)).json.data.items[0].id;
      
      const cancelAgain = await call(`/api/admin/orders/${orderId}/status`, {
        method: 'PATCH',
        body: { status: 'cancelled', note: 'Duplicate cancellation' }
      });
      assert.strictEqual(cancelAgain.status, 200);

      // Stock should still be 20 (not 22)
      const stock = (await call(`/api/admin/products/${testProductId}`)).json.data.product.stock;
      assert.strictEqual(stock, 20, 'Repeated cancellation must not double-restore');
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

      // Try invalid transition: cancelled -> shipped
      const badTransition = await call(`/api/admin/orders/${orderId}/status`, {
        method: 'PATCH',
        body: { status: 'shipped' }
      });
      assert.strictEqual(badTransition.status, 409, 'Invalid transition must be refused');
    });
  });
});