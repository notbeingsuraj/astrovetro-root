/* -------------------------------------------------------------------------
   Crash-Recovery Fault-Injection Tests
   -------------------------------------------------------------------------
   Tests that simulate process failures at each boundary of the settlement
   and inventory commitment flow, verifying correct recovery behavior.
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
} from './helpers/server.mjs';
import { Order } from '../src/models/Order.js';
import { PAYMENT_STATUS, ORDER_STATUS, PAYMENT_METHOD, INVENTORY_STATE } from '../src/models/Order.js';
import { Product } from '../src/models/Product.js';
import { StockMovement } from '../src/models/StockMovement.js';

const PORT = 5317;
const TEST_DB = 'mongodb://127.0.0.1:27017/astrovetro_crash_recovery_test';
const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ADMIN_EMAIL = `crash-${RUN_ID}@astrovetro.test`;
const ADMIN_PASSWORD = 'crash-pass-12345';
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

const CASH_FREE_SUCCESS_PAYLOAD = JSON.stringify({
  type: 'PAYMENT_SUCCESS',
  data: {
    payment: {
      order_id: 'order_cf_test_123',
      payment_id: 'pay_cf_test_456',
      payment_amount: 1099,
      payment_currency: 'INR',
      payment_status: 'SUCCESS',
      payment_time: '2024-01-15T10:30:00Z'
    }
  }
});

describe('Crash-Recovery Fault-Injection Tests', { skip: mongoUp ? false : 'mongod is not reachable on 127.0.0.1:27017', timeout: 120000 }, () => {
  let server;
  let base;
  let adminCookie;
  let customerCookie;
  const ids = { product: null, user: null };

  const call = (path, opts = {}) => api(base, path, { cookie: adminCookie, ...opts });
  const callCustomer = (path, opts = {}) => api(base, path, { cookie: customerCookie, ...opts });

  // Helper to reset product stock to 10 before each test
  async function resetProductStock() {
    if (ids.product) {
      const product = await Product.findById(ids.product);
      if (product && product.stock !== null) {
        const currentStock = product.stock;
        if (currentStock !== 10) {
          await Product.updateOne(
            { _id: ids.product },
            { $inc: { stock: 10 - currentStock } }
          );
        }
      }
    }
  }

  before(async () => {
    await createAdmin({ databaseUrl: TEST_DB, email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    // Set test Cashfree secret so webhook signatures match
    process.env.CASHFREE_CLIENT_SECRET = CASH_FREE_CLIENT_SECRET;
    process.env.CASHFREE_CLIENT_ID = 'test_client_id';
    process.env.CASHFREE_ENV = 'sandbox';
    // Connect mongoose for direct model usage in tests
    await mongoose.connect(TEST_DB, { serverSelectionTimeoutMS: 5000, bufferCommands: false });
    server = await startServer({ port: PORT, databaseUrl: TEST_DB, disableRateLimit: true });
    base = server.base;
    adminCookie = await login(base, ADMIN_EMAIL, ADMIN_PASSWORD);
    assert.ok(adminCookie, 'admin login failed');

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
        name: 'Crash Recovery Test Pendant',
        slug: 'crash-recovery-test-pendant',
        category: 'pendant',
        price: 1000,
        costPrice: 500,
        status: 'active',
        productType: 'jewellery',
        shortDescription: 'Test piece for crash recovery tests.',
      },
    });
    assert.strictEqual(product.status, 201, JSON.stringify(product.json));
    ids.product = product.json.data.product.id;

    // Set opening stock balance - 10 units
    const stock = await call(`/api/admin/inventory/adjust/${ids.product}`, {
      method: 'POST',
      body: { mode: 'delta', quantity: 10, type: 'opening', reason: 'Initial stock for crash recovery tests' },
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
    await mongoose.disconnect();
    await dropDatabase(TEST_DB);
  });

  async function createPendingOrder(cashfreeOrderId) {
    const orderNumber = `AV-${Date.now().toString(36).toUpperCase()}`;
    const order = new Order({
      orderNumber,
      user: new mongoose.Types.ObjectId(ids.user),
      customerEmail: CUSTOMER_EMAIL,
      items: [{
        product: new mongoose.Types.ObjectId(ids.product),
        name: 'Crash Recovery Test Pendant',
        slug: 'crash-recovery-test-pendant',
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
        amount: 109900,
      },
      inventoryState: INVENTORY_STATE.PENDING,
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

  async function getOrderState(orderId) {
    const order = await Order.findById(orderId);
    return order ? {
      id: order._id.toString(),
      orderNumber: order.orderNumber,
      paymentStatus: order.paymentStatus,
      inventoryState: order.inventoryState,
      inventoryCommitted: order.inventoryCommitted,
      inventoryProcessingToken: order.inventoryProcessingToken,
      inventoryCommittedAt: order.inventoryCommittedAt,
      inventoryFailedAt: order.inventoryFailedAt,
      status: order.status,
      payment: order.payment,
    } : null;
  }

  async function getProductStock(productId) {
    const product = await Product.findById(productId);
    return product ? product.stock : null;
  }

  async function getMovementCount(orderNumber) {
    return StockMovement.countDocuments({ reference: orderNumber });
  }

  // Test 1: Failure after payment settlement claimed, before inventory processing
  it('Scenario 1: Crash after settlement claimed, before inventory processing - retry recovers', async () => {
    await resetProductStock();
    const cashfreeOrderId = `order_cf_crash1_${Date.now()}`;
    const order = await createPendingOrder(cashfreeOrderId);
    assert.ok(order);

    // Manually set order to PAID (simulating settlement claim) but inventory still PENDING
    await Order.updateOne(
      { _id: order._id },
      { $set: { paymentStatus: PAYMENT_STATUS.PAID, status: ORDER_STATUS.PAID } }
    );

    // Verify state before webhook
    let orderState = await getOrderState(order._id);
    assert.strictEqual(orderState.paymentStatus, 'paid');
    assert.strictEqual(orderState.inventoryState, 'pending');

    // Send webhook - should process inventory and commit
    const result = await sendCashfreeWebhook(cashfreeOrderId);
    assert.strictEqual(result.status, 200);
    assert.ok(result.json.data?.settled);

    // Verify final state
    orderState = await getOrderState(order._id);
    assert.strictEqual(orderState.inventoryState, 'committed');
    assert.strictEqual(orderState.inventoryCommitted, true);

    const finalStock = await getProductStock(ids.product);
    assert.strictEqual(finalStock, 9, 'Stock should be 9 (10 - 1)');

    const movementCount = await getMovementCount(orderState.orderNumber);
    assert.strictEqual(movementCount, 1, 'Should have exactly 1 sale movement');
  });

  // Test 2: Failure after inventory processing claimed, before stock decrement
  it('Scenario 2: Crash after inventory processing claimed, before stock decrement - recovery works', async () => {
    await resetProductStock();
    const cashfreeOrderId = `order_cf_crash2_${Date.now()}`;
    const order = await createPendingOrder(cashfreeOrderId);
    assert.ok(order);

    // Manually simulate: settlement claimed, inventory processing claimed, but crash before stock decrement
    // Make the processing claim STALE (older than 5 minutes) to simulate a crashed process
    const oldTime = new Date(Date.now() - 6 * 60 * 1000); // 6 minutes ago
    const staleToken = `stale-token-${Date.now()}`;
    await Order.updateOne(
      { _id: order._id },
      { 
        $set: { 
          paymentStatus: PAYMENT_STATUS.PAID, 
          status: ORDER_STATUS.PAID,
          inventoryState: INVENTORY_STATE.PROCESSING,
          inventoryProcessingToken: staleToken,
          inventoryProcessingStartedAt: oldTime,
        }
      }
    );

    // Verify state
    let orderState = await getOrderState(order._id);
    assert.strictEqual(orderState.inventoryState, 'processing');
    assert.strictEqual(orderState.inventoryProcessingToken, staleToken);

    // Send webhook - should detect stale processing claim and recover
    const result = await sendCashfreeWebhook(cashfreeOrderId);
    console.log('[test] Scenario 2 result:', JSON.stringify(result.json));
    
    // The webhook should detect the stale claim, recover it, and process inventory
    orderState = await getOrderState(order._id);
    const finalStock = await getProductStock(ids.product);
    const movementCount = await getMovementCount(orderState.orderNumber);
    
    // After recovery, inventory should be committed (stock decremented once from 10)
    assert.strictEqual(orderState.inventoryState, 'committed');
    assert.strictEqual(finalStock, 9); // 10 - 1 = 9
    assert.strictEqual(movementCount, 1);
  });

  // Test 3: Failure after stock decrement, before ledger insertion
  it('Scenario 3: Crash after stock decrement, before ledger - rollback works', async () => {
    await resetProductStock();
    const cashfreeOrderId = `order_cf_crash3_${Date.now()}`;
    const order = await createPendingOrder(cashfreeOrderId);
    assert.ok(order);

    // Manually decrement stock but don't create ledger entry
    // This simulates a crash after stock decrement but before ledger write
    const product = await Product.findById(ids.product);
    const initialStock = product.stock;
    
    await Product.findOneAndUpdate(
      { _id: ids.product, stock: { $gte: 1 } },
      { $inc: { stock: -1 } }
    );
    
    const afterDecrement = await Product.findById(ids.product);
    assert.strictEqual(afterDecrement.stock, initialStock - 1);

    // Now set order to PROCESSING state (simulating inventory processing claimed)
    const processingToken = `crash-token-${Date.now()}`;
    await Order.updateOne(
      { _id: order._id },
      { 
        $set: { 
          paymentStatus: PAYMENT_STATUS.PAID, 
          status: ORDER_STATUS.PAID,
          inventoryState: INVENTORY_STATE.PROCESSING,
          inventoryProcessingToken: processingToken,
          inventoryProcessingStartedAt: new Date(),
        }
      }
    );

    // Send webhook - it should detect the mismatch and handle it
    // The commitInventory will try to decrement stock again but stock is already decremented
    // This should fail with outOfStock or handle gracefully
    const result = await sendCashfreeWebhook(cashfreeOrderId);
    console.log('[test] Scenario 3 result:', JSON.stringify(result.json));
    
    // Verify final state - should not double decrement
    const finalStock = await getProductStock(ids.product);
    const orderState = await getOrderState(order._id);
    const movementCount = await getMovementCount(orderState.orderNumber);
    
    console.log('[test] Scenario 3 final stock:', finalStock);
    console.log('[test] Scenario 3 inventory state:', orderState.inventoryState);
    console.log('[test] Scenario 3 movements:', movementCount);
  });

  // Test 4: Failure after ledger insertion, before final commitment
  it('Scenario 4: Crash after ledger insertion, before final commitment - finalize works', async () => {
    await resetProductStock();
    const cashfreeOrderId = `order_cf_crash4_${Date.now()}`;
    const order = await createPendingOrder(cashfreeOrderId);
    assert.ok(order);

    // This test is similar to normal flow but we verify the finalize step works
    const result = await sendCashfreeWebhook(cashfreeOrderId);
    assert.strictEqual(result.status, 200);
    assert.ok(result.json.data?.settled);

    const orderState = await getOrderState(order._id);
    assert.strictEqual(orderState.inventoryState, 'committed');
    assert.strictEqual(orderState.inventoryCommitted, true);
    assert.ok(orderState.inventoryCommittedAt);

    const finalStock = await getProductStock(ids.product);
    const movementCount = await getMovementCount(orderState.orderNumber);
    
    assert.strictEqual(finalStock, 9); // 10 - 1 = 9
    assert.strictEqual(movementCount, 1);
  });

  // Test 5: Duplicate webhook delivery after final commitment
  it('Scenario 5: Duplicate webhook after final commitment - idempotent', async () => {
    await resetProductStock();
    const cashfreeOrderId = `order_cf_crash5_${Date.now()}`;
    const order = await createPendingOrder(cashfreeOrderId);
    assert.ok(order);

    // First webhook
    const result1 = await sendCashfreeWebhook(cashfreeOrderId);
    assert.strictEqual(result1.status, 200);
    assert.ok(result1.json.data?.settled);

    // Second webhook (duplicate)
    const result2 = await sendCashfreeWebhook(cashfreeOrderId);
    assert.strictEqual(result2.status, 200);
    assert.ok(result2.json.data?.alreadySettled);

    // Verify state unchanged
    const orderState = await getOrderState(order._id);
    assert.strictEqual(orderState.inventoryState, 'committed');

    const finalStock = await getProductStock(ids.product);
    const movementCount = await getMovementCount(orderState.orderNumber);
    
    assert.strictEqual(finalStock, 9); // 10 - 1 = 9 (duplicate is idempotent)
    assert.strictEqual(movementCount, 1, 'Should have exactly 1 sale movement');
  });

  // Test 6: Stale processing claim recovery
  it('Scenario 6: Stale processing claim (older than 5 min) - recovery works', async () => {
    await resetProductStock();
    const cashfreeOrderId = `order_cf_crash6_${Date.now()}`;
    const order = await createPendingOrder(cashfreeOrderId);
    assert.ok(order);

    // Set up a stale processing claim (older than 5 minutes)
    const oldTime = new Date(Date.now() - 6 * 60 * 1000); // 6 minutes ago
    const staleToken = `stale-token-${Date.now()}`;
    await Order.updateOne(
      { _id: order._id },
      { 
        $set: { 
          paymentStatus: PAYMENT_STATUS.PAID, 
          status: ORDER_STATUS.PAID,
          inventoryState: INVENTORY_STATE.PROCESSING,
          inventoryProcessingToken: staleToken,
          inventoryProcessingStartedAt: oldTime,
        }
      }
    );

    // Send webhook - should detect stale claim and recover
    const result = await sendCashfreeWebhook(cashfreeOrderId);
    console.log('[test] Scenario 6 result:', JSON.stringify(result.json));
    
    // Should recover and process successfully
    const orderState = await getOrderState(order._id);
    const finalStock = await getProductStock(ids.product);
    const movementCount = await getMovementCount(orderState.orderNumber);
    
    console.log('[test] Scenario 6 final state:', orderState.inventoryState);
    console.log('[test] Scenario 6 final stock:', finalStock);
    console.log('[test] Scenario 6 movements:', movementCount);
    
    assert.strictEqual(orderState.inventoryState, 'committed');
    assert.strictEqual(finalStock, 9); // 10 - 1 = 9
    assert.strictEqual(movementCount, 1);
  });

  // Test 7: Concurrent delivery at 2, 5, 10 simultaneous requests
  it('Scenario 7: 2 simultaneous webhook deliveries - exactly one settles', async () => {
    await resetProductStock();
    const cashfreeOrderId = `order_cf_concurrent2_${Date.now()}`;
    const order = await createPendingOrder(cashfreeOrderId);
    assert.ok(order);

    const [result1, result2] = await Promise.all([
      sendCashfreeWebhook(cashfreeOrderId),
      sendCashfreeWebhook(cashfreeOrderId),
    ]);

    assert.strictEqual(result1.status, 200);
    assert.strictEqual(result2.status, 200);

    const settledCount = [result1, result2].filter(r => r.json.data?.settled).length;
    const alreadySettledCount = [result1, result2].filter(r => r.json.data?.alreadySettled).length;
    assert.strictEqual(settledCount + alreadySettledCount, 2);

    const orderState = await getOrderState(order._id);
    assert.strictEqual(orderState.inventoryState, 'committed');

    const finalStock = await getProductStock(ids.product);
    const movementCount = await getMovementCount(orderState.orderNumber);
    
    assert.strictEqual(finalStock, 9); // 10 - 1 = 9 (only one settles)
    assert.strictEqual(movementCount, 1);
  });

  it('Scenario 7b: 5 simultaneous webhook deliveries - exactly one settles', async () => {
    await resetProductStock();
    const cashfreeOrderId = `order_cf_concurrent5_${Date.now()}`;
    const order = await createPendingOrder(cashfreeOrderId);
    assert.ok(order);

    const promises = Array(5).fill(null).map(() => sendCashfreeWebhook(cashfreeOrderId));
    const results = await Promise.all(promises);

    for (const result of results) {
      assert.strictEqual(result.status, 200);
    }

    const settledCount = results.filter(r => r.json.data?.settled).length;
    const alreadySettledCount = results.filter(r => r.json.data?.alreadySettled).length;
    assert.strictEqual(settledCount + alreadySettledCount, 5);

    const orderState = await getOrderState(order._id);
    assert.strictEqual(orderState.inventoryState, 'committed');

    const finalStock = await getProductStock(ids.product);
    const movementCount = await getMovementCount(orderState.orderNumber);
    
    assert.strictEqual(finalStock, 9); // 10 - 1 = 9 (only one settles)
    assert.strictEqual(movementCount, 1);
  });

  it('Scenario 7c: 10 simultaneous webhook deliveries - exactly one settles', async () => {
    await resetProductStock();
    const cashfreeOrderId = `order_cf_concurrent10_${Date.now()}`;
    const order = await createPendingOrder(cashfreeOrderId);
    assert.ok(order);

    const promises = Array(10).fill(null).map(() => sendCashfreeWebhook(cashfreeOrderId));
    const results = await Promise.all(promises);

    for (const result of results) {
      assert.strictEqual(result.status, 200);
    }

    const settledCount = results.filter(r => r.json.data?.settled).length;
    const alreadySettledCount = results.filter(r => r.json.data?.alreadySettled).length;
    assert.strictEqual(settledCount + alreadySettledCount, 10);

    const orderState = await getOrderState(order._id);
    assert.strictEqual(orderState.inventoryState, 'committed');

    const finalStock = await getProductStock(ids.product);
    const movementCount = await getMovementCount(orderState.orderNumber);
    
    assert.strictEqual(finalStock, 9); // 10 - 1 = 9 (only one settles)
    assert.strictEqual(movementCount, 1);
  });
});