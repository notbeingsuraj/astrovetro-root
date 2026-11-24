/* -------------------------------------------------------------------------
   Cashfree Payments
   -------------------------------------------------------------------------

   Card, UPI, Netbanking and Wallet payments via Cashfree.

   What this project never does, by design:

     - No card number, expiry, CVV or cardholder name is accepted by any
       endpoint. There is no field to put one in.
     - No such value is written to the database, a log, or an order.
     - Card entry happens inside Cashfree's own secure checkout, loaded from
       Cashfree's origin. Astro Vetro's servers and pages never see it.

   What the server is trusted with is only: an amount it computed itself, an
   order id it created, and a signature it can verify. That is enough to know a
   payment genuinely happened without the browser being able to assert it.

   ── Signature verification ───────────────────────────────────────────────
   Two different checks, and both are required:

   1. CHECKOUT: the browser returns order_id, payment_id and signature
      after Cashfree's checkout completes. The signature is verified using
      the client secret and the response data.

   2. WEBHOOK: Cashfree POSTs server-to-server on state changes. The signature
      is HMAC_SHA256(raw_request_body + timestamp, client_secret). This requires
      the raw bytes and the timestamp header, which is why the webhook route is
      mounted with express.raw() ahead of express.json() — re-serialising the
      body would change the bytes and the signature would never match.

   The webhook is the authoritative signal. The checkout callback is a
   convenience for the customer waiting on the page; if it never arrives
   (closed tab, dropped connection) the webhook still settles the order.
   ------------------------------------------------------------------------- */

import crypto from 'node:crypto';
import { Cashfree } from 'cashfree-pg';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

let client = null;

/** Lazily constructed, and only when credentials exist. */
function cashfree() {
  if (!env.cashfreeConfigured) {
    throw ApiError.conflict(
      'Online payment is not available right now. Please choose cash on delivery.'
    );
  }
  if (!client) {
    client = new Cashfree(env.cashfree.env);
    client.XClientId = env.cashfree.clientId;
    client.XClientSecret = env.cashfree.clientSecret;
  }
  return client;
}

export const isPaymentConfigured = () => env.cashfreeConfigured;

/**
 * Create a provider-side order for an amount the SERVER decided.
 *
 * `amountInPaise` must come from the pricing service. Nothing from the browser
 * reaches this argument: a client that could choose the amount could ask for a
 * one-rupee payment.
 */
export async function createProviderOrder({ amountInPaise, receipt, notes = {}, customerDetails }) {
  const cf = cashfree();
  const orderAmount = amountInPaise / 100; // Cashfree expects amount in rupees, not paise

  return cf.PGCreateOrder('2023-08-01', {
    order_id: receipt,
    order_amount: orderAmount,
    order_currency: 'INR',
    order_note: notes.orderNote || 'Astro Vetro order',
    customer_details: customerDetails || {
      customer_id: notes.userId || 'guest',
      customer_email: notes.email || '',
      customer_phone: notes.phone || '',
    },
    order_meta: {
      return_url: notes.returnUrl || `${env.frontendUrl}/orders/${receipt}?payment=done`,
      notify_url: notes.notifyUrl || `${env.frontendUrl}/api/webhooks/cashfree`,
      payment_methods: 'cc,dc,nb,upi,wallet',
    },
  });
}

/**
 * Verify the signature the browser returns after Cashfree's checkout.
 * Cashfree returns order_id, payment_id, and signature in the response.
 */
export function verifyCheckoutSignature({ orderId, paymentId, signature, paymentStatus }) {
  if (!orderId || !paymentId || !signature) return false;
  if (paymentStatus !== 'SUCCESS') return false;

  // Cashfree v2023-08-01 signature verification
  // The signature is HMAC_SHA256(order_id + payment_id, client_secret)
  const expected = crypto
    .createHmac('sha256', env.cashfree.clientSecret)
    .update(`${orderId}${paymentId}`)
    .digest('hex');

  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Verify a webhook delivery. Requires the exact bytes Cashfree sent.
 * Cashfree webhook signature: HMAC_SHA256(raw_body + timestamp, client_secret)
 */
export function verifyWebhookSignature(rawBody, signature, timestamp) {
  if (!env.cashfree.webhookSecret || !signature || !timestamp) return false;

  // Cashfree webhook signature format: timestamp + raw_body
  const expected = crypto
    .createHmac('sha256', env.cashfree.webhookSecret)
    .update(`${timestamp}${rawBody.toString('utf8')}`)
    .digest('hex');

  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Ask the provider what actually happened to a payment. Used to settle an
 * order whose webhook has not arrived, rather than trusting the browser.
 */
export async function fetchPayment(paymentId) {
  try {
    const cf = cashfree();
    const response = await cf.PGOrderFetchPayments('2023-08-01', paymentId);
    return response.data;
  } catch {
    /* Not found at the provider, or not configured. Either way the caller must
       not treat the payment as confirmed. */
    return null;
  }
}

/**
 * Fetch order details from Cashfree to verify status, amount, etc.
 */
export async function fetchProviderOrder(orderId) {
  try {
    const cf = cashfree();
    const response = await cf.PGOrderFetchOrder('2023-08-01', orderId);
    return response.data;
  } catch {
    return null;
  }
}

/**
 * Decide whether a provider payment actually represents a successful payment.
 *
 * Checked against the provider's own record, not against anything the browser
 * sent. `amount` is compared because a real payment for a different, smaller
 * amount must not be allowed to mark a larger order as settled.
 */
export function isPaymentSuccessful(payment, expectedAmountInPaise) {
  if (!payment) return false;
  if (payment.payment_status !== 'SUCCESS') return false;
  if (payment.payment_currency !== 'INR') return false;
  if (typeof expectedAmountInPaise === 'number') {
    const paymentAmountInPaise = Math.round(Number(payment.payment_amount) * 100);
    if (paymentAmountInPaise !== expectedAmountInPaise) return false;
  }
  return true;
}

/** Convert rupees to the paise internal representation. */
export const toPaise = (rupees) => Math.round(Number(rupees) * 100);

/** The public client id, safe to send to the browser. The secret never is. */
export const publicClientId = () => env.cashfree.clientId || null;

/** Get the Cashfree environment (sandbox/production) for frontend SDK. */
export const getEnvironment = () => env.cashfree.env;