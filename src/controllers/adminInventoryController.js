/* -------------------------------------------------------------------------
   Admin inventory controller
   -------------------------------------------------------------------------

   Read-side of the inventory dashboard plus the adjustment endpoints. All
   writes delegate to src/services/inventoryService.js so the ledger and the
   negative-stock guard cannot be bypassed by any route here — including the
   legacy PATCH /products/:id/inventory that the previous admin UI used.

   The dashboard numbers are computed from the database, never hardcoded:
   every tile in the UI corresponds to an aggregation below, and stock
   valuation multiplies only costPrice (never the selling price), skipping
   products whose cost is unknown rather than guessing one. */

import { z } from 'zod';
import mongoose from 'mongoose';
import { Product, LOW_STOCK_DEFAULT } from '../models/Product.js';
import { StockMovement } from '../models/StockMovement.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  applyStockDelta,
  setStockAbsolute,
  clearTracking,
} from '../services/inventoryService.js';
import { recordAudit } from '../services/auditService.js';

const id = (value) => mongoose.isValidObjectId(value);

/* ── Inventory table ─────────────────────────────────────────────────────── */

const tableSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(25),
  search: z.string().trim().optional(),
  category: z.string().trim().optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  stockState: z.enum(['in', 'low', 'out', 'untracked']).optional(),
  sort: z.enum(['name', 'sku', 'stock', 'value', 'updatedAt']).default('name'),
  order: z.enum(['asc', 'desc']).default('asc'),
});

/* Build the mongo filter for the table. Stock-state uses $expr where it must
   compare two fields (stock vs reorderThreshold), which a plain filter cannot. */
function tableFilter(q) {
  const filter = {};
  if (q.status) filter.status = q.status;
  if (q.category) filter.category = String(q.category).toLowerCase();
  if (q.search) {
    const rx = new RegExp(q.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: rx }, { sku: rx }, { slug: rx }];
  }
  const threshold = (field) =>
    field === null || field === undefined ? LOW_STOCK_DEFAULT : field;
  if (q.stockState === 'untracked') filter.stock = null;
  if (q.stockState === 'out') filter.stock = 0;
  if (q.stockState === 'low') {
    filter.stock = { $gt: 0 };
    filter.$expr = {
      $lte: ['$stock', { $ifNull: ['$reorderThreshold', LOW_STOCK_DEFAULT] }],
    };
  }
  if (q.stockState === 'in') {
    filter.stock = { $gt: 0 };
    filter.$expr = {
      $gt: ['$stock', { $ifNull: ['$reorderThreshold', LOW_STOCK_DEFAULT] }],
    };
  }
  return filter;
}

export const inventoryTable = asyncHandler(async (req, res) => {
  const q = tableSchema.parse(req.query);
  const filter = tableFilter(q);
  const limit = q.limit;
  const skip = (q.page - 1) * limit;

  const sortSpec = (() => {
    const dir = q.order === 'desc' ? -1 : 1;
    switch (q.sort) {
      case 'stock':
        return { stock: dir };
      case 'name':
        return { name: dir };
      case 'sku':
        return { sku: dir };
      case 'updatedAt':
        return { updatedAt: dir };
      default:
        return { name: 1 };
    }
  })();

  /* Valuation needs a second pass because it depends on costPrice which the
     sort cannot reach; sorting by value is therefore done in memory below. */
  const [rows, total, categories] = await Promise.all([
    Product.find(filter).sort(sortSpec).skip(skip).limit(limit),
    Product.countDocuments(filter),
    Product.distinct('category'),
  ]);

  const items = rows.map((p) => {
    const admin = p.toAdmin();
    /* Value only ever uses costPrice. An unknown cost contributes null, not 0,
       so "no cost recorded" never masquerades as "worth nothing". */
    admin.stockValue = p.costPrice != null && p.stock != null ? p.costPrice * p.stock : null;
    return admin;
  });

  if (q.sort === 'value') {
    const dir = q.order === 'desc' ? -1 : 1;
    items.sort((a, b) => {
      if (a.stockValue == null && b.stockValue == null) return 0;
      if (a.stockValue == null) return 1;   // unknowns sink to the bottom
      if (b.stockValue == null) return -1;
      return dir * (a.stockValue - b.stockValue);
    });
  }

  return res.json({
    success: true,
    data: {
      items,
      meta: {
        page: q.page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        hasMore: q.page * limit < total,
      },
      categories: categories.sort(),
    },
  });
});

/* ── Dashboard metrics ───────────────────────────────────────────────────── */

export const inventoryDashboard = asyncHandler(async (_req, res) => {
  /* One aggregation for the stock-state buckets, so the tiles cannot drift
     from one another between separate queries. */
  const buckets = await Product.aggregate([
    {
      $group: {
        _id: {
          $switch: {
            branches: [
              { case: { $eq: ['$stock', null] }, then: 'untracked' },
              { case: { $eq: ['$stock', 0] }, then: 'out' },
              {
                case: {
                  $lte: ['$stock', { $ifNull: ['$reorderThreshold', LOW_STOCK_DEFAULT] }],
                },
                then: 'low',
              },
            ],
            default: 'in',
          },
        },
        count: { $sum: 1 },
        /* Units on hand, summed only where the balance is tracked. */
        units: { $sum: { $ifNull: ['$stock', 0] } },
      },
    },
  ]);
  const byState = Object.fromEntries(
    buckets.map((b) => [b._id, { count: b.count, units: b.units }])
  );
  for (const state of ['in', 'low', 'out', 'untracked']) {
    byState[state] ??= { count: 0, units: 0 };
  }

  /* Valuation: cost price only, and only for products that record one. */
  const valuation = await Product.aggregate([
    { $match: { stock: { $gt: 0 }, costPrice: { $ne: null } } },
    {
      $group: {
        _id: null,
        value: { $sum: { $multiply: ['$stock', '$costPrice'] } },
        products: { $sum: 1 },
        units: { $sum: '$stock' },
      },
    },
  ]);
  const valued = valuation[0] || { value: 0, products: 0, units: 0 };
  /* Products carrying stock whose cost is unknown — the honest gap in the
     valuation figure, surfaced so nobody treats the total as complete. */
  const uncosted = await Product.countDocuments({ stock: { $gt: 0 }, costPrice: null });

  const [activeCount, draftCount, archivedCount, reviewCount, recent] =
    await Promise.all([
      Product.countDocuments({ status: 'active' }),
      Product.countDocuments({ status: 'draft' }),
      Product.countDocuments({ status: 'archived' }),
      Product.countDocuments({ needsReview: true }),
      StockMovement.find().sort({ createdAt: -1 }).limit(8).lean(),
    ]);

  /* Revenue from paid orders, computed live — the dashboard must never show a
     figure that is not derived from the orders collection. */
  const Order = mongoose.model('Order');
  const revenueAgg = await Order.aggregate([
    { $match: { paymentStatus: 'paid' } },
    {
      $group: {
        _id: null,
        revenue: { $sum: '$totals.grand' },
        orders: { $sum: 1 },
      },
    },
  ]);
  const revenue = revenueAgg[0] || { revenue: 0, orders: 0 };

  return res.json({
    success: true,
    data: {
      stockStates: byState,
      valuation: {
        totalCostValue: valued.value,
        valuedProducts: valued.products,
        valuedUnits: valued.units,
        uncostedProducts: uncosted,
      },
      catalogue: {
        active: activeCount,
        draft: draftCount,
        archived: archivedCount,
        needsReview: reviewCount,
      },
      revenue: { total: revenue.revenue, paidOrders: revenue.orders },
      recentMovements: recent,
    },
  });
});

/* ── Movements ───────────────────────────────────────────────────────────── */

const movementSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(30),
  productId: z.string().optional(),
  type: z
    .enum(['opening', 'receive', 'sale', 'adjustment', 'write_off', 'return'])
    .optional(),
});

export const listMovements = asyncHandler(async (req, res) => {
  const q = movementSchema.parse(req.query);
  const filter = {};
  if (q.productId) {
    if (!id(q.productId)) throw ApiError.badRequest('That product id is not valid.');
    filter.product = q.productId;
  }
  if (q.type) filter.type = q.type;

  const limit = q.limit;
  const skip = (q.page - 1) * limit;
  const [rows, total] = await Promise.all([
    StockMovement.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    StockMovement.countDocuments(filter),
  ]);

  return res.json({
    success: true,
    data: {
      items: rows,
      meta: {
        page: q.page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        hasMore: q.page * limit < total,
      },
    },
  });
});

/* ── Adjustments ─────────────────────────────────────────────────────────── */

const adjustSchema = z.object({
  /* Either an exact target (set) or a signed change (delta) — never both. */
  mode: z.enum(['set', 'delta']),
  quantity: z.coerce.number().int(),
  type: z
    .enum(['opening', 'adjustment', 'write_off', 'return'])
    .default('adjustment'),
  reason: z.string().trim().min(1, 'A reason is required.').max(300),
  reference: z.string().trim().max(120).default(''),
});

export const adjustProductStock = asyncHandler(async (req, res) => {
  if (!id(req.params.productId)) throw ApiError.badRequest('That product id is not valid.');
  const body = adjustSchema.parse(req.body);

  const args = {
    productId: req.params.productId,
    reason: body.reason,
    reference: body.reference,
    actor: req.user,
  };

  const result =
    body.mode === 'set'
      ? await setStockAbsolute({ ...args, quantity: body.quantity, type: body.type })
      : await applyStockDelta({ ...args, delta: body.quantity, type: body.type });

  const product = await Product.findById(req.params.productId);
  return res.json({
    success: true,
    data: {
      movement: result.movement,
      balanceBefore: result.balanceBefore,
      balanceAfter: result.balanceAfter,
      product: product ? product.toAdmin() : null,
    },
  });
});

/* Stop tracking a product's stock entirely (returns it to "made to order"). */
const untrackSchema = z.object({
  reason: z.string().trim().min(1, 'A reason is required.').max(300),
});

export const untrackProduct = asyncHandler(async (req, res) => {
  if (!id(req.params.productId)) throw ApiError.badRequest('That product id is not valid.');
  const body = untrackSchema.parse(req.body);
  const result = await clearTracking({
    productId: req.params.productId,
    reason: body.reason,
    actor: req.user,
  });
  const product = await Product.findById(req.params.productId);
  return res.json({
    success: true,
    data: { result, product: product ? product.toAdmin() : null },
  });
});
