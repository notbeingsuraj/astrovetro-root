/* -------------------------------------------------------------------------
   Concurrent Webhook Settlement Tests
   -------------------------------------------------------------------------
   Tests that concurrent duplicate webhook deliveries cannot double-commit
   inventory or double-settle orders.
   
   These tests create orders directly in the database (bypassing checkout)
   to avoid needing real Cashfree credentials.
   ------------------------------------------------------------------------- */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import {
  startServer,
  api,
  login,
  createAdmin,
  dropDatabase,
  tcpUp,
  findAvailablePort,
} from './helpers/server.mjs';
import { Order } from '../src/models/Order.js';
import { PAYMENT_STATUS, ORDER_STATUS, PAYMENT_METHOD } from '../src/models/Order.js';
import { Product } from '../src/models/Product.js';

/** Connect mongoose to the test database and wait for ready. */
async function connectTestDB(databaseUrl) {
  if (mongoose.connection.readyState === 1) {
    // Already connected, check if it's the right database
    if (mongoose.connection.name === new URL(databaseUrl).pathname.slice(1)) {
      return;
    }
    await mongoose.disconnect();
  }
  console.log('[test] Connecting mongoose to:', databaseUrl);
  await mongoose.connect(databaseUrl, {
    serverSelectionTimeoutMS: 5000,
    bufferCommands: false,
  });
  console.log('[test] Mongoose connected, readyState:', mongoose.connection.readyState);
  // Wait for connection to be ready
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Mongoose connection timeout')), 10000);
    mongoose.connection.once('open', () => {
      clearTimeout(timeout);
      console.log('[test] Mongoose connection open');
      resolve();
    });
    mongoose.connection.once('error', (err) => {
      clearTimeout(timeout);
      console.log('[test] Mongoose connection error:', err);
      reject(err);
    });
    // Also resolve if already connected
    if (mongoose.connection.readyState === 1) {
      clearTimeout(timeout);
      console.log('[test] Mongoose already ready');
      resolve();
    }
  });
}

const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ADMIN_EMAIL = `concurrent-${RUN_ID}@astrovetro.test`;
const ADMIN_PASSWORD = 'concurrent-pass-12345';
const CUSTOMER_EMAIL = `customer-${RUN_ID}@astrovetro.test`;
const CUSTOMER_PASSWORD = 'customer-pass-12345';

const mongoUp = await tcpUp('127.0.0.1', 27017);

// Cashfree signature helpers
const CASH_FREE_CLIENT_SECRET = 'test_client_secret_12345';

function createCashfreeWebhookSignature(rawBody, timestamp, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}${rawBody}`)
    .digest('base64');
}

// Test payloads
const CASH_FREE_SUCCESS_PAYLOAD = JSON.stringify({
  type: 'PAYMENT_SUCCESS',
  data: {
    payment: {
      order_id: 'order_cf_test_123',
      payment_id: 'pay_cf_test_456',
      payment_amount: 1099, // Full order amount in rupees (including shipping)
      payment_currency: 'INR',
      payment_status: 'SUCCESS',
      payment_time: '2024-01-15T10:30:00Z'
    }
  }
});

const CASH_FREE_FAILED_PAYLOAD = JSON.stringify({
  type: 'PAYMENT_FAILED',
  data: {
    payment: {
      order_id: 'order_cf_test_123',
      payment_id: 'pay_cf_failed_123',
      payment_amount: 1099, // Full order amount in rupees
      payment_currency: 'INR',
      payment_status: 'FAILED',
      payment_time: '2024-01-15T10:30:00Z'
    }
  }
});

describe('Concurrent Webhook Settlement Tests', { skip: mongoUp ? false : 'mongod is not reachable on 127.0.0.1:27017', timeout: 60000 }, () => {
  let server;
  let base;
  let adminCookie;
  let customerCookie;
  let PORT;
  let TEST_DB;
  const ids = { product: null, user: null };

  const call = (path, opts = {}) => api(base, path, { cookie: adminCookie, ...opts });
  const callCustomer = (path, opts = {}) => api(base, path, { cookie: customerCookie, ...opts });

  before(async () => {
    // Use dynamic port to avoid conflicts
    PORT = await findAvailablePort(5316);
    TEST_DB = `mongodb://127.0.0.1:27017/astrovetro_concurrent_test_${Date.now()}`;
    
    const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ADMIN_EMAIL = `concurrent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@astrovetro.test`;
    const ADMIN_PASSWORD = 'concurrent-pass-12345';
    const CUSTOMER_EMAIL = `customer-${RUN_ID}@astrovetro.test`;
    const CUSTOMER_PASSWORD = 'customer-pass-12345';

    await createAdmin({ databaseUrl: TEST_DB, email: `admin-${RUN_ID}@astrovetro.test`, password: ADMIN_PASSWORD });
    // Set test Cashfree secret so webhook signatures match
    process.env.CASHFREE_CLIENT_SECRET = 'test_client_secret_12345';
    process.env.CASHFREE_CLIENT_ID = 'test_client_id';
    process.env.CASHFREE_ENV = 'sandbox';
    // Connect mongoose for direct model usage in tests
    await mongoose.connect(TEST_DB, { serverSelectionTimeoutMS: 5000, bufferCommands: false });
    server = await startServer({ port: 0, databaseUrl: TEST_DB, disableRateLimit: true });
    // Extract actual port from server
    const serverUrl = new URL(server.base);
    const actualPort = parseInt(serverUrl.port, 10);
    
    // We need to know the actual port for webhook signatures
    // The server's base URL will have the correct port
    base = server.base;
    console.log('[test] Server started at:', base);
    
    adminCookie = await login(base, `admin-${RUN_ID}@astrovetro.test`, ADMIN_PASSWORD);
    assert.ok(adminCookie, 'admin login failed');

    // Create a customer account
    const custReg = await api(base, '/api/auth/register', {
      method: 'POST',
      body: { email: CUSTOMER_EMAIL, password: CUSTOMER_PASSWORD, name: 'Test Customer' }
    });
    assert.strictEqual(custReg.status, 201, JSON.stringify(custReg.json));

    customerCookie = await login(base, CUSTOMER_EMAIL, CUSTOMER_PASSWORD);
    assert.ok(customerCookie, 'customer login failed');

    // Create a tracked product with stock
    const product = await call('/api/admin/products', {
      method: 'POST',
      body: {
        name: 'Concurrent Test Pendant',
        slug: 'concurrent-test-pendant',
        category: 'pendant',
        price: 1000,
        costPrice: 500,
        status: 'active',
        productType: 'jewellery',
        shortDescription: 'Test piece for concurrent webhook tests.',
      },
    });
    assert.strictEqual(product.status, 201, JSON.stringify(product.json));
    ids.product = product.json.data.product.id;

    // Set opening stock balance - 10 units
    const stock = await call(`/api/admin/inventory/adjust/${ids.product}`, {
      method: 'POST',
      body: { mode: 'delta', quantity: 10, type: 'opening', reason: 'Initial stock for concurrent tests' },
    });
    assert.strictEqual(stock.status, 200, JSON.stringify(stock.json));
    assert.strictEqual(stock.json.data.balanceAfter, 10);

    // Get user ID
    const userRes = await callCustomer('/api/me');
    assert.strictEqual(userRes.status, 200);
    ids.user = userRes.json.data.user.id;

    // Connect mongoose for direct database operations
    await mongoose.connect(TEST_DB, { serverSelectionTimeoutMS: 5000, bufferCommands: false });
  });

  after(async () => {
    await server?.stop();
    await dropDatabase(TEST_DB);
  });

  // Cashfree signature helpers
  const CASH_FREE_CLIENT_SECRET = 'test_client_secret_12345';

  function createCashfreeWebhookSignature(rawBody, timestamp, secret) {
    return crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}${rawBody}`)
      .digest('base64');
  }

  // Test payloads
  const CASH_FREE_SUCCESS_PAYLOAD = JSON.stringify({
    type: 'PAYMENT_SUCCESS',
    data: {
      payment: {
        order_id: 'order_cf_test_123',
        payment_id: 'pay_cf_test_456',
        payment_amount: 1099, // Full order amount in rupees (including shipping)
        payment_currency: 'INR',
        payment_status: 'SUCCESS',
        payment_time: '2024-01-15T10:30:00Z'
      }
    }
  });

  const CASH_FREE_FAILED_PAYLOAD = JSON.stringify({
    type: 'PAYMENT_FAILED',
    data: {
      payment: {
        order_id: 'order_cf_test_123',
        payment_id: 'pay_cf_failed_123',
        payment_amount: 1099, // Full order amount in rupees
        payment_currency: 'INR',
        payment_status: 'FAILED',
        payment_time: '2024-01-15T10:30:00Z'
      }
    }
  });

  describe('Concurrent Webhook Settlement Tests', { timeout: 60000 }, () => {
    let server;
    let base;
    let adminCookie;
    let customerCookie;
    const ids = { product: null, user: null };

    const call = (path, opts = {}) => api(base, path, { cookie: adminCookie, ...opts });
    const callCustomer = (path, opts = {}) => api(base, path, { cookie: customerCookie, ...opts });

    const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ADMIN_EMAIL = `concurrent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@astrovetro.test`;
    const ADMIN_PASSWORD = 'concurrent-pass-12345';
    const CUSTOMER_EMAIL = `customer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@astrovetro.test`;
    const CUSTOMER_PASSWORD = 'customer-pass-12345';

    // Cashfree signature helpers
    const CASH_FREE_CLIENT_SECRET = 'test_client_secret_12345';

    function createCashfreeWebhookSignature(rawBody, timestamp, secret) {
      return crypto
        .createHmac('sha256', secret)
        .update(`${timestamp}${rawBody}`)
        .digest('base64');
    }

    // Test payloads
    const CASH_FREE_SUCCESS_PAYLOAD = JSON.stringify({
      type: 'PAYMENT_SUCCESS',
      data: {
        payment: {
          order_id: 'order_cf_test_123',
          payment_id: 'pay_cf_test_456',
          payment_amount: 1099, // Full order amount in rupees (including shipping)
          payment_currency: 'INR',
          payment_status: 'SUCCESS',
          payment_time: '2024-01-15T10:30:00Z'
        }
      }
    });

    const CASH_FREE_FAILED_PAYLOAD = JSON.stringify({
      type: 'PAYMENT_FAILED',
      data: {
        payment: {
          order_id: 'order_cf_test_123',
          payment_id: 'pay_cf_failed_123',
          payment_amount: 1099, // Full order amount in rupees
          payment_currency: 'INR',
          payment_status: 'FAILED',
          payment_time: '2024-01-15T10:30:00Z'
        }
      }
    });

    before(async () => {
      // Use dynamic port to avoid conflicts
      const PORT = await findAvailablePort(5316);
      const TEST_DB = `mongodb://127.0.0.1:27017/astrovetro_concurrent_test_${Date.now()}`;
      const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const ADMIN_EMAIL = `concurrent-${RUN_ID}@astrovetro.test`;
      const ADMIN_PASSWORD = 'concurrent-pass-12345';
      const CUSTOMER_EMAIL = `customer-${RUN_ID}@astrovetro.test`;
      const CUSTOMER_PASSWORD = 'customer-pass-12345';

      await createAdmin({ databaseUrl: TEST_DB, email: `admin-${RUN_ID}@astrovetro.test`, password: 'concurrent-pass-12345' });
      // Set test Cashfree secret so webhook signatures match
      process.env.CASHFREE_CLIENT_SECRET = 'test_client_secret_12345';
      process.env.CASHFREE_CLIENT_ID = 'test_client_id';
      process.env.CASHFREE_ENV = 'sandbox';
      // Connect mongoose for direct model usage in tests
      await mongoose.connect(TEST_DB, { serverSelectionTimeoutMS: 5000, bufferCommands: false });
      server = await startServer({ port: 0, databaseUrl: TEST_DB, disableRateLimit: true });
      // The server's base URL will have the correct port
      base = server.base;
      console.log('[test] Server started at:', base);
      
      adminCookie = await login(base, `admin-${RUN_ID}@astrovetro.test`, 'concurrent-pass-12345');
      assert.ok(adminCookie, 'admin login failed');

      // Create a customer account
      const custReg = await api(base, '/api/auth/register', {
        method: 'POST',
        body: { email: CUSTOMER_EMAIL, password: CUSTOMER_PASSWORD, name: 'Test Customer' }
      });
      assert.strictEqual(custReg.status, 201, JSON.stringify(custReg.json));

      customerCookie = await login(base, CUSTOMER_EMAIL, CUSTOMER_PASSWORD);
      assert.ok(customerCookie, 'customer login failed');

      // Create a tracked product with stock
      const product = await call('/api/admin/products', {
        method: 'POST',
        body: {
          name: 'Concurrent Test Pendant',
          slug: 'concurrent-test-pendant',
          category: 'pendant',
          price: 1000,
          costPrice: 500,
          status: 'active',
          productType: 'jewellery',
          shortDescription: 'Test piece for concurrent webhook tests.',
        },
      });
      assert.strictEqual(product.status, 201, JSON.stringify(product.json));
      ids.product = product.json.data.product.id;

      // Set opening stock balance - 10 units
      const stock = await call(`/api/admin/inventory/adjust/${ids.product}`, {
        method: 'POST',
        body: { mode: 'delta', quantity: 10, type: 'opening', reason: 'Initial stock for concurrent tests' },
      });
      assert.strictEqual(stock.status, 200, JSON.stringify(stock.json));
      assert.strictEqual(stock.json.data.balanceAfter, 10);

      // Get user ID
      const userRes = await callCustomer('/api/me');
      assert.strictEqual(userRes.status, 200);
      ids.user = userRes.json.data.user.id;

      // Connect mongoose for direct database operations
      await mongoose.connect(TEST_DB, { serverSelectionTimeoutMS: 5000, bufferCommands: false });
    });

    after(async () => {
      await server?.stop();
      await dropDatabase(TEST_DB);
    });

    // Cashfree signature helpers
    const CASH_FREE_CLIENT_SECRET = 'test_client_secret_12345';

    function createCashfreeWebhookSignature(rawBody, timestamp, secret) {
      return crypto
        .createHmac('sha256', secret)
        .update(`${timestamp}${rawBody}`)
        .digest('base64');
    }

    // Test payloads
    const CASH_FREE_SUCCESS_PAYLOAD = JSON.stringify({
      type: 'PAYMENT_SUCCESS',
      data: {
        payment: {
          order_id: 'order_cf_test_123',
          payment_id: 'pay_cf_test_456',
          payment_amount: 1099, // Full order amount in rupees (including shipping)
          payment_currency: 'INR',
          payment_status: 'SUCCESS',
          payment_time: '2024-01-15T10:30:00Z'
        }
      }
    });

    const CASH_FREE_FAILED_PAYLOAD = JSON.stringify({
      type: 'PAYMENT_FAILED',
      data: {
        payment: {
          order_id: 'order_cf_test_123',
          payment_id: 'pay_cf_failed_123',
          payment_amount: 1099, // Full order amount in rupees
          payment_currency: 'INR',
          payment_status: 'FAILED',
          payment_time: '2024-01-15T10:30:00Z'
        }
      }
    });

    /**
     * Create a PENDING order directly in the database with Cashfree providerOrderId
     */
    async function createPendingOrder(cashfreeOrderId) {
      const orderNumber = `AV-${Date.now().toString(36).toUpperCase()}`;
      const order = new Order({
        orderNumber,
        user: new mongoose.Types.ObjectId(ids.user),
        customerEmail: CUSTOMER_EMAIL,
        items: [{
          product: new mongoose.Types.ObjectId(ids.product),
          name: 'Concurrent Test Pendant',
          slug: 'concurrent-test-pendant',
          image: null,
          unitPrice: 1000,
          quantity: 1,
          lineTotal: 1000,
        }],
        subtotal: 1000,
        discount: 0,
        shipping: 99,
        tax: 0,
        total: 1099,
        currency: 'INR',
        shippingAddress: {
          name: 'Test Customer',
          phone: '+91 90000 00000',
          line1: '123 Test Street',
          city: 'Test City',
          state: 'Test State',
          pincode: '110001',
          country: 'India',
        },
        status: ORDER_STATUS.PENDING,
        paymentStatus: PAYMENT_STATUS.PENDING,
        paymentMethod: PAYMENT_METHOD.CARD,
        payment: {
          provider: 'cashfree',
          providerOrderId: cashfreeOrderId,
          providerPaymentId: null,
          signature: null,
          paidAt: null,
          refundedAt: null,
          amount: 109900, // 1099 * 100 paise
        },
        inventoryCommitted: false,
        idempotencyKey: `idem-${Date.now()}`,
      });
      await order.save();
      return order;
    }

    async function sendCashfreeWebhook(cashfreeOrderId, timestamp = '1705315800', payload = CASH_FREE_SUCCESS_PAYLOAD) {
      const modifiedPayload = payload.replace('order_cf_test_123', cashfreeOrderId);
      const signature = createCashfreeWebhookSignature(modifiedPayload, timestamp, CASH_FREE_CLIENT_SECRET);

      return api(base, '/api/webhooks/cashfree', {
        method: 'POST',
        headers: {
          'x-webhook-signature': signature,
          'x-webhook-timestamp': timestamp,
          'content-type': 'application/json',
        },
        body: modifiedPayload,
        rawBody: true,
      });
    }

    async function sendCashfreeFailedWebhook(cashfreeOrderId, timestamp = '1705315800') {
      return sendCashfreeWebhook(cashfreeOrderId, timestamp, CASH_FREE_FAILED_PAYLOAD);
    }

    async function getOrderState(orderId) {
      const order = await Order.findById(orderId);
      if (!order) return null;
      return {
        id: order._id.toString(),
        orderNumber: order.orderNumber,
        paymentStatus: order.paymentStatus,
        inventoryCommitted: order.inventoryCommitted,
        status: order.status,
        payment: order.payment,
      };
    }

    async function getProductStock(productId) {
      const product = await call(`/api/admin/products/${productId}`);
      if (product.status !== 200) return null;
      return product.json.data.product.stock;
    }

    async function getMovementCount(orderNumber) {
      const movements = await call('/api/admin/inventory/movements');
      if (movements.status !== 200) return 0;
      return movements.json.data.items.filter(m => m.reference === orderNumber).length;
    }

    it('2 simultaneous Cashfree webhook deliveries settle order once', async () => {
      // Create a PENDING order directly
      const cashfreeOrderId = `order_cf_${Date.now()}`;
      const order = await createPendingOrder(cashfreeOrderId);
      assert.ok(order);

      // Send 2 concurrent webhook requests
      const [result1, result2] = await Promise.all([
        sendCashfreeWebhook(cashfreeOrderId),
        sendCashfreeWebhook(cashfreeOrderId),
      ]);

      // Both should return 200 (webhook accepted)
      assert.strictEqual(result1.status, 200, `First webhook failed: ${JSON.stringify(result1.json)}`);
      assert.strictEqual(result2.status, 200, `Second webhook failed: ${JSON.stringify(result2.json)}`);

      // One should be settled, one should be alreadySettled
      const settledCount = [result1, result2].filter(r => r.json.data?.settled).length;
      const alreadySettledCount = [result1, result2].filter(r => r.json.data?.alreadySettled).length;
      assert.strictEqual(settledCount + alreadySettledCount, 2, 'Both webhooks should be processed');

      // Verify final state
      const finalOrder = await getOrderState(order._id.toString());
      assert.strictEqual(finalOrder.paymentStatus, 'paid', 'Order should be paid');
      assert.strictEqual(finalOrder.inventoryCommitted, true, 'Inventory should be committed');
      assert.strictEqual(finalOrder.status, 'paid', 'Order status should be paid');

      const finalStock = await getProductStock(ids.product);
      assert.strictEqual(finalStock, 9, 'Stock should be 9 (10 - 1)');

      const movementCount = await getMovementCount(finalOrder.orderNumber);
      assert.strictEqual(movementCount, 1, 'Should have exactly 1 sale movement');
    });

    it('5 simultaneous Cashfree webhook deliveries settle order once', async () => {
      // Create a PENDING order directly
      const cashfreeOrderId = `order_cf_${Date.now()}`;
      const order = await createPendingOrder(cashfreeOrderId);
      assert.ok(order);

      // Send 5 concurrent webhook requests
      const promises = Array(5).fill(null).map(() => sendCashfreeWebhook(cashfreeOrderId));
      const results = await Promise.all(promises);

      // All should return 200
      for (const result of results) {
        assert.strictEqual(result.status, 200, `Webhook failed: ${JSON.stringify(result.json)}`);
      }

      // Verify final state
      const finalOrder = await getOrderState(order._id.toString());
      assert.strictEqual(finalOrder.paymentStatus, 'paid', 'Order should be paid');
      assert.strictEqual(finalOrder.inventoryCommitted, true, 'Inventory should be committed');

      const finalStock = await getProductStock(ids.product);
      assert.strictEqual(finalStock, 8, 'Stock should be 8 (9 - 1)');

      const movementCount = await getMovementCount(finalOrder.orderNumber);
      assert.strictEqual(movementCount, 1, 'Should have exactly 1 sale movement');
    });

    it('10 simultaneous Cashfree webhook deliveries settle order once', async () => {
      // Create a PENDING order directly
      const cashfreeOrderId = `order_cf_${Date.now()}`;
      const order = await createPendingOrder(cashfreeOrderId);
      assert.ok(order);

      // Send 10 concurrent webhook requests
      const promises = Array(10).fill(null).map(() => sendCashfreeWebhook(cashfreeOrderId));
      const results = await Promise.all(promises);

      // All should return 200
      for (const result of results) {
        assert.strictEqual(result.status, 200, `Webhook failed: ${JSON.stringify(result.json)}`);
      }

      // Verify final state
      const finalOrder = await getOrderState(order._id.toString());
      assert.strictEqual(finalOrder.paymentStatus, 'paid', 'Order should be paid');
      assert.strictEqual(finalOrder.inventoryCommitted, true, 'Inventory should be committed');

      const finalStock = await getProductStock(ids.product);
      assert.strictEqual(finalStock, 7, 'Stock should be 7 (8 - 1)');

      const movementCount = await getMovementCount(finalOrder.orderNumber);
      assert.strictEqual(movementCount, 1, 'Should have exactly 1 sale movement');
    });

    it('Duplicate delivery after successful settlement returns alreadySettled', async () => {
      // Create a PENDING order directly
      const cashfreeOrderId = `order_cf_${Date.now()}`;
      const order = await createPendingOrder(cashfreeOrderId);
      assert.ok(order);

      // First webhook - should settle
      const result1 = await sendCashfreeWebhook(cashfreeOrderId);
      assert.strictEqual(result1.status, 200);
      assert.ok(result1.json.data?.settled);

      // Second webhook (duplicate) - should return alreadySettled
      const result2 = await sendCashfreeWebhook(cashfreeOrderId);
      assert.strictEqual(result2.status, 200);
      assert.ok(result2.json.data?.alreadySettled, 'Second webhook should return alreadySettled');

      // Verify state unchanged
      const finalOrder = await getOrderState(order._id.toString());
      assert.strictEqual(finalOrder.paymentStatus, 'paid');
      assert.strictEqual(finalOrder.inventoryCommitted, true);

      const finalStock = await getProductStock(ids.product);
      assert.strictEqual(finalStock, 6, 'Stock should be 6 (7 - 1)');

      const movementCount = await getMovementCount(finalOrder.orderNumber);
      assert.strictEqual(movementCount, 1, 'Should have exactly 1 sale movement');
    });

    it('Webhook with different payment ID for same order is rejected', async () => {
      // Create a PENDING order directly
      const cashfreeOrderId = `order_cf_${Date.now()}`;
      const order = await createPendingOrder(cashfreeOrderId);
      assert.ok(order);

      // First webhook with correct payment ID - should settle
      const result1 = await sendCashfreeWebhook(cashfreeOrderId);
      assert.strictEqual(result1.status, 200);
      assert.ok(result1.json.data?.settled);

      // Second webhook with DIFFERENT payment ID - should be rejected (order already paid)
      const payloadDifferentPayment = CASH_FREE_SUCCESS_PAYLOAD
        .replace('order_cf_test_123', cashfreeOrderId)
        .replace('pay_cf_test_456', 'pay_cf_different_789');
      const signature2 = createCashfreeWebhookSignature(payloadDifferentPayment, '1705315800', CASH_FREE_CLIENT_SECRET);

      const result2 = await api(base, '/api/webhooks/cashfree', {
        method: 'POST',
        headers: {
          'x-webhook-signature': signature2,
          'x-webhook-timestamp': '1705315800',
          'content-type': 'application/json',
        },
        body: payloadDifferentPayment,
        rawBody: true,
      });

      // Should return 200 but with alreadySettled (order already paid)
      assert.strictEqual(result2.status, 200);
      assert.ok(result2.json.data?.alreadySettled || result2.json.data?.recorded);

      // Verify state unchanged - original payment ID preserved
      const finalOrder = await getOrderState(order._id.toString());
      assert.strictEqual(finalOrder.paymentStatus, 'paid');
      assert.strictEqual(finalOrder.payment.providerPaymentId, 'pay_cf_test_456', 'Original payment ID should be preserved');

      const finalStock = await getProductStock(ids.product);
      assert.strictEqual(finalStock, 5, 'Stock should be 5 (6 - 1)');

      const movementCount = await getMovementCount(finalOrder.orderNumber);
      assert.strictEqual(movementCount, 1, 'Should have exactly 1 sale movement');
    });

    it('Failed payment webhook does not commit inventory', async () => {
      // Create a PENDING order directly
      const cashfreeOrderId = `order_cf_${Date.now()}`;
      const order = await createPendingOrder(cashfreeOrderId);
      assert.ok(order);

      // Send FAILED payment webhook
      const result = await sendCashfreeFailedWebhook(cashfreeOrderId);

      assert.strictEqual(result.status, 200);
      assert.ok(result.json.data?.recorded === 'FAILED', 'Should record failed payment');

      // Verify order state
      const finalOrder = await getOrderState(order._id.toString());
      assert.strictEqual(finalOrder.paymentStatus, 'failed', 'Order payment status should be failed');
      assert.strictEqual(finalOrder.inventoryCommitted, false, 'Inventory should NOT be committed for failed payment');

      const finalStock = await getProductStock(ids.product);
      assert.strictEqual(finalStock, 5, 'Stock should remain 5');

      const movementCount = await getMovementCount(finalOrder.orderNumber);
      assert.strictEqual(movementCount, 0, 'Should have 0 sale movements');
    });

    it('Amount mismatch webhook does not settle order', async () => {
      // Create a PENDING order directly
      const cashfreeOrderId = `order_cf_${Date.now()}`;
      const order = await createPendingOrder(cashfreeOrderId);
      assert.ok(order);

      // Send webhook with WRONG amount (2000 instead of 1000)
      const mismatchPayload = JSON.stringify({
        type: 'PAYMENT_SUCCESS',
        data: {
          payment: {
            order_id: cashfreeOrderId,
            payment_id: 'pay_cf_mismatch_123',
            payment_amount: 2000, // Wrong amount - should be 1000
            payment_currency: 'INR',
            payment_status: 'SUCCESS',
            payment_time: '2024-01-15T10:30:00Z'
          }
        }
      });
      const mismatchSignature = createCashfreeWebhookSignature(mismatchPayload, '1705315800', CASH_FREE_CLIENT_SECRET);

      const result = await api(base, '/api/webhooks/cashfree', {
        method: 'POST',
        headers: {
          'x-webhook-signature': mismatchSignature,
          'x-webhook-timestamp': '1705315800',
          'content-type': 'application/json',
        },
        body: mismatchPayload,
        rawBody: true,
      });

      assert.strictEqual(result.status, 200);
      // Amount mismatch should be recorded but not settle
      assert.ok(result.json.data?.recorded === 'SUCCESS', 'Should record success but not settle due to amount mismatch');

      // Verify order state - should NOT be paid
      const finalOrder = await getOrderState(order._id.toString());
      assert.strictEqual(finalOrder.paymentStatus, 'pending', 'Order should remain pending due to amount mismatch');
      assert.strictEqual(finalOrder.inventoryCommitted, false, 'Inventory should NOT be committed');

      const finalStock = await getProductStock(ids.product);
      assert.strictEqual(finalStock, 5, 'Stock should remain 5');

      const movementCount = await getMovementCount(finalOrder.orderNumber);
      assert.strictEqual(movementCount, 0, 'Should have 0 sale movements');
    });

    it('Currency mismatch webhook does not settle order', async () => {
      // Create a PENDING order directly
      const cashfreeOrderId = `order_cf_${Date.now()}`;
      const order = await createPendingOrder(cashfreeOrderId);
      assert.ok(order);

      // Send webhook with WRONG currency (USD instead of INR)
      const mismatchPayload = JSON.stringify({
        type: 'PAYMENT_SUCCESS',
        data: {
          payment: {
            order_id: cashfreeOrderId,
            payment_id: 'pay_cf_currency_123',
            payment_amount: 1000,
            payment_currency: 'USD', // Wrong currency
            payment_status: 'SUCCESS',
            payment_time: '2024-01-15T10:30:00Z'
          }
        }
      });
      const mismatchSignature = createCashfreeWebhookSignature(mismatchPayload, '1705315800', CASH_FREE_CLIENT_SECRET);

      const result = await api(base, '/api/webhooks/cashfree', {
        method: 'POST',
        headers: {
          'x-webhook-signature': mismatchSignature,
          'x-webhook-timestamp': '1705315800',
          'content-type': 'application/json',
        },
        body: mismatchPayload,
        rawBody: true,
      });

      assert.strictEqual(result.status, 200);
      assert.ok(result.json.data?.recorded === 'SUCCESS', 'Should record success but not settle due to currency mismatch');

      // Verify order state - should NOT be paid
      const finalOrder = await getOrderState(order._id.toString());
      assert.strictEqual(finalOrder.paymentStatus, 'pending', 'Order should remain pending due to currency mismatch');
      assert.strictEqual(finalOrder.inventoryCommitted, false, 'Inventory should NOT be committed');

      const finalStock = await getProductStock(ids.product);
      assert.strictEqual(finalStock, 5, 'Stock should remain 5');

      const movementCount = await getMovementCount(finalOrder.orderNumber);
      assert.strictEqual(movementCount, 0, 'Should have 0 sale movements');
    });
  });
});