/* -------------------------------------------------------------------------
   Provider Isolation Tests
   -------------------------------------------------------------------------
   Tests that each webhook route always uses its own provider's verification
   and event parsing, regardless of the PAYMENT_PROVIDER environment variable.
   ------------------------------------------------------------------------- */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { 
  verifyWebhookSignature, 
  normalizeWebhookEvent,
  getProviderFromRoute,
  buildWebhookParams
} from '../src/payments/index.js';

// Test secrets
const CASH_FREE_CLIENT_SECRET = 'test_client_secret_12345';
const RAZORPAY_WEBHOOK_SECRET = 'test_webhook_secret_12345';
const RAZORPAY_KEY_SECRET = 'test_key_secret_12345';

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
    .update(`${orderId}${paymentId}`)
    .digest('hex');
}

// Razorpay signature helpers
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
      
      assert.ok(normalized);
      assert.strictEqual(normalized.provider, 'cashfree');
      assert.strictEqual(normalized.providerOrderId, 'order_cf_123');
      assert.strictEqual(normalized.providerPaymentId, 'pay_cf_456');
      assert.strictEqual(normalized.paymentStatus, 'SUCCESS');
      assert.strictEqual(normalized.paymentAmount, 100000); // 1000 * 100
      assert.strictEqual(normalized.paymentCurrency, 'INR');
      assert.strictEqual(normalized.eventType, 'PAYMENT_SUCCESS');
    });

    it('normalizes Cashfree PAYMENT_FAILED event correctly', () => {
      const event = JSON.parse(CASH_FREE_FAILED_PAYLOAD);
      const normalized = normalizeWebhookEvent(event, 'cashfree');
      
      assert.ok(normalized);
      assert.strictEqual(normalized.paymentStatus, 'FAILED');
    });

    it('normalizes Razorpay payment.captured event correctly', () => {
      const event = JSON.parse(RAZORPAY_PAYLOAD);
      const normalized = normalizeWebhookEvent(event, 'razorpay');
      
      assert.ok(normalized);
      assert.strictEqual(normalized.provider, 'razorpay');
      assert.strictEqual(normalized.providerOrderId, 'order_rzp_123');
      assert.strictEqual(normalized.providerPaymentId, 'pay_rzp_123');
      assert.strictEqual(normalized.paymentStatus, 'captured');
      assert.strictEqual(normalized.paymentAmount, 100000); // already in paise
      assert.strictEqual(normalized.paymentCurrency, 'INR');
      assert.strictEqual(normalized.eventType, 'payment.captured');
    });

    it('normalizes Razorpay payment.failed event correctly', () => {
      const event = JSON.parse(RAZORPAY_FAILED_PAYLOAD);
      const normalized = normalizeWebhookEvent(event, 'razorpay');
      
      assert.ok(normalized);
      assert.strictEqual(normalized.paymentStatus, 'failed');
    });

    it('returns null for unknown Cashfree event structure', () => {
      const event = { type: 'UNKNOWN', data: {} };
      const normalized = normalizeWebhookEvent(event, 'cashfree');
      assert.strictEqual(normalized, null);
    });

    it('returns null for unknown Razorpay event structure', () => {
      const event = { event: 'unknown', payload: {} };
      const normalized = normalizeWebhookEvent(event, 'razorpay');
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
      const mockReq = {
        get: (header) => {
          if (header === 'x-webhook-signature') return 'test_sig';
          if (header === 'x-webhook-timestamp') return '1705315800';
          return undefined;
        },
        body: Buffer.from('{"test":true}')
      };
      
      const params = buildWebhookParams(mockReq, 'cashfree');
      assert.strictEqual(params.signature, 'test_sig');
      assert.strictEqual(params.timestamp, '1705315800');
      assert.ok(Buffer.isBuffer(params.rawBody));
    });

    it('extracts Razorpay headers correctly', () => {
      const mockReq = {
        get: (header) => {
          if (header === 'x-razorpay-signature') return 'test_sig';
          return undefined;
        },
        body: Buffer.from('{"test":true}')
      };
      
      const params = buildWebhookParams(mockReq, 'razorpay');
      assert.strictEqual(params.signature, 'test_sig');
      assert.strictEqual(params.timestamp, null);
      assert.ok(Buffer.isBuffer(params.rawBody));
    });
  });

  describe('Cross-provider signature rejection', () => {
    it('Cashfree route rejects Razorpay-signed payload', () => {
      // Simulate a request to Cashfree route with Razorpay-style signature
      const razorpaySig = createRazorpayWebhookSignature(RAZORPAY_PAYLOAD, RAZORPAY_WEBHOOK_SECRET);
      const rawBody = Buffer.from(RAZORPAY_PAYLOAD, 'utf8');
      
      // Cashfree verification uses client secret + timestamp + body in base64
      // Razorpay signature is hex without timestamp
      const result = verifyWebhookSignature(rawBody, razorpaySig, '1705315800', 'cashfree');
      assert.strictEqual(result, false);
    });

    it('Razorpay route rejects Cashfree-signed payload', () => {
      // Simulate a request to Razorpay route with Cashfree-style signature
      const timestamp = '1705315800';
      const cashfreeSig = createCashfreeWebhookSignature(CASH_FREE_PAYLOAD, timestamp, CASH_FREE_CLIENT_SECRET);
      const rawBody = Buffer.from(CASH_FREE_PAYLOAD, 'utf8');
      
      // Razorpay verification uses webhook secret + body in hex (no timestamp)
      const result = verifyWebhookSignature(rawBody, cashfreeSig, timestamp, 'razorpay');
      assert.strictEqual(result, false);
    });
  });
});