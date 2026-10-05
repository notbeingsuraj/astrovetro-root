/* -------------------------------------------------------------------------
   Tracking controller
   -------------------------------------------------------------------------

   "Where is my order?" for the signed-in customer.

   The one rule that matters here is authorisation. An order reference is
   guessable — AV-1048, AV-1049 — so a tracking endpoint that resolves a
   reference without checking ownership is an IDOR: anyone could walk the
   numbers and read other people's addresses and parcel history.

   So the order is looked up together with its owner in a single query, and a
   miss is reported as "not found" regardless of whether the order exists. The
   customer is never told that somebody else's order number is real.

   "No tracking yet" is a real, distinct answer. A shipment only exists once the
   admin attaches a carrier, so before that this returns an order with
   `tracking: null` rather than an empty timeline that looks broken.
   ------------------------------------------------------------------------- */

import { Order, SHIPPED_STATUSES } from '../models/Order.js';
import { Shipment } from '../models/Shipment.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/** Resolve a customer-supplied reference, scoped to this account. */
async function findOwnedOrder(userId, ref) {
  const value = String(ref || '').trim();
  if (!value) throw ApiError.badRequest('Which order would you like to track?');

  const byNumber = await Order.findOne({ orderNumber: value.toUpperCase(), user: userId });
  if (byNumber) return byNumber;

  if (/^[a-f\d]{24}$/i.test(value)) {
    const byId = await Order.findById(value);
    /* Ownership re-checked on the id path too, so a valid id belonging to
       someone else is indistinguishable from one that does not exist. */
    if (byId && byId.user?.toString() === userId.toString()) return byId;
  }

  throw ApiError.notFound('We could not find that order on your account.');
}

export const getTracking = asyncHandler(async (req, res) => {
  const order = await findOwnedOrder(req.user._id, req.params.orderId);
  const shipment = await Shipment.findOne({ order: order._id });

  res.json({
    success: true,
    data: {
      order: {
        orderNumber: order.orderNumber,
        status: order.status,
        createdAt: order.createdAt,
        itemCount: order.items.reduce((n, i) => n + i.quantity, 0),
        /* Enough to render a summary without exposing the whole order payload
           on a page that is often linked to. */
        total: order.total,
        currency: order.currency,
      },
      /* null, not an empty object: the difference between "not shipped yet" and
         "shipped, nothing scanned" is worth preserving. */
      tracking: shipment ? shipment.toPublic() : null,
      trackable: SHIPPED_STATUSES.includes(order.status),
      message: shipment
        ? null
        : 'Tracking information is not available yet. We will show it here as soon as your parcel is with the carrier.',
    },
  });
});
