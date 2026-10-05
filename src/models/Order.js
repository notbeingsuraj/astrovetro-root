/* -------------------------------------------------------------------------
   Order
   -------------------------------------------------------------------------

   An immutable record of one purchase.

   Two rules give this document its meaning:

   1. EVERYTHING THE CUSTOMER BOUGHT IS SNAPSHOTTED.
      Each item stores name, slug, unit price and image at the moment of
      purchase. Nothing about an order line is resolved from the live Product
      document afterwards. Repricing a ring from 888 to 950 must not rewrite
      what someone already paid, and deleting a product must not blank out a
      past invoice. This is the reason `OrderItem` duplicates fields that also
      exist on `Product`.

   2. THE STATE MACHINE IS DECLARED HERE, NOT AT THE CALL SITE.
      `STATUS_TRANSITIONS` is the only authority on what may follow what. Route
      handlers, the admin panel and the payment webhook all go through the same
      `canTransition` check, so "shipped -> pending" is impossible no matter
      which door it arrives at. A browser-supplied status is never honoured.

   Status and payment status are separate axes on purpose. An order can be
   PAID and still be PENDING while it is picked and packed; it can be
   CANCELLED and still be PAID while a refund settles. Collapsing them into one
   field loses that.
   ------------------------------------------------------------------------- */

import mongoose from 'mongoose';

export const ORDER_STATUS = Object.freeze({
  PENDING: 'pending',
  PAID: 'paid',
  PROCESSING: 'processing',
  SHIPPED: 'shipped',
  IN_TRANSIT: 'in_transit',
  DELIVERED: 'delivered',
  PAYMENT_FAILED: 'payment_failed',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
});

export const PAYMENT_STATUS = Object.freeze({
  PENDING: 'pending',
  PAID: 'paid',
  FAILED: 'failed',
  REFUNDED: 'refunded',
});

export const PAYMENT_METHOD = Object.freeze({
  UPI: 'upi',
  COD: 'cod',
  CARD: 'card',
});

/* The whole state machine. `PROCESSING` is reachable from PAID (payment
   confirmed, now being picked) and from PENDING (cash on delivery, or a
   webhook that confirmed payment without an intermediate step). */
const TRANSITIONS = Object.freeze({
  /* A cash-on-delivery order, or one whose payment has not settled, is still
     PENDING — and it has to be able to reach SHIPPED directly. Without that edge
     the courier cannot pick up an unpaid order that has been packed, and the
     only way through would be to mark it PAID, which would be a lie: the money
     has not arrived. PENDING is the only status that can go directly to SHIPPED
     for exactly this reason. */
  [ORDER_STATUS.PENDING]: [
    ORDER_STATUS.PAID,
    ORDER_STATUS.PROCESSING,
    ORDER_STATUS.SHIPPED,
    ORDER_STATUS.PAYMENT_FAILED,
    ORDER_STATUS.CANCELLED,
  ],
  [ORDER_STATUS.PAID]: [ORDER_STATUS.PROCESSING, ORDER_STATUS.SHIPPED, ORDER_STATUS.CANCELLED, ORDER_STATUS.REFUNDED],
  [ORDER_STATUS.PROCESSING]: [ORDER_STATUS.SHIPPED, ORDER_STATUS.CANCELLED, ORDER_STATUS.REFUNDED],
  [ORDER_STATUS.SHIPPED]: [ORDER_STATUS.IN_TRANSIT, ORDER_STATUS.DELIVERED],
  [ORDER_STATUS.IN_TRANSIT]: [ORDER_STATUS.DELIVERED],
  [ORDER_STATUS.DELIVERED]: [],
  [ORDER_STATUS.PAYMENT_FAILED]: [ORDER_STATUS.PENDING, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.CANCELLED]: [],
  [ORDER_STATUS.REFUNDED]: [],
});

export function canTransition(from, to) {
  if (from === to) return true;
  return (TRANSITIONS[from] || []).includes(to);
}

/* True once the parcel is physically with the carrier. Tracking links only
   appear for orders that have actually shipped. */
export const SHIPPED_STATUSES = Object.freeze([
  ORDER_STATUS.SHIPPED,
  ORDER_STATUS.IN_TRANSIT,
  ORDER_STATUS.DELIVERED,
]);

const orderItemSchema = new mongoose.Schema(
  {
    /* Retained as a live reference for analytics and reorders, but nothing in
       the money path reads through it. */
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },

    /* ── snapshot at purchase time ── */
    name: { type: String, required: true },
    slug: { type: String, required: true },
    image: { type: String, default: null },
    unitPrice: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1, max: 99 },
    /* unitPrice * quantity, frozen. Storing it means a historical order can be
       displayed and audited without re-running arithmetic over old rows. */
    lineTotal: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const addressSnapshotSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    phone: { type: String, default: '' },
    line1: { type: String, required: true },
    line2: { type: String, default: '' },
    city: { type: String, required: true },
    state: { type: String, default: '' },
    pincode: { type: String, required: true },
    country: { type: String, default: 'India' },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    /* Human-facing reference, e.g. AV-1048. Unique and indexed so it can be
       looked up directly, and because customers quote it instead of a
       24-character ObjectId. */
    orderNumber: { type: String, required: true, unique: true, index: true },

    /* Null for a guest order. The email below is what identifies a guest. */
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    customerEmail: { type: String, required: true, lowercase: true, trim: true },

    items: { type: [orderItemSchema], required: true },

    /* ── the money, all server-computed ── */
    subtotal: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    shipping: { type: Number, default: 0, min: 0 },
    tax: { type: Number, default: 0, min: 0 },
    total: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR' },

    /* Frozen copy of where it was sent. A later address edit must not move a
       parcel that has already left. */
    shippingAddress: { type: addressSnapshotSchema, required: true },

    status: {
      type: String,
      enum: Object.values(ORDER_STATUS),
      default: ORDER_STATUS.PENDING,
      index: true,
    },
    paymentStatus: {
      type: String,
      enum: Object.values(PAYMENT_STATUS),
      default: PAYMENT_STATUS.PENDING,
    },
    paymentMethod: {
      type: String,
      enum: Object.values(PAYMENT_METHOD),
      required: true,
    },

    /* Provider references only. No card number, no CVV, no cardholder copy is
       stored here or anywhere in this project — Razorpay handles the card. */
    payment: {
      provider: { type: String, default: null },
      providerOrderId: { type: String, default: null, index: true },
      providerPaymentId: { type: String, default: null },
      signature: { type: String, default: null },
      paidAt: { type: Date, default: null },
      refundedAt: { type: Date, default: null },
      amount: { type: Number, default: null },
    },

    /* Set once inventory has been decremented, so a retried webhook cannot
       double-decrement stock for the same order. */
    inventoryCommitted: { type: Boolean, default: false },

    /* The customer's own retry token. Unique per account so a second submit
       with the same key is recognised rather than duplicated. Sparse, because
       guest orders and admin-created orders legitimately have none. */
    idempotencyKey: { type: String, default: null },
  },
  { timestamps: true }
);

/* "Same customer, same key" is the constraint that makes PLACE ORDER safe to
   double-click. */
orderSchema.index(
  { user: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }
);

/* Order history is always "this user's orders, newest first". */
orderSchema.index({ user: 1, createdAt: -1 });

orderSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id.toString(),
    orderNumber: this.orderNumber,
    customerEmail: this.customerEmail,
    items: this.items.map((i) => ({
      productId: i.product ? i.product.toString() : null,
      name: i.name,
      slug: i.slug,
      image: i.image,
      unitPrice: i.unitPrice,
      quantity: i.quantity,
      lineTotal: i.lineTotal,
    })),
    subtotal: this.subtotal,
    discount: this.discount,
    shipping: this.shipping,
    tax: this.tax,
    total: this.total,
    currency: this.currency,
    shippingAddress: this.shippingAddress,
    status: this.status,
    paymentStatus: this.paymentStatus,
    paymentMethod: this.paymentMethod,
    paidAt: this.payment.paidAt,
    createdAt: this.createdAt,
    /* Tracking is a separate document; the caller joins it. */
    hasTracking: SHIPPED_STATUSES.includes(this.status),
  };
};

export const Order = mongoose.model('Order', orderSchema);
export default Order;
