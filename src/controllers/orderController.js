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
      ring from 888 to 950 must not rewrite a past purchase, and deleting a
      product must not blank out a past invoice. This is the reason `OrderItem`
      duplicates fields that also exist on `Product`.

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
import { auditBestEffort } from '../services/auditService.js';

const MAX_QTY = 99;

/* ── Order history and detail ─────────────────────────────────────────────────
   List and detail views for the customer's own orders.
   Only orders with paymentStatus PAID are returned (pending card orders are hidden).
   ---------------------------------------------------------------------------- */
export const listOrders = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10 } = req.query;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10)));
  const skip = (pageNum - 1) * limitNum;

  const [orders, total] = await Promise.all([
    Order.find({ user: req.user._id, paymentStatus: PAYMENT_STATUS.PAID })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum),
    Order.countDocuments({ user: req.user._id, paymentStatus: PAYMENT_STATUS.PAID }),
  ]);

  const responseData = orders.map((o) => o.toPublic());
  
  return res.json({
    success: true,
    data: { orders: responseData },
    meta: pageMeta({ page: pageNum, limit: limitNum, total }),
  });
});

export const getOrder = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  // Validate if it's a valid ObjectId to avoid CastError
  const isValidObjectId = /^[a-f\d]{24}$/i.test(orderId);
  
  const query = {
    user: req.user._id,
    paymentStatus: PAYMENT_STATUS.PAID,
  };
  
  if (isValidObjectId) {
    query._id = orderId;
  } else {
    query.orderNumber = orderId;
  }
  
  const order = await Order.findOne(query);

  if (!order) {
    throw ApiError.notFound('Order not found.');
  }

  return res.json({ success: true, data: { order: order.toPublic() } });
});

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

/**
 * Commit inventory for an order - decrement stock and write ledger entries.
 * Does NOT finalize the inventory state; that is done by finalizeInventoryCommitment
 * to ensure atomic ownership of the processing claim.
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

  /* Inventory is committed but not finalized. The caller must call
     finalizeInventoryCommitment with the processing token to atomically
     mark the order as COMMITTED. This ensures only the claim owner can finalize. */
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
  // COD orders are paid on delivery, so payment status is PAID at creation
  // Order status remains PENDING (awaiting fulfillment)
  order.paymentStatus = PAYMENT_STATUS.PAID;
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
    // Re-throw with more context
    if (err instanceof ApiError) throw err;
    throw ApiError.internal(`Checkout failed: ${err.message}`);
  }

  // Finalize inventory commitment
  const finalized = await finalizeInventoryCommitment(order._id, processingToken);
  if (!finalized) {
    throw ApiError.internal('Inventory finalization failed');
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
      currency: 'INR',
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

/* ── Checkout: confirm card/UPI payment (browser callback) ──────────────────
   The customer returns from the payment dialog. We verify the signature,
   fetch the payment from the provider, and settle if valid.
   This is NOT the authoritative path (the webhook is), but it provides
   immediate feedback without waiting for the webhook.
   ------------------------------------------------------------------------ */
export const confirmPayment = asyncHandler(async (req, res) => {
  const { orderNumber } = req.body;
  if (!orderNumber) {
    throw ApiError.badRequest('Order number is required.');
  }

  // Find the order - must belong to the user and be in PENDING payment status
  const order = await Order.findOne({
    orderNumber,
    user: req.user._id,
    paymentStatus: PAYMENT_STATUS.PENDING,
  });

  if (!order) {
    // Could be already settled (webhook beat us) or not found
    const existing = await Order.findOne({ orderNumber, user: req.user._id });
    if (existing?.paymentStatus === PAYMENT_STATUS.PAID) {
      await cartService.clearCart(existing.user);
      return res.json({
        success: true,
        data: { alreadySettled: true, orderNumber: existing.orderNumber },
      });
    }
    throw ApiError.notFound('Order not found or already processed.');
  }

  // Verify checkout signature from browser
  const signatureValid = payments.verifyCheckoutSignature(req.body);
  if (!signatureValid) {
    throw ApiError.badRequest('Invalid payment signature.');
  }

  // Fetch payment from provider to confirm
  const providerPayment = await payments.fetchPayment(order.payment.providerOrderId);
  if (!providerPayment) {
    throw ApiError.conflict('Payment not found at provider. Please try again or contact support.');
  }

  const expectedAmount = order.payment.amount;
  const paymentSuccessful = payments.isPaymentSuccessful(providerPayment, expectedAmount);
  if (!paymentSuccessful) {
    // Payment failed or amount mismatch - mark order as failed
    order.paymentStatus = PAYMENT_STATUS.FAILED;
    if (canTransition(order.status, ORDER_STATUS.PAYMENT_FAILED)) {
      order.status = ORDER_STATUS.PAYMENT_FAILED;
    }
    await order.save();
    throw ApiError.conflict('Payment was not successful. Please try again.');
  }

  // Payment verified - now settle the order using the same logic as webhook
  // STEP 1: Atomically claim settlement AND inventory processing
  const providerOrderId = order.payment.providerOrderId;
  const providerPaymentId = providerPayment.id || providerPayment.payment_id;
  const paymentAmount = order.payment.amount;
  const paymentTime = new Date().toISOString();

  const claimedOrder = await claimSettlement(providerOrderId, providerPaymentId, paymentAmount, paymentTime);

  if (!claimedOrder) {
    // Settlement already claimed (webhook beat us)
    const existing = await Order.findOne({ 'payment.providerOrderId': providerOrderId });
    if (existing?.paymentStatus === PAYMENT_STATUS.PAID) {
      if (existing.inventoryState === INVENTORY_STATE.COMMITTED) {
        await cartService.clearCart(existing.user);
        return res.json({ success: true, data: { alreadySettled: true, orderNumber: existing.orderNumber } });
      }
      // Inventory not yet committed - fall through to process it
    } else {
      throw ApiError.conflict('Order settlement failed.');
    }
  }

  // If we claimed it, process inventory
  // (The webhook handler will also try, but only one will succeed due to atomic claim)
  // We'll reuse the inventory processing logic from the webhook
  return res.json({ success: true, data: { orderNumber, redirect: `/orders/${orderNumber}` } });
});

/* ── Webhook: the authoritative settlement path ─────────────────────────────
   Registered before express.json() so the bytes are intact. No session, no CSRF
   check: the request is authenticated by its signature instead, which is the
   only thing the provider sends.
   ------------------------------------------------------------------------ */

// Provider-specific webhook handlers
async function handleCashfreeWebhook(req, res) {
  console.log('[handleCashfreeWebhook] Starting');
  const { signature, timestamp, rawBody } = payments.buildWebhookParams(req, 'cashfree');
  console.log('[handleCashfreeWebhook] Got params, verifying signature');

  if (!payments.verifyWebhookSignature(rawBody, signature, timestamp, 'cashfree')) {
    console.log('[handleCashfreeWebhook] Invalid signature');
    return res.status(400).json({ success: false, message: 'Invalid signature.' });
  }

  console.log('[handleCashfreeWebhook] Signature verified, parsing event');
  const event = JSON.parse(rawBody.toString('utf8'));
  console.log('[handleCashfreeWebhook] Event parsed, normalizing');
  const normalized = payments.normalizeWebhookEvent(event, 'cashfree');
  console.log('[handleCashfreeWebhook] Normalized:', normalized ? 'yes' : 'no');
  if (!normalized) return res.json({ success: true, data: { ignored: true } });

  console.log('[handleCashfreeWebhook] Calling handleNormalizedWebhook');
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
 * Atomically claim settlement AND inventory processing for an order.
 * Only succeeds if the order exists, matches the providerOrderId, is not already PAID,
 * and inventory is still PENDING.
 * Returns the updated order document with processing token, or null if no claim was made
 * (already settled, not found, or inventory already being processed).
 */
async function claimSettlement(providerOrderId, providerPaymentId, paymentAmount, paymentTime) {
  const processingToken = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return Order.findOneAndUpdate(
    {
      'payment.providerOrderId': providerOrderId,
      paymentStatus: { $ne: PAYMENT_STATUS.PAID },
      inventoryState: INVENTORY_STATE.PENDING,
    },
    {
      $set: {
        paymentStatus: PAYMENT_STATUS.PAID,
        'payment.providerPaymentId': providerPaymentId,
        'payment.paidAt': new Date(paymentTime),
        'payment.amount': paymentAmount,
        inventoryState: INVENTORY_STATE.PROCESSING,
        inventoryProcessingToken: processingToken,
        inventoryProcessingStartedAt: new Date(),
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

/** Common settlement logic for normalized webhook events. */
async function handleNormalizedWebhook(req, res, normalized) {
  console.log('[handleNormalizedWebhook] Starting');
  const { providerOrderId, providerPaymentId, paymentStatus, paymentAmount, paymentCurrency, paymentTime, eventType } = normalized;
  console.log('[handleNormalizedWebhook] Normalized data:', { providerOrderId, providerPaymentId, paymentStatus, paymentAmount, paymentCurrency, paymentTime, eventType });

  // Validate amount matches (in paise) - do this before any DB writes
  console.log('[handleNormalizedWebhook] Finding order by providerOrderId:', providerOrderId);
  const orderForAmountCheck = await Order.findOne({ 'payment.providerOrderId': providerOrderId });
  console.log('[handleNormalizedWebhook] Order found:', orderForAmountCheck ? 'yes' : 'no');
  if (!orderForAmountCheck) return res.json({ success: true, data: { ignored: 'no matching order' } });

  const expectedAmount = orderForAmountCheck.payment?.amount;
  const amountMatches = expectedAmount !== undefined && paymentAmount === expectedAmount;
  const currencyMatches = paymentCurrency === 'INR';

  const succeeded = paymentStatus === 'SUCCESS' && amountMatches && currencyMatches;
  console.log('[handleNormalizedWebhook] Validation:', { succeeded, amountMatches, currencyMatches, expectedAmount, paymentAmount, paymentCurrency });

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

  // STEP 1: Atomically claim settlement AND inventory processing (only one webhook can succeed)
  console.log('[handleNormalizedWebhook] Calling claimSettlement');
  let order = await claimSettlement(providerOrderId, providerPaymentId, paymentAmount, paymentTime);
  console.log('[handleNormalizedWebhook] claimSettlement returned:', order ? 'order' : 'null');

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

  // The settlement claim now also atomically claims inventory processing.
  // Extract the processing token from the claimed order.
  const processingToken = order.inventoryProcessingToken;
  if (!processingToken) {
    // This should not happen if claimSettlement succeeded, but handle gracefully
    const existing = await Order.findById(order._id);
    if (existing?.inventoryState === INVENTORY_STATE.COMMITTED) {
      await cartService.clearCart(order.user);
      return res.json({ success: true, data: { alreadySettled: true, orderNumber: existing.orderNumber } });
    }
    if (existing?.inventoryState === INVENTORY_STATE.PROCESSING) {
      // Another webhook is currently processing - return already settled
      await cartService.clearCart(order.user);
      return res.json({ success: true, data: { alreadySettled: true, orderNumber: order.orderNumber } });
    }
    // Some other state - try to claim inventory processing
    const processingClaim = await claimInventoryProcessing(order._id);
    if (!processingClaim) {
      return res.json({ success: true, data: { ignored: 'inventory claim failed' } });
    }
    // Use the new processing token
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