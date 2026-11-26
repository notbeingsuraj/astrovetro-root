/* -------------------------------------------------------------------------
   Order controller — checkout, order history, order detail
   -------------------------------------------------------------------------

   The rules this file exists to enforce:

   1. THE CLIENT NEVER SAYS WHAT ANYTHING COSTS.
      Totals are recomputed from the Product collection on every call. There is
      no code path that accepts a price, a subtotal, a shipping figure or a
      total from a request body, so there is nothing for a customer to tamper
      with.

   2. THE CART IS RE-READ AND RE-CHECKED AT THE MOMENT OF SALE.
      Stock validated when a piece was added is stale by the time checkout
      finishes — someone else may have bought the last one. So the full cart is
      loaded, re-priced and re-checked against live stock inside the order
      path, not trusted from an earlier response.

   3. PAYMENT IS CONFIRMED AGAINST THE PROVIDER, NEVER AGAINST THE BROWSER.
      `paymentStatus: "paid"` from a request body is ignored entirely. The
      checkout signature is recomputed with our secret, and the payment record
      is fetched from the provider to confirm it was captured for the right amount.

   4. AN ORDER SNAPSHOTS WHAT WAS BOUGHT.
      Name, slug, image and unit price are copied onto the order. Repricing a
      product later cannot rewrite a past purchase.

   5. PLACE ORDER IS IDEMPOTENT.
      The client sends an Idempotency-Key. A unique index on (user, key) means a
      double click or a retried request returns the order that already exists
      instead of creating a second one.

   Guest checkout is not offered: the cart is server-side and therefore belongs
   to an account, and this store had no prior guest-purchase policy to preserve.
   Requiring sign-in keeps one rule rather than two parallel ones.
   ------------------------------------------------------------------------- */

import { z } from 'zod';
import { env } from '../config/env.js';
import { Order, ORDER_STATUS, PAYMENT_STATUS, PAYMENT_METHOD, canTransition, SHIPPED_STATUSES, INVENTORY_STATE } from '../models/Order.js';
import { Product } from '../models/Product.js';

import { StockMovement } from '../models/StockMovement.js';
import { Cart } from '../models/Cart.js';
import { Address } from '../models/Address.js';
import { Shipment } from '../models/Shipment.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { pageMeta } from '../utils/responses.js';
import { priceCart, CURRENCY } from '../services/pricing.js';
import { addressFields } from '../middleware/validate.js';
import * as cartService from '../services/cartService.js';
import * as payments from '../payments/index.js';
import { DUPLICATE_KEY } from '../middleware/errorHandler.js';

const MAX_QTY = 99;

/* Sequential, human-quotable order numbers: AV-1048.
   Derived from the highest existing number rather than a counter collection, so
   it survives a fresh database without a migration and matches the reference
   pages' format without copying their sample values. */
const ORDER_START = 1048;
const NUMBER_ATTEMPTS = 5;

async function highestOrderNumber() {
  const rows = await Order.find({}, { orderNumber: 1, _id: 0 }).lean();

  let highest = 0;
  for (const { orderNumber } of rows) {
    const match = /(\d+)$/.exec(orderNumber || '');
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return highest || ORDER_START - 1;
}

/**
 * Reserve a free order number, or return null if the attempts were exhausted.
 * A null result is a 409, never a silent overwrite of someone else's order.
 */
async function reserveOrderNumber() {
  for (let attempt = 0; attempt < NUMBER_ATTEMPTS; attempt += 1) {
    const candidate = `AV-${Math.round(await highestOrderNumber()) + 1}`;
    const clash = await Order.exists({ orderNumber: candidate });
    if (!clash) return candidate;
  }
  return null;
}

/**
 * Load the caller's cart with products and re-price it from live data.
 * Throws rather than returning a partial result: checkout must not proceed on a
 * bag it could not fully validate.
 */
async function loadValidatedCart(userId) {
  const cart = await Cart.findOne({ user: userId }).populate('items.product');
  if (!cart || cart.items.length === 0) throw ApiError.badRequest('Your bag is empty.');

  const lines = cart.items
    .filter((i) => i.product)
    .map((i) => ({ product: i.product, quantity: i.quantity }));

  if (lines.length === 0) throw ApiError.badRequest('Your bag is empty.');

  const priced = priceCart(lines);

  /* Any stock or availability problem blocks the sale. Reporting it as an issue
     and pressing on would create an order for something that cannot be sent. */
  const blocking = priced.issues.filter((i) => i.type === 'stock' || i.type === 'unavailable');
  if (blocking.length) {
    throw ApiError.outOfStock(blocking.map((i) => i.message).join(' '));
  }

  return { cart, priced };
}

/**
 * Resolve and freeze the delivery address.
 *
 * A saved address id is looked up scoped to this user, so passing someone
 * else's id yields nothing rather than their address. When the customer types an
 * address instead, it is validated to the same rules as a saved one and stored
 * on the order as a snapshot.
 */
async function resolveAddress(userId, body) {
  if (body.addressId) {
    const address = await Address.findOne({ _id: body.addressId, user: userId });
    if (!address) throw ApiError.notFound('We could not find that saved address.');
    return {
      name: address.name,
      phone: address.phone,
      line1: address.line1,
      line2: address.line2,
      city: address.city,
      state: address.state,
      pincode: address.pincode,
      country: address.country,
    };
  }

  const parsed = z
    .object({
      name: addressFields.name(z),
      phone: addressFields.phone(z),
      line1: addressFields.line1(z),
      line2: addressFields.line2(z),
      city: addressFields.city(z),
      state: addressFields.state(z),
      pincode: addressFields.pincode(z),
      country: addressFields.country(z),
    })
    .parse(body.address ?? {});

  return parsed;
}

const checkoutSchema = z.object({
  paymentMethod: z.enum(Object.values(PAYMENT_METHOD)),
  /* Optional here on purpose: an order belongs to a signed-in account, and that
     account already has a verified email. Making the client resend it would
     only create a chance to order something under a different address than the
     one they signed in with. Resolved to the account email when absent. */
  contactEmail: z.string().trim().toLowerCase().email('Enter a valid email address.').optional(),
  contactPhone: z
    .string()
    .trim()
    .regex(/^[0-9+\-\s()]{7,20}$/, 'Enter a contact number we can reach you on.')
    .optional()
    .default(''),
  addressId: z.string().optional(),
  address: z.record(z.string(), z.unknown()).optional(),
  /* The customer's own retry token. Sent as a header in practice; accepted in
     the body too so a plain form post still works. */
  idempotencyKey: z.string().trim().min(8).max(120).optional(),
});

/** An order that already exists for this retry key. */
async function findByIdempotency(userId, key) {
  if (!key) return null;
  return Order.findOne({ user: userId, idempotencyKey: key });
}

/**
 * Commit inventory for an order.
 * Uses a guarded atomic update rather than read-then-write, so two customers
 * buying the last piece cannot both succeed. Products with `stock: null` are
 * untracked and are skipped entirely — decrementing them would turn "not
 * tracked" into a negative number.
 *
 * `inventoryCommitted` on the order is the idempotency guard for a retried
 * webhook. This function sets the flag after successful commit.
 * For webhook path, the atomic claim is made BEFORE calling via claimInventoryCommitment().
 */
async function commitInventory(order) {
  /* Each line that we manage to decrement is remembered with the balance we
     moved it from, so a failure further down the loop can be unwound rather
     than leaving the stock partly reduced for an order that never placed. */
  const applied = [];

  try {
    for (const item of order.items) {
      if (!item.product) continue;
      const product = await Product.findById(item.product);
      if (!product || product.stock == null) continue;

      /* Guarded atomic decrement, identical to before, but `new: false` gives
         us the balance from before the change so the ledger entry can state a
         true before/after. */
      const beforeDoc = await Product.findOneAndUpdate(
        { _id: item.product, stock: { $gte: item.quantity } },
        { $inc: { stock: -item.quantity } },
        { new: false }
      );

      /* Lost the race: someone bought the last units while this order was being
         placed. The order is left uncommitted and marked for attention rather
         than being silently marked as sold. */
      if (!beforeDoc) {
        throw ApiError.outOfStock(`${item.name} sold out while the order was being placed.`);
      }

      applied.push({ product: item.product, quantity: item.quantity });
      await writeSaleMovement({
        product: beforeDoc,
        quantity: item.quantity,
        balanceBefore: beforeDoc.stock,
        balanceAfter: beforeDoc.stock - item.quantity,
        order,
      });
    }
  } catch (err) {
    /* Undo the lines that did commit, in reverse, so stock and ledger both
       return to their pre-order state. The compensation itself writes a
       compensating movement rather than editing history. */
    for (const change of applied.reverse()) {
      await Product.updateOne({ _id: change.product }, { $inc: { stock: change.quantity } }).catch(() => {});
    }
    throw err;
  }

  order.inventoryCommitted = true;
  await order.save();
}

/* Record the ledger entry for one committed sale line. Kept separate so the
   numbers written here are the exact ones the decrement above produced. */
async function writeSaleMovement({ product, quantity, balanceBefore, balanceAfter, order }) {
  await StockMovement.create({
    product: product._id,
    sku: product.sku,
    productName: product.name,
    type: 'sale',
    quantity: -quantity,
    balanceBefore,
    balanceAfter,
    reason: `Sold on order ${order.orderNumber}`,
    reference: order.orderNumber,
    actor: { userId: order.user, email: 'checkout', role: 'customer' },
  }).catch(async (err) => {
    /* The balance already moved. A missing ledger entry would make the two
       disagree, so put the units back and let the checkout fail loudly rather
       than record a sale we cannot account for. */
    await Product.updateOne({ _id: product._id }, { $inc: { stock: quantity } });
    throw err;
  });
}

/** Build the order document from a priced cart. Snapshots everything. */
function buildOrder({ orderNumber, user, email, phone, address, priced, paymentMethod }) {
  return new Order({
    orderNumber,
    user: user._id,
    customerEmail: email,
    items: priced.lines.map((l) => ({
      product: l.product._id,
      name: l.name,
      slug: l.slug,
      image: l.image,
      unitPrice: l.unitPrice,
      quantity: l.quantity,
      lineTotal: l.lineTotal,
    })),
    subtotal: priced.subtotal,
    discount: priced.discount,
    shipping: priced.shipping,
    tax: priced.tax,
    total: priced.total,
    currency: priced.currency,
    shippingAddress: { ...address, phone: address.phone || phone },
    status: ORDER_STATUS.PENDING,
    paymentStatus: PAYMENT_STATUS.PENDING,
    paymentMethod,
  });
}

/* ── Checkout: cash on delivery ────────────────────────────────────────────
   No provider involved, so the order is created immediately and stock is
   committed. If anything fails the cart is left intact.
   ------------------------------------------------------------------------ */
export const checkoutCod = asyncHandler(async (req, res) => {
  const body = checkoutSchema.parse(req.body);
  const idempotencyKey = req.get('idempotency-key') || body.idempotencyKey;

  const existing = await findByIdempotency(req.user._id, idempotencyKey);
  if (existing) return res.json({ success: true, data: { order: existing.toPublic(), replayed: true } });

  const { priced } = await loadValidatedCart(req.user._id);
  const address = await resolveAddress(req.user._id, body);

  const orderNumber = await reserveOrderNumber();
  if (!orderNumber) {
    throw ApiError.conflict('We could not allocate an order number. Please try again in a moment.');
  }
  const order = buildOrder({
    orderNumber,
    user: req.user,
    email: body.contactEmail || req.user.email,
    phone: body.contactPhone || req.user.phone || '',
    address,
    priced,
    paymentMethod: PAYMENT_METHOD.COD,
  });
  order.idempotencyKey = idempotencyKey || null;

  await order.save();

  // Use new crash-safe inventory commitment state machine
  const processingClaim = await claimInventoryProcessing(order._id);
  if (!processingClaim) {
    throw ApiError.conflict('Inventory commitment already in progress');
  }

  const processingToken = processingClaim.inventoryProcessingToken;

  try {
    await commitInventory(order);
    await cartService.clearCart(req.user._id);
  } catch (err) {
    await releaseInventoryProcessingClaim(order._id, processingToken).catch(() => {});
    throw err;
  }

  // Finalize inventory commitment
  const finalized = await finalizeInventoryCommitment(order._id, processingToken);
  if (!finalized) {
    console.error(`[checkoutCod] Failed to finalize inventory commitment for order ${order.orderNumber}`);
    throw new Error('Inventory finalization failed');
  }

  // Reload order for response
  const finalOrder = await Order.findById(order._id);
  return res.status(201).json({ success: true, data: { order: finalOrder.toPublic() } });
});

/* ── Checkout: card or UPI, via active payment provider ──────────────────────
   The order document is written here, in PENDING, and the provider order is
   attached to it. Confirmation then settles that same document rather than
   building a second one.

   Two reasons for creating it up front rather than only after payment:

      - The order number the customer is shown at checkout is the number the order
        actually carries. Building it later would mean the number could change
        between showing and confirming.
      - The delivery address is stored on the order itself. Passing it through the
        provider's `notes` instead would mean serialising an address into a field
        the provider caps at 256 characters.

   A pending card order is not a purchase, so `listOrders` filters it out of
   history. It exists so an abandoned checkout is visible to us, not to the
   customer.
   ------------------------------------------------------------------------ */
export const checkoutSession = asyncHandler(async (req, res) => {
  const body = checkoutSchema.parse(req.body);

  if (!payments.isPaymentConfigured()) {
    /* Honest refusal rather than a checkout page that renders a real-looking
       card form which can never complete. */
    throw ApiError.conflict(
      'Card and UPI payment are not available right now. Please choose cash on delivery.'
    );
  }

  const idempotencyKey = req.get('idempotency-key') || body.idempotencyKey;
  const existing = await findByIdempotency(req.user._id, idempotencyKey);
  if (existing) {
    return res.json({
      success: true,
      data: {
        order: existing.toPublic(),
        replayed: true,
        alreadyPaid: existing.paymentStatus === PAYMENT_STATUS.PAID,
      },
    });
  }

  /* Everything is validated and priced now, so the customer is told about a sold
     out piece before a payment dialog opens rather than after. */
  const { priced } = await loadValidatedCart(req.user._id);
  const address = await resolveAddress(req.user._id, body);

  const orderNumber = await reserveOrderNumber();
  if (!orderNumber) {
    throw ApiError.conflict('We could not allocate an order number. Please try again in a moment.');
  }
  const amountInPaise = payments.toPaise(priced.total);

  const order = buildOrder({
    orderNumber,
    user: req.user,
    email: body.contactEmail || req.user.email,
    phone: body.contactPhone || req.user.phone || '',
    address,
    priced,
    paymentMethod: body.paymentMethod === PAYMENT_METHOD.UPI ? PAYMENT_METHOD.UPI : PAYMENT_METHOD.CARD,
  });
  order.idempotencyKey = idempotencyKey || null;

  const customerDetails = {
    customer_id: req.user._id.toString(),
    customer_email: body.contactEmail || req.user.email,
    customer_phone: body.contactPhone || req.user.phone || '',
  };

  const providerOrder = await payments.createProviderOrder({
    amountInPaise,
    receipt: orderNumber,
    notes: {
      orderNumber,
      userId: req.user._id.toString(),
      amount: String(amountInPaise),
      currency: CURRENCY,
      email: body.contactEmail || req.user.email,
      orderNote: `Astro Vetro order ${orderNumber}`,
      returnUrl: `${env.frontendUrl}/orders/${orderNumber}?payment=done`,
      notifyUrl: `${env.frontendUrl}/api/webhooks/${payments.getActiveProvider()}`,
    },
    customerDetails,
  });

  /* Attached before the save, so the document and the provider agree from the
     moment either is visible. */
  order.payment = payments.buildPaymentObject(providerOrder, amountInPaise);
  await order.save();

  const sessionData = payments.getSessionData(providerOrder, amountInPaise, priced);

  return res.status(201).json({
    success: true,
    data: {
      orderNumber,
      ...sessionData,
      idempotencyKey: idempotencyKey || null,
    },
  });
});

/* ── Checkout: confirm a card/UPI payment ─────────────────────────────────
   The step that decides whether an order is paid.
   ------------------------------------------------------------------------ */
export const confirmPayment = asyncHandler(async (req, res) => {
  const activeProvider = payments.getActiveProvider();
  
  // Provider-specific schema
  let schema;
  if (activeProvider === 'cashfree') {
    schema = z.object({
      orderId: z.string().min(1),
      paymentId: z.string().min(1),
      signature: z.string().min(1),
      paymentStatus: z.string().min(1),
      idempotencyKey: z.string().trim().min(8).max(120).optional(),
    });
  } else {
    schema = z.object({
      razorpayOrderId: z.string().min(1),
      razorpayPaymentId: z.string().min(1),
      razorpaySignature: z.string().min(1),
      idempotencyKey: z.string().trim().min(8).max(120).optional(),
    });
  }
  
  const body = schema.parse(req.body);
  const idempotencyKey = req.get('idempotency-key') || body.idempotencyKey;

  /* Replay of a request that already succeeded. Returns the original order
     rather than charging again or creating a second one. */
  const replay = await findByIdempotency(req.user._id, idempotencyKey);
  if (replay) return res.json({ success: true, data: { order: replay.toPublic(), replayed: true } });

  /* 1. The signature. Proves this payment response belongs to an order we
        created. A browser cannot produce it without the secret. */
  let signatureValid = false;
  let providerOrderId = '';
  let providerPaymentId = '';
  
  if (activeProvider === 'cashfree') {
    signatureValid = payments.verifyCheckoutSignature({
      orderId: body.orderId,
      paymentId: body.paymentId,
      signature: body.signature,
      paymentStatus: body.paymentStatus,
    });
    providerOrderId = body.orderId;
    providerPaymentId = body.paymentId;
  } else {
    signatureValid = payments.verifyCheckoutSignature(body);
    providerOrderId = body.razorpayOrderId;
    providerPaymentId = body.razorpayPaymentId;
  }
  
  if (!signatureValid) {
    throw ApiError.badRequest('We could not verify that payment.');
  }

  /* 2. Our own order, found by the provider order id we issued. Scoped to this
        account, so a payment raised against someone else's checkout cannot be
        confirmed here even with a valid signature. */
  const order = await Order.findOne({
    'payment.providerOrderId': providerOrderId,
    user: req.user._id,
  });
  if (!order) throw ApiError.notFound('We could not find that payment order.');

  /* 3. The provider's record of the payment. The signature proved the response
        is genuine; this proves the money actually moved. */
  const payment = await payments.fetchPayment(providerOrderId, providerPaymentId);
  if (!payments.isPaymentSuccessful(payment, order.payment?.amount)) {
    throw ApiError.badRequest('That payment has not completed.');
  }

  /* 4. Guard against a confirmed-but-already-settled order, which is what a
        duplicate submit looks like when no idempotency key was sent. */
  if (order.paymentStatus === PAYMENT_STATUS.PAID) {
    return res.json({ success: true, data: { order: order.toPublic(), replayed: true } });
  }

  /* 5. The bag is re-read and re-priced one last time. If it changed while the
        dialog was open, the customer authorised a different amount, so this is
        refused rather than quietly charging the new total. */
  const { priced } = await loadValidatedCart(req.user._id);
  if (payments.toPaise(priced.total) !== order.payment?.amount) {
    throw ApiError.conflict('Your bag changed while the payment was open. Please review it and try again.');
  }

  order.paymentStatus = PAYMENT_STATUS.PAID;
  order.payment = {
    ...order.payment,
    ...payments.buildPaymentUpdateObject(body),
  };
  if (canTransition(order.status, ORDER_STATUS.PAID)) order.status = ORDER_STATUS.PAID;
  await order.save();

  // Use new crash-safe inventory commitment state machine
  const processingClaim = await claimInventoryProcessing(order._id);
  if (!processingClaim) {
    // Inventory already committed or another process is handling it
    const existing = await Order.findById(order._id);
    if (existing?.inventoryState === INVENTORY_STATE.COMMITTED) {
      await cartService.clearCart(req.user._id);
      return res.json({ success: true, data: { order: existing.toPublic(), replayed: true } });
    }
    throw ApiError.conflict('Inventory commitment already in progress');
  }

  const processingToken = processingClaim.inventoryProcessingToken;

  try {
    await commitInventory(order);
    await cartService.clearCart(req.user._id);
  } catch (err) {
    await releaseInventoryProcessingClaim(order._id, processingToken).catch(() => {});
    // Rollback payment status
    await Order.updateOne(
      { _id: order._id },
      { $set: { paymentStatus: PAYMENT_STATUS.PENDING, 'payment.providerPaymentId': null, 'payment.paidAt': null, 'payment.amount': null } }
    ).catch(() => {});
    throw err;
  }

  // Finalize inventory commitment
  const finalized = await finalizeInventoryCommitment(order._id, processingToken);
  if (!finalized) {
    console.error(`[confirmPayment] Failed to finalize inventory commitment for order ${order.orderNumber}`);
    throw new Error('Inventory finalization failed');
  }

  // Reload order for response
  const finalOrder = await Order.findById(order._id);
  return res.json({ success: true, data: { order: finalOrder.toPublic() } });
});

/* ── Webhook: the authoritative settlement path ─────────────────────────────
   Registered before express.json() so the bytes are intact. No session, no CSRF
   check: the request is authenticated by its signature instead, which is the
   only thing the provider sends.
   ------------------------------------------------------------------------ */

// Provider-specific webhook handlers
async function handleCashfreeWebhook(req, res) {
  const { signature, timestamp, rawBody } = payments.buildWebhookParams(req, 'cashfree');

  if (!payments.verifyWebhookSignature(rawBody, signature, timestamp, 'cashfree')) {
    return res.status(400).json({ success: false, message: 'Invalid signature.' });
  }

  const event = JSON.parse(rawBody.toString('utf8'));
  const normalized = payments.normalizeWebhookEvent(event, 'cashfree');
  if (!normalized) return res.json({ success: true, data: { ignored: true } });

  return handleNormalizedWebhook(req, res, normalized);
}

async function handleRazorpayWebhook(req, res) {
  const { signature, timestamp, rawBody } = payments.buildWebhookParams(req, 'razorpay');

  if (!payments.verifyWebhookSignature(rawBody, signature, timestamp, 'razorpay')) {
    return res.status(400).json({ success: false, message: 'Invalid signature.' });
  }

  const event = JSON.parse(rawBody.toString('utf8'));
  const normalized = payments.normalizeWebhookEvent(event, 'razorpay');
  if (!normalized) return res.json({ success: true, data: { ignored: true } });

  return handleNormalizedWebhook(req, res, normalized);
}

/**
 * Atomically claim settlement for an order.
 * Only succeeds if the order exists, matches the providerOrderId, and is not already PAID.
 * Returns the updated order document, or null if no claim was made (already settled or not found).
 */
async function claimSettlement(providerOrderId, providerPaymentId, paymentAmount, paymentTime) {
  return Order.findOneAndUpdate(
    {
      'payment.providerOrderId': providerOrderId,
      paymentStatus: { $ne: PAYMENT_STATUS.PAID },
    },
    {
      $set: {
        paymentStatus: PAYMENT_STATUS.PAID,
        'payment.providerPaymentId': providerPaymentId,
        'payment.paidAt': new Date(paymentTime),
        'payment.amount': paymentAmount,
      },
    },
    { new: true }
  );
}



/**
 * Atomically claim inventory processing for an order.
 * Only succeeds if inventoryState is PENDING.
 * Uses a unique processing token to identify the claim owner.
 * Returns the updated order document with the processing token, or null if not claimed.
 */
async function claimInventoryProcessing(orderId) {
  const processingToken = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return Order.findOneAndUpdate(
    { _id: orderId, inventoryState: INVENTORY_STATE.PENDING },
    { 
      $set: { 
        inventoryState: INVENTORY_STATE.PROCESSING,
        inventoryProcessingToken: processingToken,
        inventoryProcessingStartedAt: new Date(),
      }
    },
    { new: true }
  );
}

/**
 * Verify that the caller owns the inventory processing claim.
 * Only the claim owner (matching token) can finalize or release the claim.
 */
async function verifyInventoryProcessingClaim(orderId, processingToken) {
  const order = await Order.findById(orderId);
  if (!order) return false;
  return order.inventoryState === INVENTORY_STATE.PROCESSING && 
         order.inventoryProcessingToken === processingToken;
}

/**
 * Finalize inventory commitment - mark as COMMITTED.
 * Only succeeds if the caller owns the processing claim.
 */
async function finalizeInventoryCommitment(orderId, processingToken) {
  return Order.findOneAndUpdate(
    { 
      _id: orderId, 
      inventoryState: INVENTORY_STATE.PROCESSING,
      inventoryProcessingToken: processingToken,
    },
    { 
      $set: { 
        inventoryState: INVENTORY_STATE.COMMITTED,
        inventoryCommitted: true,  // Legacy compatibility
        inventoryProcessingToken: null,
        inventoryProcessingStartedAt: null,
        inventoryCommittedAt: new Date(),
      }
    },
    { new: true }
  );
}

/**
 * Release inventory processing claim (rollback) - mark as FAILED.
 * Only succeeds if the caller owns the processing claim.
 * Used when inventory commit fails and we need to allow retry.
 */
async function releaseInventoryProcessingClaim(orderId, processingToken) {
  return Order.findOneAndUpdate(
    { 
      _id: orderId, 
      inventoryState: INVENTORY_STATE.PROCESSING,
      inventoryProcessingToken: processingToken,
    },
    { 
      $set: { 
        inventoryState: INVENTORY_STATE.FAILED,
        inventoryProcessingToken: null,
        inventoryProcessingStartedAt: null,
        inventoryFailedAt: new Date(),
      }
    },
    { new: true }
  );
}

/**
 * Recovery function: Check for stale PROCESSING claims and reset them to PENDING.
 * A claim is considered stale if it has been in PROCESSING for more than 5 minutes
 * without being finalized. This allows stuck orders to be retried.
 * Call this periodically or on webhook retry.
 */
async function recoverStaleInventoryClaims() {
  const staleThreshold = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes
  return Order.updateMany(
    { 
      inventoryState: INVENTORY_STATE.PROCESSING,
      inventoryProcessingStartedAt: { $lt: staleThreshold },
    },
    { 
      $set: { 
        inventoryState: INVENTORY_STATE.PENDING,
        inventoryProcessingToken: null,
        inventoryProcessingStartedAt: null,
      }
    }
  );
}

/**
 * Get the inventory state of an order for monitoring/debugging.
 */
async function getInventoryState(orderId) {
  const order = await Order.findById(orderId, 'inventoryState inventoryProcessingToken inventoryProcessingStartedAt inventoryCommittedAt inventoryFailedAt');
  return order ? {
    state: order.inventoryState || INVENTORY_STATE.PENDING,
    processingToken: order.inventoryProcessingToken,
    startedAt: order.inventoryProcessingStartedAt,
    committedAt: order.inventoryCommittedAt,
    failedAt: order.inventoryFailedAt,
  } : null;
}

/**
 * Release inventory commitment claim (rollback).
 * Called when inventory commit fails after the claim was made.
 * DEPRECATED: Use releaseInventoryProcessingClaim instead.
 */
async function releaseInventoryCommitment(orderId) {
  return Order.updateOne(
    { _id: orderId },
    { $set: { inventoryCommitted: false, inventoryState: INVENTORY_STATE.PENDING } }
  );
}

/**
 * Rollback settlement claim (paymentStatus back to PENDING, clear payment details).
 * Called when inventory commit fails and we need to fully revert.
 */
async function rollbackSettlementClaim(orderId) {
  return Order.updateOne(
    { _id: orderId },
    {
      $set: {
        paymentStatus: PAYMENT_STATUS.PENDING,
        'payment.providerPaymentId': null,
        'payment.paidAt': null,
        'payment.amount': null,
        inventoryCommitted: false,
        inventoryState: INVENTORY_STATE.PENDING,
        inventoryProcessingToken: null,
        inventoryProcessingStartedAt: null,
      },
    }
  );
}

/** Common settlement logic for normalized webhook events. */
async function handleNormalizedWebhook(req, res, normalized) {
  const { providerOrderId, providerPaymentId, paymentStatus, paymentAmount, paymentCurrency, paymentTime, eventType } = normalized;

  // Validate amount matches (in paise) - do this before any DB writes
  const orderForAmountCheck = await Order.findOne({ 'payment.providerOrderId': providerOrderId });
  if (!orderForAmountCheck) return res.json({ success: true, data: { ignored: 'no matching order' } });

  const expectedAmount = orderForAmountCheck.payment?.amount;
  const amountMatches = expectedAmount !== undefined && paymentAmount === expectedAmount;
  const currencyMatches = paymentCurrency === 'INR';

  const succeeded = paymentStatus === 'SUCCESS' && amountMatches && currencyMatches;

  if (!succeeded) {
    if (paymentStatus === 'FAILED') {
      // For failed payments, we don't need atomic claim - just update if not already paid
      const order = await Order.findOne({ 'payment.providerOrderId': providerOrderId });
      if (order && order.paymentStatus !== PAYMENT_STATUS.PAID) {
        order.paymentStatus = PAYMENT_STATUS.FAILED;
        if (canTransition(order.status, ORDER_STATUS.PAYMENT_FAILED)) {
          order.status = ORDER_STATUS.PAYMENT_FAILED;
        }
        await order.save();
      }
    }
    return res.json({ success: true, data: { recorded: paymentStatus } });
  }

  // STEP 1: Atomically claim settlement (only one webhook can succeed)
  let order = await claimSettlement(providerOrderId, providerPaymentId, paymentAmount, paymentTime);

  if (!order) {
    // Settlement already claimed by another webhook delivery
    // Check if inventory still needs to be processed
    const existing = await Order.findOne({ 'payment.providerOrderId': providerOrderId });
    if (existing?.paymentStatus === PAYMENT_STATUS.PAID) {
      // Check inventory state - if not committed, we still need to process it
      if (existing.inventoryState === INVENTORY_STATE.COMMITTED) {
        await cartService.clearCart(existing.user);
        return res.json({ success: true, data: { alreadySettled: true, orderNumber: existing.orderNumber } });
      }
      // Inventory not yet committed - we need to process it
      // Fall through to inventory processing with the existing order
      order = existing;
    } else {
      return res.json({ success: true, data: { ignored: 'no matching order or already settled' } });
    }
  } else {
    // Transition order status if allowed (for newly claimed settlement)
    if (canTransition(order.status, ORDER_STATUS.PAID)) {
      order.status = ORDER_STATUS.PAID;
      await order.save();
    }
  }

  // STEP 2: Atomically claim inventory PROCESSING (not committed yet)
  let processingClaim = await claimInventoryProcessing(order._id);

  if (!processingClaim) {
    // Check if already committed
    const existing = await Order.findById(order._id);
    if (existing?.inventoryState === INVENTORY_STATE.COMMITTED) {
      await cartService.clearCart(order.user);
      return res.json({ success: true, data: { alreadySettled: true, orderNumber: existing.orderNumber } });
    }
    // Check for stale processing claim and attempt recovery
    const state = await getInventoryState(order._id);
    if (state?.state === INVENTORY_STATE.PROCESSING) {
      // Check if stale (older than 5 minutes)
      if (state.startedAt && new Date(state.startedAt) < new Date(Date.now() - 5 * 60 * 1000)) {
        try {
          await recoverStaleInventoryClaims();
        } catch (recoveryErr) {
          console.error('[webhook] Failed to recover stale inventory claims:', recoveryErr);
          return res.status(500).json({ success: false, message: 'Inventory recovery failed' });
        }
        // Retry the claim after recovery
        const retryClaim = await claimInventoryProcessing(order._id);
        if (!retryClaim) {
          return res.json({ success: true, data: { ignored: 'inventory claim failed after recovery' } });
        }
        processingClaim = retryClaim;
      } else {
        // Another webhook is currently processing - return already settled
        await cartService.clearCart(order.user);
        return res.json({ success: true, data: { alreadySettled: true, orderNumber: order.orderNumber } });
      }
    } else {
      // Some other state (FAILED, etc.) - allow retry
      const retryClaim = await claimInventoryProcessing(order._id);
      if (!retryClaim) {
        return res.json({ success: true, data: { ignored: 'inventory claim failed' } });
      }
      processingClaim = retryClaim;
    }
  }

  const processingToken = processingClaim.inventoryProcessingToken;

  // STEP 3: Commit inventory (with rollback on failure)
  try {
    await commitInventory(order);
    await cartService.clearCart(order.user);
  } catch (err) {
    // Rollback: release the processing claim (mark as FAILED to allow retry)
    await releaseInventoryProcessingClaim(order._id, processingToken).catch(() => {});
    // Rollback settlement claim
    await rollbackSettlementClaim(order._id).catch(() => {});
    throw err;
  }

  // STEP 4: Finalize inventory commitment (atomic, only owner can do this)
  const finalized = await finalizeInventoryCommitment(order._id, processingToken);
  if (!finalized) {
    // This should not happen if we own the token, but handle gracefully
    console.error(`[webhook] Failed to finalize inventory commitment for order ${order.orderNumber}`);
    throw new Error('Inventory finalization failed');
  }

  return res.json({ success: true, data: { settled: order.orderNumber } });
}

export const paymentWebhook = asyncHandler(async (req, res) => {
  // Determine provider from route path - this is the fix for provider isolation
  const providerName = payments.getProviderFromRoute(req.path);
  
  if (providerName === 'cashfree') {
    return handleCashfreeWebhook(req, res);
  }
  if (providerName === 'razorpay') {
    return handleRazorpayWebhook(req, res);
  }
  
  return res.status(400).json({ success: false, message: 'Unknown webhook provider.' });
});

/* ── Order history and detail ───────────────────────────────────────────────
   Every query is scoped to the signed-in customer. A guessed order id belongs
   to somebody else and simply does not match.
   ------------------------------------------------------------------------ */
const listSchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(10),
});

export const listOrders = asyncHandler(async (req, res) => {
  const { page, limit } = listSchema.parse(req.validatedQuery ?? req.query);

  const filter = { user: req.user._id };
  /* Orders awaiting a card payment that never completed are not purchases and
     must not clutter a customer's history. A pending COD order is real and
     stays. */
  filter.$or = [
    { paymentMethod: PAYMENT_METHOD.COD },
    { paymentStatus: { $ne: PAYMENT_STATUS.PENDING } },
  ];

  const [rows, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Order.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: {
      orders: rows.map((o) => o.toPublic()),
      /* Whether any of these can be tracked, so the list can offer it without
         the client guessing from a status string. */
      trackable: rows.some((o) => SHIPPED_STATUSES.includes(o.status)),
    },
    meta: pageMeta({ page, limit, total }),
  });
});

/** Accepts either the order number or the id, because customers quote the former. */
export const getOrder = asyncHandler(async (req, res) => {
  const ref = String(req.params.orderId);
  const byNumber = await Order.findOne({ orderNumber: ref.toUpperCase() });
  const order =
    byNumber ||
    (/^[a-f\d]{24}$/i.test(ref) ? await Order.findById(ref) : null);

  /* Not found and not-yours are the same answer, so the endpoint cannot be used
     to discover which order numbers exist. */
  if (!order || order.user?.toString() !== req.user._id.toString()) {
    throw ApiError.notFound('We could not find that order.');
  }

  const shipment = await Shipment.findOne({ order: order._id });
  res.json({
    success: true,
    data: {
      order: order.toPublic(),
      /* Absent rather than empty until a carrier is attached — "not shipped
         yet" is different from "shipped with no events". */
      tracking: shipment ? shipment.toPublic() : null,
    },
  });
});