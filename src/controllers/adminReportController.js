/* -------------------------------------------------------------------------
   Admin report controller
   -------------------------------------------------------------------------

   CSV exports for the numbers an administrator needs outside the dashboard.
   Every export is built through src/utils/csv.js so spreadsheet formula
   injection is handled in one place, and every figure is a live query — the
   valuation reports multiply cost price only, and say so in their column
   headings, because mixing a selling price into a cost report is how a
   business misreads its own margins. */

import mongoose from 'mongoose';
import { z } from 'zod';
import { Product, LOW_STOCK_DEFAULT } from '../models/Product.js';
import { StockMovement } from '../models/StockMovement.js';
import { Order } from '../models/Order.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { buildCsv, sendCsv } from '../utils/csv.js';

const money = (v) => (v == null ? '' : Number(v).toFixed(2));

/* ── Products ────────────────────────────────────────────────────────────── */

export const exportProducts = asyncHandler(async (req, res) => {
  const q = z
    .object({ status: z.enum(['draft', 'active', 'archived']).optional() })
    .parse(req.query);
  const filter = q.status ? { status: q.status } : {};

  const rows = await Product.find(filter).sort({ name: 1 }).lean();
  const csv = buildCsv(
    [
      { key: 'sku', label: 'SKU' },
      { key: 'name', label: 'Name' },
      { key: 'slug', label: 'Slug' },
      { key: 'category', label: 'Category' },
      { key: 'status', label: 'Status' },
      { key: 'price', label: 'Selling Price', value: (r) => money(r.price) },
      { key: 'salePrice', label: 'Sale Price', value: (r) => money(r.salePrice) },
      { key: 'costPrice', label: 'Cost Price', value: (r) => money(r.costPrice) },
      { key: 'stock', label: 'Stock On Hand', value: (r) => (r.stock == null ? 'untracked' : r.stock) },
      {
        key: 'stockValue',
        label: 'Stock Value (cost)',
        value: (r) => (r.stock != null && r.costPrice != null ? money(r.stock * r.costPrice) : ''),
      },
      { key: 'availability', label: 'Available' },
      { key: 'featured', label: 'Featured' },
      { key: 'imageCount', label: 'Images', value: (r) => (r.images || []).length },
    ],
    rows
  );
  return sendCsv(res, `astrovetro-products-${Date.now()}.csv`, csv);
});

/* ── Inventory / valuation ───────────────────────────────────────────────── */

export const exportInventory = asyncHandler(async (_req, res) => {
  const rows = await Product.find({}).sort({ name: 1 }).lean();
  const csv = buildCsv(
    [
      { key: 'sku', label: 'SKU' },
      { key: 'name', label: 'Name' },
      { key: 'stock', label: 'On Hand', value: (r) => (r.stock == null ? 'untracked' : r.stock) },
      { key: 'costPrice', label: 'Cost Price', value: (r) => money(r.costPrice) },
      { key: 'value', label: 'Value (cost basis)', value: (r) => (r.stock != null && r.costPrice != null ? money(r.stock * r.costPrice) : '') },
      {
        key: 'state',
        label: 'State',
        value: (r) =>
          r.stock == null ? 'untracked' : r.stock === 0 ? 'out' : r.stock <= (r.reorderThreshold ?? LOW_STOCK_DEFAULT) ? 'low' : 'in',
      },
      { key: 'reorderThreshold', label: 'Reorder At', value: (r) => r.reorderThreshold ?? '' },
      { key: 'reorderQuantity', label: 'Reorder Qty', value: (r) => r.reorderQuantity ?? '' },
    ],
    rows
  );
  return sendCsv(res, `astrovetro-inventory-${Date.now()}.csv`, csv);
});

/* ── Movements ───────────────────────────────────────────────────────────── */

export const exportMovements = asyncHandler(async (req, res) => {
  const q = z
    .object({
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
      type: z.enum(['opening', 'receive', 'sale', 'adjustment', 'write_off', 'return']).optional(),
    })
    .parse(req.query);

  const filter = {};
  if (q.type) filter.type = q.type;
  if (q.from || q.to) {
    filter.createdAt = {};
    if (q.from) filter.createdAt.$gte = q.from;
    if (q.to) filter.createdAt.$lte = q.to;
  }

  const rows = await StockMovement.find(filter).sort({ createdAt: 1 }).lean();
  const csv = buildCsv(
    [
      { key: 'createdAt', label: 'When' },
      { key: 'sku', label: 'SKU' },
      { key: 'productName', label: 'Product' },
      { key: 'type', label: 'Type' },
      { key: 'quantity', label: 'Change' },
      { key: 'balanceBefore', label: 'Before' },
      { key: 'balanceAfter', label: 'After' },
      { key: 'reason', label: 'Reason' },
      { key: 'reference', label: 'Reference' },
      { key: 'actor', label: 'By', value: (r) => r.actor?.email || '' },
    ],
    rows
  );
  return sendCsv(res, `astrovetro-movements-${Date.now()}.csv`, csv);
});

/* ── Orders ──────────────────────────────────────────────────────────────── */

export const exportOrders = asyncHandler(async (_req, res) => {
  const rows = await Order.find({}).sort({ createdAt: -1 }).lean();
  const csv = buildCsv(
    [
      { key: 'orderNumber', label: 'Order' },
      { key: 'createdAt', label: 'Placed' },
      { key: 'customerEmail', label: 'Customer' },
      { key: 'status', label: 'Status' },
      { key: 'paymentStatus', label: 'Payment' },
      { key: 'paymentMethod', label: 'Method' },
      { key: 'itemCount', label: 'Items', value: (r) => (r.items || []).length },
      { key: 'total', label: 'Total', value: (r) => money(r.total) },
      {
        key: 'items',
        label: 'Lines',
        value: (r) => (r.items || []).map((i) => `${i.quantity} × ${i.name}`).join('; '),
      },
    ],
    rows
  );
  return sendCsv(res, `astrovetro-orders-${Date.now()}.csv`, csv);
});
