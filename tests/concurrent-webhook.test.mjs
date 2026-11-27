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

// Test constants
const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ADMIN_EMAIL = `concurrent-${RUN_ID}@astrovetro.test`;
const ADMIN_PASSWORD = 'concurrent-pass-12345';
const CUSTOMER_EMAIL = `customer-${RUN_ID}@astrovetro.test`;
const CUSTOMER_PASSWORD = 'customer-pass-12345';

const mongoUp = await tcpUp('127.0.0.1', 27017);

// Cashfree signature helpers
const CASH_FREE_CLIENT_SECRET = 'test_client_secret_12345';
const RAZORPAY_WEBHOOK_SECRET = 'test_webhook_secret_12345';
const RAZORPAY_KEY_SECRET = 'test_key_secret_12345';
const RAZORPAY_KEY_ID = 'test_key_id';

function createCashfreeWebhookSignature(rawBody, timestamp, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}${rawBody}`)
    .digest('base64');
}

function createCashfreeCheckoutSignature(orderId, paymentId, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
}

// Test payloads
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

const CASH_FREE_FAILED_PAYLOAD = JSON.stringify({
  type: 'PAYMENT_FAILED',
  data: {
    payment: {
      order_id: 'order_cf_test_123',
      payment_id: 'pay_cf_failed_123',
      payment_amount: 1099,
      payment_currency: 'INR',
      payment_status: 'FAILED',
      payment_time: '2024-01-15T10:30:00Z'
    }
  }
});

const RAZORPAY_PAYLOAD = JSON.stringify({
  event: 'payment.captured',
  payload: {
    payment: {
      entity: {
        id: 'pay_rzp_123',
        order_id: 'order_rzp_123',
        amount: 100000,
        currency: 'INR',
        status: 'captured',
        created_at: 1705315800
      }
    }
  }
});

const RAZORPAY_FAILED_PAYLOAD = JSON.stringify({
  event: 'payment.failed',
  payload: {
    payment: {
      entity: {
        id: 'pay_rzp_123',
        order_id: 'order_rzp_123',
        amount: 100000,
        currency: 'INR',
        status: 'failed',
        created_at: 1705315800
      }
    }
  }
});

// Test secrets
const CASH_FREE_CLIENT_SECRET = 'test_client_secret_12345';
const RAZORPAY_WEBHOOK_SECRET = 'test_webhook_secret_12345';
const RAZORPAY_KEY_SECRET = 'test_key_secret_12345';
const RAZORPAY_KEY_ID = 'test_key_id';

/* Set the environment variables BEFORE importing the payment module.
   This must happen before the module is loaded because the env module
   reads process.env at import time. */
process.env.CASHFREE_CLIENT_SECRET = CASH_FREE_CLIENT_SECRET;
process.env.CASHFREE_CLIENT_ID = 'test_client_id';
process.env.CASHFREE_ENV = 'sandbox';
process.env.RAZORPAY_KEY_SECRET = RAZORPAY_KEY_SECRET;
process.env.RAZORPAY_WEBHOOK_SECRET = RAZORPAY_WEBHOOK_SECRET;
process.env.RAZORPAY_KEY_ID = 'test_key_id';

/* Now dynamically import the payment module - env vars are set */
const { 
  verifyWebhookSignature, 
  normalizeWebhookEvent,
  getProviderFromRoute,
  buildWebhookParams
} = await import('../src/payments/index.js');


const mongoUp = await tcpUp('127.0.0.1', 27017);

// Test payloads
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

const CASH_FREE_FAILED_PAYLOAD = JSON.stringify({
  type: 'PAYMENT_FAILED',
  data: {
    payment: {
      order_id: 'order_cf_test_123',
      payment_id: 'pay_cf_failed_123',
      payment_amount: 1099,
      payment_currency: 'INR',
      payment_status: 'FAILED',
      payment_time: '2024-01-15T10:30:00Z'
    }
  }
});

const RAZORPAY_PAYLOAD = JSON.stringify({
  event: 'payment.captured',
  payload: {
    payment: {
      entity: {
        id: 'pay_rzp_123',
        order_id: 'order_rzp_123',
        amount: 100000,
        currency: 'INR',
        status: 'captured',
        created_at: 1705315800
      }
    }
  }
});

const RAZORPAY_FAILED_PAYLOAD = JSON.stringify({
  event: 'payment.failed',
  payload: {
    payment: {
      entity: {
        id: 'pay_rzp_123',
        order_id: 'order_rzp_123',
        amount: 100000,
        currency: 'INR',
        status: 'failed',
        created_at: 1705315800
      }
    }
  }
});

// Test secrets
const CASH_FREE_CLIENT_SECRET = 'test_client_secret_12345';
const RAZORPAY_WEBHOOK_SECRET = 'test_webhook_secret_12345';
const RAZORPAY_KEY_SECRET = 'test_key_secret_12345';
const RAZORPAY_KEY_ID = 'test_key_id';

/* Set the environment variables BEFORE importing the payment module.
   This must happen before the module is loaded because the env module
   reads process.env at import time. */
process.env.CASHFREE_CLIENT_SECRET = CASH_FREE_CLIENT_SECRET;
process.env.CASHFREE_CLIENT_ID = 'test_client_id';
process.env.CASHFREE_ENV = 'sandbox';
process.env.RAZORPAY_KEY_SECRET = RAZORPAY_KEY_SECRET;
process.env.RAZORPAY_WEBHOOK_SECRET = RAZORPAY_WEBHOOK_SECRET;
process.env.RAZORPAY_KEY_ID = 'test_key_id';

/* Now dynamically import the payment module - env vars are set */
const { 
  verifyWebhookSignature, 
  normalizeWebhookEvent,
  getProviderFromRoute,
  buildWebhookParams
} = await import('../src/payments/index.js');


// Cashfree signature helpers
function createCashfreeWebhookSignature(rawBody, timestamp, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}${rawBody}`)
    .digest('base64');
}

function createCashfreeCheckoutSignature(orderId, paymentId, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
}

// Test payloads
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

const CASH_FREE_FAILED_PAYLOAD = JSON.stringify({
  type: 'PAYMENT_FAILED',
  data: {
    payment: {
      order_id: 'order_cf_test_123',
      payment_id: 'pay_cf_failed_123',
      payment_amount: 1099,
      payment_currency: 'INR',
      payment_status: 'FAILED',
      payment_time: '2024-01-15T10:30:00Z'
    }
  }
});

const RAZORPAY_PAYLOAD = JSON.stringify({
  event: 'payment.captured',
  payload: {
    payment: {
      entity: {
        id: 'pay_rzp_123',
        order_id: 'order_rzp_123',
        amount: 100000,
        currency: 'INR',
        status: 'captured',
        created_at: 1705315800
      }
    }
  }
});

const RAZORPAY_FAILED_PAYLOAD = JSON.stringify({
  event: 'payment.failed',
  payload: {
    payment: {
      entity: {
        id: 'pay_rzp_123',
        order_id: 'order_rzp_123',
        amount: 100000,
        currency: 'INR',
        status: 'failed',
        created_at: 1705315800
      }
    }
  }
});

// Test secrets
const CASH_FREE_CLIENT_SECRET = 'test_client_secret_12345';
const RAZORPAY_WEBHOOK_SECRET = 'test_webhook_secret_12345';
const RAZORPAY_KEY_SECRET = 'test_key_secret_12345';
const RAZORPAY_KEY_ID = 'test_key_id';

/* Set the environment variables BEFORE importing the payment module.
   This must happen before the module is loaded because the env module
   reads process.env at import time. */
process.env.CASHFREE_CLIENT_SECRET = CASH_FREE_CLIENT_SECRET;
process.env.CASHFREE_CLIENT_ID = 'test_client_id';
process.env.CASHFREE_ENV = 'sandbox';
process.env.RAZORPAY_KEY_SECRET = RAZORPAY_KEY_SECRET;
process.env.RAZORPAY_WEBHOOK_SECRET = RAZORPAY_WEBHOOK_SECRET;
process.env.RAZORPAY_KEY_ID = 'test_key_id';

/* Now dynamically import the payment module - env vars are set */
const { 
  verifyWebhookSignature, 
  normalizeWebhookEvent,
  getProviderFromRoute,
  buildWebhookParams
} = await import('../src/payments/index.js');


const mongoUp = await tcpUp('127.0.0.1', 27017);

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
        payment_amount: 1099,
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
        payment_amount: 1099,
        payment_currency: 'INR',
        payment_status: 'FAILED',
        payment_time: '2024-01-15T10:30:00Z'
      }
    }
  });

  const RAZORPAY_PAYLOAD = JSON.stringify({
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: 'pay_rzp_123',
          order_id: 'order_rzp_123',
          amount: 100000,
          currency: 'INR',
          status: 'captured',
          created_at: 1705315800
        }
      }
    });
  });

  const RAZORPAY_FAILED_PAYLOAD = JSON.stringify({
    event: 'payment.failed',
    payload: {
      payment: {
        entity: {
          id: 'pay_rzp_123',
          order_id: 'order_rzp_123',
          amount: 100000,
          currency: 'INR',
          status: 'failed',
          created_at: 1705315800
        }
      }
    });
  });

  // Test secrets
  const CASH_FREE_CLIENT_SECRET = 'test_client_secret_12345';
  const RAZORPAY_WEBHOOK_SECRET = 'test_webhook_secret_12345';
  const RAZORPAY_KEY_SECRET = 'test_key_secret_12345';
  const RAZORPAY_KEY_ID = 'test_key_id';

  /* Set the environment variables BEFORE importing the payment module.
     This must happen before the module is loaded because the env module
     reads process.env at import time. */
  process.env.CASHFREE_CLIENT_SECRET = CASH_FREE_CLIENT_SECRET;
  process.env.CASHFREE_CLIENT_ID = 'test_client_id';
  process.env.CASHFREE_ENV = 'sandbox';
  process.env.RAZORPAY_KEY_SECRET = RAZORPAY_KEY_SECRET;
  process.env.RAZORPAY_WEBHOOK_SECRET = RAZORPAY_WEBHOOK_SECRET;
  process.env.RAZORPAY_KEY_ID = 'test_key_id';

  /* Now dynamically import the payment module - env vars are set */
  const { 
    verifyWebhookSignature, 
    normalizeWebhookEvent,
    getProviderFromRoute,
    buildWebhookParams
  } = await import('../src/payments/index.js');


  describe('Concurrent Webhook Settlement Tests', { timeout: 60000 }, () => {
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
          payment_amount: 1099,
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
          payment_amount: 1099,
          payment_currency: 'INR',
          payment_status: 'FAILED',
          payment_time: '2024-01-15T10:30:00Z'
        }
      }
    });

    const RAZORPAY_PAYLOAD = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_rzp_123',
            order_id: 'order_rzp_123',
            amount: 100000,
            currency: 'INR',
            status: 'captured',
            created_at: 1705315800
          }
        }
      });
    });

    const RAZORPAY_FAILED_PAYLOAD = JSON.stringify({
      event: 'payment.failed',
      payload: {
        payment: {
          entity: {
            id: 'pay_rzp_123',
            order_id: 'order_rzp_123',
            amount: 100000,
            currency: 'INR',
            status: 'failed',
            created_at: 1705315800
          }
        }
      });
    });

    // Test secrets
    const CASH_FREE_CLIENT_SECRET = 'test_client_secret_12345';
    const RAZORPAY_WEBHOOK_SECRET = 'test_webhook_secret_12345';
    const RAZORPAY_KEY_SECRET = 'test_key_secret_12345';
    const RAZORPAY_KEY_ID = 'test_key_id';

    /* Set the environment variables BEFORE importing the payment module.
       This must happen before the module is loaded because the env module
       reads process.env at import time. */
    process.env.CASHFREE_CLIENT_SECRET = CASH_FREE_CLIENT_SECRET;
    process.env.CASHFREE_CLIENT_ID = 'test_client_id';
    process.env.CASHFREE_ENV = 'sandbox';
    process.env.RAZORPAY_KEY_SECRET = RAZORPAY_KEY_SECRET;
    process.env.RAZORPAY_WEBHOOK_SECRET = RAZORPAY_WEBHOOK_SECRET;
    process.env.RAZORPAY_KEY_ID = 'test_key_id';

    /* Now dynamically import the payment module - env vars are set */
    const { 
      verifyWebhookSignature, 
      normalizeWebhookEvent,
      getProviderFromRoute,
      buildWebhookParams
    } = await import('../src/payments/index.js');


    describe('Concurrent Webhook Settlement Tests', { timeout: 60000 }, () => {
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
    });
  });
});