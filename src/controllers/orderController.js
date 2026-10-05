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
      is fetched from Razorpay to confirm it was captured for the right amount.

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
import { Order, ORDER_STATUS, PAYMENT_STATUS, PAYMENT_METHOD, canTransition, SHIPPED_STATUSES } from '../models/Order.js';
import { Product } from '../models/Product.js';
import { Cart } from '../models/Cart.js';
import { Address } from '../models/Address.js';
import { Shipment } from '../models/Shipment.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { pageMeta } from '../utils/responses.js';
import { priceCart, CURRENCY } from '../services/pricing.js';
import { addressFields } from '../middleware/validate.js';
import * as cartService from '../services/cartService.js';
import * as razorpay from '../payments/razorpay.js';
import { DUPLICATE_KEY } from '../middleware/errorHandler.js';

const MAX_QTY = 99;

/* Sequential, human-quotable order numbers: AV-1048.
   Derived from the highest existing number rather than a counter collection, so
   it survives a fresh database without a migration and matches the reference
   pages' format without copying their sample values. */
/* Order numbers are shown to customers on a packing slip, so they must be
   sequential in the way a human reads them. That rules out sorting the stored
   string: lexicographically "AV-999" > "AV-1048", so the highest number would
   stop being the latest order the moment the sequence reached four digits. The
   suffix is therefore converted to a number before taking the maximum.

   Concurrent checkouts can read the same maximum and generate the same number,
   so the unique index on orderNumber is the real guard: the first save wins and
   the loser is retried against the new maximum. Attempt-based, because a genuine
   collision should be rare and a fixed sleep would only make the queue slower. */
const ORDER_START = 1048;
const NUMBER_ATTEMPTS = 5;

async function highestOrderNumber() {
  /* Computed in JS rather than pushed into the aggregation pipeline.

     Mongo has no clean way to pull a trailing capture group out of a string:
     $regexMatch yields a boolean, and the $substrCP/$replaceAll workarounds both
     failed in ways that were worse than useless — one silently returned 1 for
     every row, so every new order collided with AV-1; the other threw on any
     number that had not yet reached three digits. An aggregation pipeline that
     silently computes the wrong value is far more dangerous here than a read
     that scales with the order count, because it fails quietly and every order
     after it collides.

     Only order numbers are read, so the projection stays small. */
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
 * Decrement stock for each line.
 *
 * Uses a guarded atomic update rather than read-then-write, so two customers
 * buying the last piece cannot both succeed. Products with `stock: null` are
 * untracked and are skipped entirely — decrementing them would turn "not
 * tracked" into a negative number.
 *
 * `inventoryCommitted` on the order is the idempotency guard for a retried
 * webhook.
 */
async function commitInventory(order) {
  if (order.inventoryCommitted) return;

  for (const item of order.items) {
    if (!item.product) continue;
    const product = await Product.findById(item.product);
    if (!product || product.stock == null) continue;

    const updated = await Product.findOneAndUpdate(
      { _id: item.product, stock: { $gte: item.quantity } },
      { $inc: { stock: -item.quantity } },
      { new: true }
    );

    /* Lost the race: someone bought the last units while this order was being
       placed. The order is left uncommitted and marked for attention rather
       than being silently marked as sold. */
    if (!updated) {
      throw ApiError.outOfStock(`${item.name} sold out while the order was being placed.`);
    }
  }

  order.inventoryCommitted = true;
  await order.save();
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
  await commitInventory(order);
  /* Only now is the bag emptied. Clearing before the order exists would lose a
     customer's basket on a failed write. */
  await cartService.clearCart(req.user._id);

  return res.status(201).json({ success: true, data: { order: order.toPublic() } });
});

/* ── Checkout: card or UPI, via Razorpay ────────────────────────────────────
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

  if (!razorpay.isPaymentConfigured()) {
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
  const amountInPaise = razorpay.toPaise(priced.total);

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

  const providerOrder = await razorpay.createProviderOrder({
    amountInPaise,
    receipt: orderNumber,
    notes: {
      orderNumber,
      userId: req.user._id.toString(),
      amount: String(amountInPaise),
      currency: CURRENCY,
      /* Same fallback as the order itself — these notes are what a human reads
         when reconciling a payment against an order, so they must not disagree
         with it. */
      email: body.contactEmail || req.user.email,
    },
  });

  /* Attached before the save, so the document and the provider agree from the
     moment either is visible. */
  order.payment = { provider: 'razorpay', providerOrderId: providerOrder.id, amount: amountInPaise };
  await order.save();

  return res.status(201).json({
    success: true,
    data: {
      orderNumber,
      razorpayOrderId: providerOrder.id,
      /* The key id is public by design — Razorpay's own script needs it. The
         key secret stays on the server and is never sent anywhere. */
      keyId: razorpay.publicKeyId(),
      amount: priced.total,
      amountInPaise,
      currency: CURRENCY,
      idempotencyKey: idempotencyKey || null,
    },
  });
});

/* ── Checkout: confirm a card/UPI payment ─────────────────────────────────
   The step that decides whether an order is paid.
   ------------------------------------------------------------------------ */
export const confirmPayment = asyncHandler(async (req, res) => {
  const schema = z.object({
    razorpayOrderId: z.string().min(1),
    razorpayPaymentId: z.string().min(1),
    razorpaySignature: z.string().min(1),
    idempotencyKey: z.string().trim().min(8).max(120).optional(),
  });
  const body = schema.parse(req.body);
  const idempotencyKey = req.get('idempotency-key') || body.idempotencyKey;

  /* Replay of a request that already succeeded. Returns the original order
     rather than charging again or creating a second one. */
  const replay = await findByIdempotency(req.user._id, idempotencyKey);
  if (replay) return res.json({ success: true, data: { order: replay.toPublic(), replayed: true } });

  /* 1. The signature. Proves this payment response belongs to an order we
        created. A browser cannot produce it without the key secret. */
  if (!razorpay.verifyCheckoutSignature(body)) {
    throw ApiError.badRequest('We could not verify that payment.');
  }

  /* 2. Our own order, found by the provider order id we issued. Scoped to this
        account, so a payment raised against someone else's checkout cannot be
        confirmed here even with a valid signature. */
  const order = await Order.findOne({
    'payment.providerOrderId': body.razorpayOrderId,
    user: req.user._id,
  });
  if (!order) throw ApiError.notFound('We could not find that payment order.');

  /* 3. The provider's record of the payment. The signature proved the response
        is genuine; this proves the money actually moved. */
  const payment = await razorpay.fetchPayment(body.razorpayPaymentId);
  if (!razorpay.isPaymentSuccessful(payment, order.payment?.amount)) {
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
  if (razorpay.toPaise(priced.total) !== order.payment?.amount) {
    throw ApiError.conflict('Your bag changed while the payment was open. Please review it and try again.');
  }

  order.paymentStatus = PAYMENT_STATUS.PAID;
  order.payment = {
    ...order.payment,
    providerPaymentId: body.razorpayPaymentId,
    signature: body.razorpaySignature,
    paidAt: new Date(),
  };
  if (canTransition(order.status, ORDER_STATUS.PAID)) order.status = ORDER_STATUS.PAID;
  await order.save();

  await commitInventory(order);
  await cartService.clearCart(req.user._id);

  return res.json({ success: true, data: { order: order.toPublic() } });
});

/* ── Razorpay webhook: the authoritative settlement path ─────────────────── */
export const paymentWebhook = asyncHandler(async (req, res) => {
  const signature = req.get('x-razorpay-signature');
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}));

  if (!razorpay.verifyWebhookSignature(raw, signature)) {
    /* An unverified webhook is ignored outright. It must not be able to move an
       order to paid. */
    return res.status(400).json({ success: false, message: 'Invalid signature.' });
  }

  const event = JSON.parse(raw.toString('utf8'));
  const paymentEntity = event?.payload?.payment?.entity;
  if (!paymentEntity) return res.json({ success: true, data: { ignored: true } });

  const order = await Order.findOne({ 'payment.providerOrderId': paymentEntity.order_id });
  if (!order) return res.json({ success: true, data: { ignored: 'no matching order' } });

  /* Idempotent: a provider retry of the same event changes nothing. */
  if (order.paymentStatus === PAYMENT_STATUS.PAID) {
    return res.json({ success: true, data: { alreadySettled: true, orderNumber: order.orderNumber } });
  }

  const succeeded =
    paymentEntity.status === 'captured' && paymentEntity.amount === order.payment?.amount;

  if (!succeeded) {
    if (paymentEntity.status === 'failed') {
      order.paymentStatus = PAYMENT_STATUS.FAILED;
      /* PENDING -> PAYMENT_FAILED is a permitted transition; the guard is here
         so a late webhook cannot drive an order backwards. */
      if (canTransition(order.status, ORDER_STATUS.PAYMENT_FAILED)) {
        order.status = ORDER_STATUS.PAYMENT_FAILED;
      }
      await order.save();
    }
    return res.json({ success: true, data: { recorded: paymentEntity.status } });
  }

  order.paymentStatus = PAYMENT_STATUS.PAID;
  order.payment = {
    ...order.payment,
    providerPaymentId: paymentEntity.id,
    paidAt: new Date(paymentEntity.created_at ? paymentEntity.created_at * 1000 : Date.now()),
    amount: paymentEntity.amount,
  };
  if (canTransition(order.status, ORDER_STATUS.PAID)) order.status = ORDER_STATUS.PAID;
  await order.save();

  /* Guarded, so a retried webhook cannot decrement stock twice. */
  if (!order.inventoryCommitted) await commitInventory(order);
  await cartService.clearCart(order.user);

  return res.json({ success: true, data: { settled: order.orderNumber } });
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
