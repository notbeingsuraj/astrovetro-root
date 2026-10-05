/* -------------------------------------------------------------------------
   Razorpay
   -------------------------------------------------------------------------

   Card and UPI payment, without ever touching card data.

   What this project never does, by design:

     - No card number, expiry, CVV or cardholder name is accepted by any
       endpoint. There is no field to put one in.
     - No such value is written to the database, a log, or an order.
     - Card entry happens inside Razorpay's own secure iframe, loaded from
       Razorpay's origin. Astro Vetro's servers and pages never see it.

   What the server is trusted with is only: an amount it computed itself, an
   order id it created, and a signature it can verify. That is enough to know a
   payment genuinely happened without the browser being able to assert it.

   ── Signature verification ───────────────────────────────────────────────
   Two different checks, and both are required:

   1. CHECKOUT: the browser returns razorpay_order_id and razorpay_payment_id
      after Razorpay's dialog closes. The signature is
      HMAC_SHA256(order_id + "|" + payment_id, key_secret). Recomputing it here
      with our own secret proves the pair came from a payment against an order
      *we* created — a browser cannot forge it without the secret, and cannot
      reuse it for a different order.

   2. WEBHOOK: Razorpay POSTs server-to-server on state changes. The signature
      is HMAC_SHA256(raw_request_body, webhook_secret). This requires the raw
      bytes, which is why server.js mounts the webhook route with express.raw()
      ahead of express.json() — re-serialising the body would change the bytes
      and the signature would never match.

   The webhook is the authoritative signal. The checkout callback is a
   convenience for the customer waiting on the page; if it never arrives
   (closed tab, dropped connection) the webhook still settles the order.
   ------------------------------------------------------------------------- */

import crypto from 'node:crypto';
import Razorpay from 'razorpay';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

let client = null;

/** Lazily constructed, and only when both credentials exist. */
function razorpay() {
  if (!env.paymentLive) {
    throw ApiError.conflict(
      'Card and UPI payment are not available right now. Please choose cash on delivery.'
    );
  }
  if (!client) {
    client = new Razorpay({ key_id: env.razorpay.keyId, key_secret: env.razorpay.keySecret });
  }
  return client;
}

export const isPaymentConfigured = () => env.paymentLive;

/**
 * Create a provider-side order for an amount the SERVER decided.
 *
 * `amountInPaise` must come from the pricing service. Nothing from the browser
 * reaches this argument: a client that could choose the amount could ask for a
 * one-rupee payment.
 */
export async function createProviderOrder({ amountInPaise, receipt, notes = {} }) {
  return razorpay().orders.create({
    amount: amountInPaise,
    currency: 'INR',
    receipt,
    notes,
    /* Razorpay's own checkout handles capture; nothing is auto-captured here so
       that fulfilment can confirm before money moves. */
    payment_capture: 1,
  });
}

/** Verify the signature the browser returns after Razorpay's dialog. */
export function verifyCheckoutSignature({ razorpayOrderId, razorpayPaymentId, razorpaySignature }) {
  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) return false;
  const expected = crypto
    .createHmac('sha256', env.razorpay.keySecret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex');
  /* Constant-time compare: a byte-by-byte comparison leaks the correct prefix
     to anyone able to time the response. */
  const a = Buffer.from(expected);
  const b = Buffer.from(String(razorpaySignature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Verify a webhook delivery. Requires the exact bytes Razorpay sent. */
export function verifyWebhookSignature(rawBody, signature) {
  if (!env.razorpay.webhookSecret || !signature) return false;
  const expected = crypto
    .createHmac('sha256', env.razorpay.webhookSecret)
    .update(rawBody)
    .digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Ask the provider what actually happened to a payment. Used to settle an
    order whose webhook has not arrived, rather than trusting the browser. */
export async function fetchPayment(paymentId) {
  try {
    return await razorpay().payments.fetch(paymentId);
  } catch {
    /* Not found at the provider, or not configured. Either way the caller must
       not treat the payment as confirmed. */
    return null;
  }
}

/** Read back a provider order. Its `amount` and `notes` are the provider's own
    record of what was asked for, and are what confirmation re-checks against —
    never the values the browser returned. */
export async function fetchProviderOrder(providerOrderId) {
  try {
    return await razorpay().orders.fetch(providerOrderId);
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
  if (payment.status !== 'captured' && payment.status !== 'authorized') return false;
  if (payment.currency !== 'INR') return false;
  if (typeof expectedAmountInPaise === 'number' && payment.amount !== expectedAmountInPaise) return false;
  return true;
}

/** Convert rupees to the paise Razorpay expects. */
export const toPaise = (rupees) => Math.round(Number(rupees) * 100);

/** The public key id, safe to send to the browser. The secret never is. */
export const publicKeyId = () => env.razorpay.keyId || null;
