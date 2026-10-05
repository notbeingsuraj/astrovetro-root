/* -------------------------------------------------------------------------
   Shipment
   -------------------------------------------------------------------------

   How a parcel moves, and the evidence a customer is shown.

   Kept separate from Order because the two have different lifetimes: an order
   exists from checkout onwards, while a shipment only comes into being when the
   admin actually attaches a carrier and a tracking number. That separation is
   also why "tracking is not available yet" is an honest state rather than an
   empty tracking block on the order.

   `events` is an append-only audit trail written by the admin side (and by the
   carrier webhook if one is wired up). Entries are never edited or removed, so
   the timeline a customer reads is the history that actually happened. The one
   exception is a correction, which appends a further event rather than
   rewriting an earlier one.

   Carrier and tracking number are set together. A tracking number with no
   carrier (or the reverse) produces a link nobody can follow, so the pair is
   validated as a unit.
   ------------------------------------------------------------------------- */

import mongoose from 'mongoose';

export const SHIPMENT_STATUS = Object.freeze({
  LABEL_CREATED: 'label_created',
  PICKED_UP: 'picked_up',
  IN_TRANSIT: 'in_transit',
  OUT_FOR_DELIVERY: 'out_for_delivery',
  DELIVERED: 'delivered',
  EXCEPTION: 'exception',
  RETURNED: 'returned',
});

const eventSchema = new mongoose.Schema(
  {
    status: { type: String, enum: Object.values(SHIPMENT_STATUS), required: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: '', maxlength: 400 },
    /* Carrier scan time, not our write time — they differ by hours. */
    occurredAt: { type: Date, default: Date.now },
    location: { type: String, default: '', maxlength: 120 },
  },
  { _id: true }
);

const shipmentSchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, unique: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },

    carrier: { type: String, required: true, trim: true, maxlength: 60 },
    trackingNumber: { type: String, required: true, trim: true, uppercase: true, index: true },
    /* Optional public tracking URL. When the carrier supports one deep link this
       saves the customer finding it; the raw number is always shown too, so the
       link is an convenience and never the only route to the information. */
    trackingUrl: { type: String, default: '' },

    status: {
      type: String,
      enum: Object.values(SHIPMENT_STATUS),
      default: SHIPMENT_STATUS.LABEL_CREATED,
      index: true,
    },

    estimatedDelivery: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },

    events: { type: [eventSchema], default: [] },
  },
  { timestamps: true }
);

/* Newest event first is what every tracking UI wants to render, so it is the
   stored order rather than something each caller has to sort for. */
shipmentSchema.index({ order: 1, 'events.occurredAt': -1 });

shipmentSchema.methods.toPublic = function toPublic() {
  const events = [...this.events].sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt));
  return {
    orderId: this.order ? this.order.toString() : null,
    carrier: this.carrier,
    trackingNumber: this.trackingNumber,
    trackingUrl: this.trackingUrl || '',
    status: this.status,
    estimatedDelivery: this.estimatedDelivery,
    deliveredAt: this.deliveredAt,
    /* Chronological as well as reverse — a timeline reads downwards, and
       callers that want newest-first can reverse. */
    events: events
      .slice()
      .reverse()
      .map((e) => ({
        status: e.status,
        title: e.title,
        description: e.description,
        occurredAt: e.occurredAt,
        location: e.location,
      })),
  };
};

export const Shipment = mongoose.model('Shipment', shipmentSchema);
export default Shipment;
