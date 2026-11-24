/* -------------------------------------------------------------------------
   Payment Provider Abstraction
   -------------------------------------------------------------------------

   Unified interface for all payment providers (Cashfree, Razorpay).
   The checkout controller uses this abstraction instead of provider-specific
   modules directly, keeping settlement logic DRY.
   ------------------------------------------------------------------------- */

import { env } from '../config/env.js';
import * as cashfree from './cashfree.js';
import * as razorpay from './razorpay.js';

/** Get the active payment provider module. */
function getProvider() {
  const provider = env.paymentProvider;
  if (provider === 'cashfree') return cashfree;
  if (provider === 'razorpay') return razorpay;
  // Default to cashfree if configured, otherwise razorpay
  if (env.cashfreeConfigured) return cashfree;
  if (env.paymentLive) return razorpay;
  return null;
}

/** Check if any online payment provider is configured. */
export const isPaymentConfigured = () => {
  const provider = getProvider();
  return provider ? provider.isPaymentConfigured() : false;
};

/** Create a provider-side order. */
export async function createProviderOrder({ amountInPaise, receipt, notes = {}, customerDetails }) {
  const provider = getProvider();
  if (!provider) {
    throw new Error('No payment provider configured');
  }
  return provider.createProviderOrder({ amountInPaise, receipt, notes, customerDetails });
}

/** Verify checkout signature from browser callback. */
export function verifyCheckoutSignature(data) {
  const provider = getProvider();
  if (!provider) return false;
  return provider.verifyCheckoutSignature(data);
}

/** Verify webhook signature. */
export function verifyWebhookSignature(rawBody, signature, timestamp) {
  const provider = getProvider();
  if (!provider) return false;
  return provider.verifyWebhookSignature(rawBody, signature, timestamp);
}

/** Fetch payment details from provider. */
export async function fetchPayment(paymentId) {
  const provider = getProvider();
  if (!provider) return null;
  return provider.fetchPayment(paymentId);
}

/** Fetch provider order details. */
export async function fetchProviderOrder(providerOrderId) {
  const provider = getProvider();
  if (!provider) return null;
  return provider.fetchProviderOrder(providerOrderId);
}

/** Check if payment is successful. */
export function isPaymentSuccessful(payment, expectedAmountInPaise) {
  const provider = getProvider();
  if (!provider) return false;
  return provider.isPaymentSuccessful(payment, expectedAmountInPaise);
}

/** Convert rupees to paise. */
export const toPaise = (rupees) => Math.round(Number(rupees) * 100);

/** Get public key/client ID for frontend. */
export const publicKeyId = () => {
  const provider = getProvider();
  return provider ? provider.publicKeyId() : null;
};

/** Get Cashfree environment for frontend SDK. */
export const getCashfreeEnvironment = () => {
  const provider = getProvider();
  return provider && provider.getEnvironment ? provider.getEnvironment() : 'sandbox';
};

/** Get the active provider name. */
export const getActiveProvider = () => env.paymentProvider;

/** Get provider-specific data for session response. */
export function getSessionData(providerOrder, amountInPaise, priced) {
  const provider = getProvider();
  if (!provider) throw new Error('No payment provider configured');

  const baseData = {
    amount: priced.total,
    amountInPaise,
    currency: priced.currency,
  };

  if (env.paymentProvider === 'cashfree') {
    return {
      ...baseData,
      cashfreeOrderId: providerOrder.order_id,
      paymentSessionId: providerOrder.payment_session_id,
      clientId: cashfree.publicClientId(),
      environment: cashfree.getEnvironment(),
    };
  }

  // Razorpay
  return {
    ...baseData,
    razorpayOrderId: providerOrder.id,
    keyId: razorpay.publicKeyId(),
  };
}

/** Build payment object for order document. */
export function buildPaymentObject(providerOrder, amountInPaise) {
  const provider = getProvider();
  if (!provider) throw new Error('No payment provider configured');

  if (env.paymentProvider === 'cashfree') {
    return {
      provider: 'cashfree',
      providerOrderId: providerOrder.order_id,
      amount: amountInPaise,
    };
  }

  // Razorpay
  return {
    provider: 'razorpay',
    providerOrderId: providerOrder.id,
    amount: amountInPaise,
  };
}

/** Build payment update object for confirmation. */
export function buildPaymentUpdateObject(body) {
  if (env.paymentProvider === 'cashfree') {
    return {
      providerPaymentId: body.paymentId,
      signature: body.signature,
      paidAt: new Date(),
    };
  }

  // Razorpay
  return {
    providerPaymentId: body.razorpayPaymentId,
    signature: body.razorpaySignature,
    paidAt: new Date(),
  };
}

/** Build webhook verification params. */
export function buildWebhookParams(req) {
  if (env.paymentProvider === 'cashfree') {
    return {
      signature: req.get('x-webhook-signature'),
      timestamp: req.get('x-webhook-timestamp'),
      rawBody: Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {})),
    };
  }

  // Razorpay
  return {
    signature: req.get('x-razorpay-signature'),
    timestamp: null,
    rawBody: Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {})),
  };
}