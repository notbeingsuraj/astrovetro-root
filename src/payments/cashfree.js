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
import { Cashfree, CFEnvironment } from 'cashfree-pg';
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
    const environment = env.cashfree.env === 'production' 
      ? CFEnvironment.PRODUCTION 
      : CFEnvironment.SANDBOX;
    // Use the API version from config, fallback to SDK default
    const apiVersion = env.cashfree.apiVersion || '2026-01-01';
    client = new Cashfree({
      environment,
      clientId: env.cashfree.clientId,
      clientSecret: env.cashfree.clientSecret,
      apiVersion: apiVersion
    });
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

  return cf.PGCreateOrder({
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
  }, {
    // Pass API version explicitly if supported
    xApiVersion: env.cashfree.apiVersion || '2026-01-01'
  });
}

/**
 * Verify the signature the browser returns after Cashfree's checkout.
 * Cashfree returns order_id, payment_id, and signature in the response.
 * 
 * According to Cashfree v2023-08-01 documentation:
 * The signature is HMAC_SHA256(order_id + payment_id, client_secret) in hex
 */
export function verifyCheckoutSignature({ orderId, paymentId, signature, paymentStatus }) {
  if (!orderId || !paymentId || !signature) return false;
  if (paymentStatus !== 'SUCCESS') return false;

  // Cashfree signature verification: HMAC_SHA256(order_id + payment_id, client_secret) in hex
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
 * Cashfree webhook signature: HMAC_SHA256(timestamp + raw_body, client_secret) in base64
 * 
 * According to Cashfree Payment Gateway documentation:
 * - Signature is HMAC-SHA256 of (timestamp + raw_body) using the client secret
 * - The signature is base64 encoded
 * - The timestamp is in the x-webhook-timestamp header
 * - The raw body must be used exactly as received (no JSON parsing/re-serialization)
 */
export function verifyWebhookSignature(rawBody, signature, timestamp) {
  if (!env.cashfree.clientSecret || !signature || !timestamp) return false;

  // Cashfree webhook signature format: timestamp + raw_body (base64 encoded HMAC-SHA256 with client secret)
  const expected = crypto
    .createHmac('sha256', env.cashfree.clientSecret)
    .update(`${timestamp}${rawBody.toString('utf8')}`)
    .digest('base64');

  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Ask the provider what actually happened to a payment. Used to settle an
 * order whose webhook has not arrived, rather than trusting the browser.
 * 
 * Uses PGOrderFetchPayments to get all payments for the order, then finds
 * the specific payment by payment_id.
 */
export async function fetchPayment(orderId, paymentId) {
  try {
    const cf = cashfree();
    const paymentsList = await cf.PGOrderFetchPayments(orderId);
    if (!paymentsList || !Array.isArray(paymentsList)) return null;
    return paymentsList.find(p => p.payment_id === paymentId) || null;
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
    return await cf.PGFetchOrder(orderId);
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