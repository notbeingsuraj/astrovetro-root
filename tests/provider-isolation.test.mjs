/* -------------------------------------------------------------------------
   Provider Isolation Tests
   -------------------------------------------------------------------------
   Tests that each webhook route always uses its own provider's verification
   and event parsing, regardless of the PAYMENT_PROVIDER environment variable.

   Uses dynamic imports to ensure environment variables are set before
   the payment module is loaded.
   ------------------------------------------------------------------------- */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';

/* Test secrets - use fixed test secrets for deterministic tests */
const CASH_FREE_CLIENT_SECRET = 'test_client_secret_12345';
const RAZORPAY_WEBHOOK_SECRET = 'test_webhook_secret_12345';
const RAZORPAY_KEY_SECRET = 'test_key_secret_12345';

/* Signature helpers */
function createCashfreeWebhookSignature(rawBody, timestamp, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}${rawBody}`)
    .digest('base64');
}

function createCashfreeCheckoutSignature(orderId, paymentId, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(`${orderId}${paymentId}`)
    .digest('hex');
}

function createRazorpayWebhookSignature(payload, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
}

function createRazorpayCheckoutSignature(orderId, paymentId, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
}

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

// Test payloads
const CASH_FREE_PAYLOAD = JSON.stringify({
  type: 'PAYMENT_SUCCESS',
  data: {
    payment: {
      order_id: 'order_cf_123',
      payment_id: 'pay_cf_456',
      payment_amount: 1000,
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
      order_id: 'order_cf_123',
      payment_id: 'pay_cf_456',
      payment_amount: 1000,
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

describe('Provider Isolation Tests', () => {
  
  describe('getProviderFromRoute', () => {
    it('returns cashfree for /webhooks/cashfree', () => {
      assert.strictEqual(getProviderFromRoute('/webhooks/cashfree'), 'cashfree');
    });

    it('returns cashfree for /api/webhooks/cashfree', () => {
      assert.strictEqual(getProviderFromRoute('/api/webhooks/cashfree'), 'cashfree');
    });

    it('returns razorpay for /webhooks/razorpay', () => {
      assert.strictEqual(getProviderFromRoute('/webhooks/razorpay'), 'razorpay');
    });

    it('returns razorpay for /api/webhooks/razorpay', () => {
      assert.strictEqual(getProviderFromRoute('/api/webhooks/razorpay'), 'razorpay');
    });

    it('returns null for unknown routes', () => {
      assert.strictEqual(getProviderFromRoute('/webhooks/unknown'), null);
      assert.strictEqual(getProviderFromRoute('/api/orders'), null);
    });
  });

  describe('Cashfree webhook verification with explicit provider', () => {
    it('accepts valid Cashfree signature when provider=cashfree', () => {
      const timestamp = '1705315800';
      const signature = createCashfreeWebhookSignature(CASH_FREE_PAYLOAD, timestamp, CASH_FREE_CLIENT_SECRET);
      const rawBody = Buffer.from(CASH_FREE_PAYLOAD, 'utf8');
      
      const result = verifyWebhookSignature(rawBody, signature, timestamp, 'cashfree');
      assert.strictEqual(result, true);
    });

    it('rejects invalid Cashfree signature when provider=cashfree', () => {
      const timestamp = '1705315800';
      const rawBody = Buffer.from(CASH_FREE_PAYLOAD, 'utf8');
      
      const result = verifyWebhookSignature(rawBody, 'invalid_signature', timestamp, 'cashfree');
      assert.strictEqual(result, false);
    });

    it('rejects Cashfree signature when provider=razorpay (wrong secret)', () => {
      const timestamp = '1705315800';
      const signature = createCashfreeWebhookSignature(CASH_FREE_PAYLOAD, timestamp, CASH_FREE_CLIENT_SECRET);
      const rawBody = Buffer.from(CASH_FREE_PAYLOAD, 'utf8');
      
      // Using razorpay provider with Cashfree signature should fail
      const result = verifyWebhookSignature(rawBody, signature, timestamp, 'razorpay');
      assert.strictEqual(result, false);
    });

    it('rejects Razorpay signature when provider=cashfree (wrong secret)', () => {
      const signature = createRazorpayWebhookSignature(RAZORPAY_PAYLOAD, RAZORPAY_WEBHOOK_SECRET);
      const rawBody = Buffer.from(RAZORPAY_PAYLOAD, 'utf8');
      
      // Using cashfree provider with Razorpay signature should fail
      const result = verifyWebhookSignature(rawBody, signature, '1705315800', 'cashfree');
      assert.strictEqual(result, false);
    });
  });

  describe('Razorpay webhook verification with explicit provider', () => {
    it('accepts valid Razorpay signature when provider=razorpay', () => {
      const signature = createRazorpayWebhookSignature(RAZORPAY_PAYLOAD, RAZORPAY_WEBHOOK_SECRET);
      const rawBody = Buffer.from(RAZORPAY_PAYLOAD, 'utf8');
      
      const result = verifyWebhookSignature(rawBody, signature, null, 'razorpay');
      assert.strictEqual(result, true);
    });

    it('rejects invalid Razorpay signature when provider=razorpay', () => {
      const rawBody = Buffer.from(RAZORPAY_PAYLOAD, 'utf8');
      
      const result = verifyWebhookSignature(rawBody, 'invalid_signature', null, 'razorpay');
      assert.strictEqual(result, false);
    });

    it('rejects Razorpay signature when provider=cashfree (wrong secret)', () => {
      const signature = createRazorpayWebhookSignature(RAZORPAY_PAYLOAD, RAZORPAY_WEBHOOK_SECRET);
      const rawBody = Buffer.from(RAZORPAY_PAYLOAD, 'utf8');
      
      // Using cashfree provider with Razorpay signature should fail
      const result = verifyWebhookSignature(rawBody, signature, '1705315800', 'cashfree');
      assert.strictEqual(result, false);
    });

    it('rejects Cashfree signature when provider=razorpay (wrong secret)', () => {
      const timestamp = '1705315800';
      const signature = createCashfreeWebhookSignature(CASH_FREE_PAYLOAD, timestamp, CASH_FREE_CLIENT_SECRET);
      const rawBody = Buffer.from(CASH_FREE_PAYLOAD, 'utf8');
      
      // Using razorpay provider with Cashfree signature should fail
      const result = verifyWebhookSignature(rawBody, signature, timestamp, 'razorpay');
      assert.strictEqual(result, false);
    });
  });

  describe('Event normalization', () => {
    
    it('normalizes Cashfree PAYMENT_SUCCESS event correctly', () => {
      const event = JSON.parse(CASH_FREE_PAYLOAD);
      const normalized = normalizeWebhookEvent(event, 'cashfree');
      
      assert.strictEqual(normalized.provider, 'cashfree');
      assert.strictEqual(normalized.providerOrderId, 'order_cf_123');
      assert.strictEqual(normalized.providerPaymentId, 'pay_cf_456');
      assert.strictEqual(normalized.paymentStatus, 'SUCCESS');
      assert.strictEqual(normalized.paymentAmount, 100000); // 1000 * 100 = 100000 paise
      assert.strictEqual(normalized.paymentCurrency, 'INR');
      assert.strictEqual(normalized.eventType, 'PAYMENT_SUCCESS');
    });

    it('normalizes Cashfree PAYMENT_FAILED event correctly', () => {
      const event = JSON.parse(CASH_FREE_FAILED_PAYLOAD);
      const normalized = normalizeWebhookEvent(event, 'cashfree');
      
      assert.strictEqual(normalized.provider, 'cashfree');
      assert.strictEqual(normalized.paymentStatus, 'FAILED');
    });

    it('normalizes Razorpay payment.captured event correctly', () => {
      const event = JSON.parse(RAZORPAY_PAYLOAD);
      const normalized = normalizeWebhookEvent(event, 'razorpay');
      
      assert.strictEqual(normalized.provider, 'razorpay');
      assert.strictEqual(normalized.providerOrderId, 'order_rzp_123');
      assert.strictEqual(normalized.providerPaymentId, 'pay_rzp_123');
      assert.strictEqual(normalized.paymentStatus, 'captured');
      assert.strictEqual(normalized.paymentAmount, 100000);
      assert.strictEqual(normalized.paymentCurrency, 'INR');
      assert.strictEqual(normalized.eventType, 'payment.captured');
    });

    it('normalizes Razorpay payment.failed event correctly', () => {
      const event = JSON.parse(RAZORPAY_FAILED_PAYLOAD);
      const normalized = normalizeWebhookEvent(event, 'razorpay');
      
      assert.strictEqual(normalized.provider, 'razorpay');
      assert.strictEqual(normalized.paymentStatus, 'failed');
    });

    it('returns null for unknown Cashfree event structure', () => {
      const unknownEvent = { type: 'UNKNOWN_EVENT' };
      const normalized = normalizeWebhookEvent(unknownEvent, 'cashfree');
      assert.strictEqual(normalized, null);
    });

    it('returns null for unknown Razorpay event structure', () => {
      const unknownEvent = { event: 'unknown.event' };
      const normalized = normalizeWebhookEvent(unknownEvent, 'razorpay');
      assert.strictEqual(normalized, null);
    });

    it('returns null when provider name is unknown', () => {
      const event = JSON.parse(CASH_FREE_PAYLOAD);
      const normalized = normalizeWebhookEvent(event, 'unknown');
      assert.strictEqual(normalized, null);
    });
  });

  describe('buildWebhookParams', () => {
    
    it('extracts Cashfree headers correctly', () => {
      const timestamp = '1705315800';
      const signature = 'test_signature';
      const rawBody = Buffer.from(CASH_FREE_PAYLOAD, 'utf8');
      
      const mockReq = {
        get: (header) => {
          if (header === 'x-webhook-signature') return signature;
          if (header === 'x-webhook-timestamp') return timestamp;
          return undefined;
        },
        body: rawBody
      };
      
      const params = buildWebhookParams(mockReq, 'cashfree');
      assert.strictEqual(params.signature, signature);
      assert.strictEqual(params.timestamp, timestamp);
      assert.deepStrictEqual(params.rawBody, rawBody);
    });

    it('extracts Razorpay headers correctly', () => {
      const signature = 'test_razorpay_signature';
      const rawBody = Buffer.from(RAZORPAY_PAYLOAD, 'utf8');
      
      const mockReq = {
        get: (header) => {
          if (header === 'x-razorpay-signature') return signature;
          return undefined;
        },
        body: rawBody
      };
      
      const params = buildWebhookParams(mockReq, 'razorpay');
      assert.strictEqual(params.signature, signature);
      assert.strictEqual(params.timestamp, null);
      assert.deepStrictEqual(params.rawBody, rawBody);
    });
  });

  describe('Cross-provider signature rejection', () => {
    
    it('Cashfree route rejects Razorpay-signed payload', () => {
      const signature = createRazorpayWebhookSignature(RAZORPAY_PAYLOAD, RAZORPAY_WEBHOOK_SECRET);
      const rawBody = Buffer.from(RAZORPAY_PAYLOAD, 'utf8');
      
      const result = verifyWebhookSignature(rawBody, signature, null, 'cashfree');
      assert.strictEqual(result, false);
    });

    it('Razorpay route rejects Cashfree-signed payload', () => {
      const timestamp = '1705315800';
      const signature = createCashfreeWebhookSignature(CASH_FREE_PAYLOAD, timestamp, CASH_FREE_CLIENT_SECRET);
      const rawBody = Buffer.from(CASH_FREE_PAYLOAD, 'utf8');
      
      const result = verifyWebhookSignature(rawBody, signature, timestamp, 'razorpay');
      assert.strictEqual(result, false);
    });
  });
});