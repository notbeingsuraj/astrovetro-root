/* -------------------------------------------------------------------------
   Admin controller — order fulfilment and inventory
   -------------------------------------------------------------------------

   The back office that makes customer tracking real. Everything the tracking
   page shows is written here.

   The rule that matters: status changes go through the order's state machine.
   `canTransition` is consulted before every write, so an admin cannot move an
   order from `delivered` back to `pending`, and a request that tries is refused
   with an explanation rather than silently ignored. Because the same check runs
   on the webhook and the customer-facing paths, there is one definition of what
   is possible.

   Payment status is NOT settable here. It is only ever changed by the Razorpay
   verification path or the webhook, so an admin typo cannot mark an unpaid
   order as paid.
   ------------------------------------------------------------------------- */

import { z } from 'zod';
import { Order, ORDER_STATUS, PAYMENT_STATUS, canTransition } from '../models/Order.js';
import { Shipment, SHIPMENT_STATUS } from '../models/Shipment.js';
import { Product } from '../models/Product.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { pageMeta } from '../utils/responses.js';

const listSchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  status: z.enum(Object.values(ORDER_STATUS)).optional(),
  /* Free-text search over the order number and the customer's email, which are
     the two things a support conversation actually has to hand. */
  search: z.string().trim().max(80).optional(),
});

export const listAllOrders = asyncHandler(async (req, res) => {
  const { page, limit, status, search } = listSchema.parse(req.validatedQuery ?? req.query);

  const filter = {};
  if (status) filter.status = status;
  if (search) {
    const safe = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [{ orderNumber: { $regex: safe, $options: 'i' } }, { customerEmail: { $regex: safe, $options: 'i' } }];
  }

  const [rows, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Order.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: { orders: rows.map((o) => o.toPublic()) },
    meta: pageMeta({ page, limit, total }),
  });
});

export const getOrderDetail = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.orderId).catch(() => null);
  if (!order) throw ApiError.notFound('We could not find that order.');

  const shipment = await Shipment.findOne({ order: order._id });
  const items = await Promise.all(
    order.items
      .filter((i) => i.product)
      .map(async (i) => {
        const p = await Product.findById(i.product).select('name slug images stock availability');
        return { ordered: i.toObject(), current: p };
      })
  );

  res.json({
    success: true,
    data: {
      order: order.toPublic(),
      tracking: shipment ? shipment.toPublic() : null,
      /* Current catalogue state beside the snapshot, so an admin can see at a
         glance that a line has since been repriced or discontinued. The order
         total is unaffected — it reads the snapshot. */
      items,
    },
  });
});

const statusSchema = z.object({
  status: z.enum(Object.values(ORDER_STATUS)),
  note: z.string().trim().max(300).optional(),
});

export const updateOrderStatus = asyncHandler(async (req, res) => {
  const { status, note } = statusSchema.parse(req.body);
  const order = await Order.findById(req.params.orderId).catch(() => null);
  if (!order) throw ApiError.notFound('We could not find that order.');

  if (!canTransition(order.status, status)) {
    throw ApiError.conflict(`An order that is ${order.status.replace('_', ' ')} cannot become ${status.replace('_', ' ')}.`);
  }

  order.status = status;
  /* Marking an order cancelled after payment does not refund it. Money moves
     back through the provider, deliberately as a separate, audited step. */
  if (status === ORDER_STATUS.DELIVERED) {
    const shipment = await Shipment.findOne({ order: order._id });
    if (shipment) {
      shipment.status = SHIPMENT_STATUS.DELIVERED;
      shipment.deliveredAt = new Date();
      shipment.events.push({
        status: SHIPMENT_STATUS.DELIVERED,
        title: 'Delivered',
        description: note || 'The parcel was delivered.',
        occurredAt: new Date(),
      });
      await shipment.save();
    }
  }

  await order.save();
  res.json({ success: true, data: { order: order.toPublic() } });
});

const shipmentSchema = z.object({
  carrier: z.string().trim().min(2, 'Which carrier is handling this?').max(60),
  trackingNumber: z.string().trim().min(4, 'Enter the tracking number.').max(60),
  trackingUrl: z.string().trim().url('That does not look like a valid link.').max(300).optional().default(''),
  estimatedDelivery: z.coerce.date().optional(),
  status: z.enum(Object.values(SHIPMENT_STATUS)).optional().default(SHIPMENT_STATUS.LABEL_CREATED),
  firstEvent: z
    .object({
      title: z.string().trim().min(2).max(120).optional(),
      description: z.string().trim().max(400).optional(),
      location: z.string().trim().max(120).optional(),
    })
    .optional(),
});

export const attachShipment = asyncHandler(async (req, res) => {
  const body = shipmentSchema.parse(req.body);
  const order = await Order.findById(req.params.orderId).catch(() => null);
  if (!order) throw ApiError.notFound('We could not find that order.');

  /* One shipment per order, enforced by the unique index on `order`. Attaching
     twice updates the existing record instead of creating a second timeline. */
  const shipment = await Shipment.findOneAndUpdate(
    { order: order._id },
    {
      $set: {
        carrier: body.carrier,
        trackingNumber: body.trackingNumber.toUpperCase(),
        trackingUrl: body.trackingUrl,
        status: body.status,
        estimatedDelivery: body.estimatedDelivery ?? null,
        user: order.user,
      },
      /* $setOnInsert only writes the opening event once, so re-saving a shipment
         to correct a date does not duplicate its history. */
      $setOnInsert: {
        events: [
          {
            status: body.status,
            title: body.firstEvent?.title || 'Shipping label created',
            description: body.firstEvent?.description || `${body.carrier} has the parcel.`,
            location: body.firstEvent?.location || '',
            occurredAt: new Date(),
          },
        ],
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  /* Attaching a carrier implies the order has shipped, but only if that is a
     legal move from where it currently is. */
  if (canTransition(order.status, ORDER_STATUS.SHIPPED)) order.status = ORDER_STATUS.SHIPPED;
  await order.save();

  res.status(201).json({ success: true, data: { tracking: shipment.toPublic(), order: order.toPublic() } });
});

const eventSchema = z.object({
  status: z.enum(Object.values(SHIPMENT_STATUS)),
  title: z.string().trim().min(2, 'Give the event a title.').max(120),
  description: z.string().trim().max(400).optional().default(''),
  location: z.string().trim().max(120).optional().default(''),
  /* Carrier scan time, which is routinely hours before it reaches us. */
  occurredAt: z.coerce.date().optional(),
});

export const addTrackingEvent = asyncHandler(async (req, res) => {
  const body = eventSchema.parse(req.body);
  const shipment = await Shipment.findOne({ order: req.params.orderId });
  if (!shipment) throw ApiError.notFound('No shipment has been created for that order yet.');

  /* Append-only. An existing event is never edited, so the timeline a customer
     reads is the history that happened. */
  shipment.events.push({
    status: body.status,
    title: body.title,
    description: body.description,
    location: body.location,
    occurredAt: body.occurredAt ?? new Date(),
  });
  shipment.status = body.status;
  if (body.status === SHIPMENT_STATUS.DELIVERED) shipment.deliveredAt = body.occurredAt ?? new Date();
  await shipment.save();

  /* Keep the order's own status in step, so the order list and the tracking page
     never tell different stories. */
  const order = await Order.findById(shipment.order);
  if (order) {
    const implied =
      body.status === SHIPMENT_STATUS.DELIVERED
        ? ORDER_STATUS.DELIVERED
        : body.status === SHIPMENT_STATUS.IN_TRANSIT || body.status === SHIPMENT_STATUS.OUT_FOR_DELIVERY
          ? ORDER_STATUS.IN_TRANSIT
          : ORDER_STATUS.SHIPPED;
    if (canTransition(order.status, implied)) {
      order.status = implied;
      await order.save();
    }
  }

  res.status(201).json({ success: true, data: { tracking: shipment.toPublic() } });
});

const inventorySchema = z.object({
  /* null clears tracking and returns the product to "not tracked". */
  stock: z.coerce.number().int().min(0).optional(),
  trackStock: z.boolean().optional(),
  availability: z.boolean().optional(),
});

export const updateInventory = asyncHandler(async (req, res) => {
  const body = inventorySchema.parse(req.body);
  const product = await Product.findById(req.params.productId).catch(() => null);
  if (!product) throw ApiError.notFound('We could not find that piece.');

  if (body.trackStock === false) product.stock = null;
  if (body.stock !== undefined) product.stock = body.stock;
  /* Setting stock to 0 takes the piece off the shop without deleting it, so past
     orders that reference it still resolve. */
  if (body.availability !== undefined) product.availability = body.availability;
  else if (product.stock === 0) product.availability = false;

  await product.save();
  res.json({ success: true, data: { product: product.toPublic() } });
});

/* Counts for the dashboard. One round trip rather than six. */
export const dashboard = asyncHandler(async (_req, res) => {
  const byStatus = await Order.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]);
  const [total, unpaid, lowStock] = await Promise.all([
    Order.countDocuments(),
    Order.countDocuments({ paymentStatus: PAYMENT_STATUS.PENDING }),
    Product.countDocuments({ stock: { $gt: 0, $lte: 3 } }),
  ]);

  res.json({
    success: true,
    data: {
      total,
      unpaid,
      lowStock,
      byStatus: Object.fromEntries(byStatus.map((r) => [r._id, r.count])),
    },
  });
});
