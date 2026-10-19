/* -------------------------------------------------------------------------
   Admin purchase order controller
   -------------------------------------------------------------------------

   A purchase order is a record of intent — it changes no stock. Stock moves
   only when goods are received against it, and only through
   inventoryService.recordReceipt, which is idempotent per submission. This
   controller owns the order's own lifecycle: create, edit while draft, send,
   cancel. None of those touch a balance. */

import { z } from 'zod';
import mongoose from 'mongoose';
import { PurchaseOrder } from '../models/PurchaseOrder.js';
import { Supplier } from '../models/Supplier.js';
import { Product, defaultSku } from '../models/Product.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { recordAudit } from '../services/auditService.js';
import { recordReceipt } from '../services/inventoryService.js';

const id = (v) => mongoose.isValidObjectId(v);

/* Human-readable, collision-safe: PO-20261019-A1B2. The random tail keeps
   two orders created in the same second apart. */
async function nextPoNumber() {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  for (let attempt = 0; attempt < 5; attempt++) {
    const tail = Math.random().toString(36).slice(2, 6).toUpperCase();
    const candidate = `PO-${day}-${tail}`;
    const clash = await PurchaseOrder.exists({ poNumber: candidate });
    if (!clash) return candidate;
  }
  throw ApiError.conflict('Could not allocate a purchase order number. Try again.');
}

const lineSchema = z.object({
  productId: z.string().min(1),
  orderedQuantity: z.number().int().min(1),
  unitCost: z.number().min(0),
});

const createSchema = z.object({
  supplierId: z.string().min(1),
  lines: z.array(lineSchema).min(1, 'A purchase order needs at least one line.'),
  expectedDate: z.coerce.date().nullish().transform((v) => v ?? null),
  notes: z.string().trim().max(2000).default(''),
});

/* Resolve line products and snapshot the fields the PO keeps (name, sku,
   cost at time of ordering) so a later product edit cannot rewrite history. */
async function buildLines(lines) {
  const built = [];
  for (const line of lines) {
    if (!id(line.productId)) throw ApiError.badRequest('One of the product ids is not valid.');
    const product = await Product.findById(line.productId);
    if (!product) throw ApiError.badRequest('One of the products no longer exists.');
    built.push({
      product: product._id,
      name: product.name,
      sku: product.sku || defaultSku(product.slug),
      orderedQuantity: line.orderedQuantity,
      receivedQuantity: 0,
      unitCost: line.unitCost,
    });
  }
  return built;
}

export const listPurchaseOrders = asyncHandler(async (req, res) => {
  const q = z
    .object({
      status: z.enum(['draft', 'sent', 'partial', 'received', 'cancelled']).optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(25),
    })
    .parse(req.query);

  const filter = {};
  if (q.status) filter.status = q.status;
  const limit = q.limit;
  const skip = (q.page - 1) * limit;

  const [rows, total] = await Promise.all([
    PurchaseOrder.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('supplier', 'name code').lean(),
    PurchaseOrder.countDocuments(filter),
  ]);

  return res.json({
    success: true,
    data: {
      items: rows,
      meta: { page: q.page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)), hasMore: q.page * limit < total },
    },
  });
});

export const getPurchaseOrder = asyncHandler(async (req, res) => {
  if (!id(req.params.poId)) throw ApiError.badRequest('That purchase order id is not valid.');
  const po = await PurchaseOrder.findById(req.params.poId).populate('supplier', 'name code email phone').lean();
  if (!po) throw ApiError.notFound('We could not find that purchase order.');
  return res.json({ success: true, data: { purchaseOrder: po } });
});

export const createPurchaseOrder = asyncHandler(async (req, res) => {
  const body = createSchema.parse(req.body);
  if (!id(body.supplierId)) throw ApiError.badRequest('That supplier id is not valid.');

  const supplier = await Supplier.findOne({ _id: body.supplierId, status: 'active' });
  if (!supplier) throw ApiError.conflict('That supplier is not active. Restore it first.');

  const lines = await buildLines(body.lines);
  const poNumber = await nextPoNumber();
  const po = await PurchaseOrder.create({
    poNumber,
    supplier: supplier._id,
    lines,
    expectedDate: body.expectedDate,
    notes: body.notes,
    createdBy: req.user._id,
  });

  await recordAudit({
    actor: req.user,
    action: 'purchase.create',
    entity: { type: 'purchaseOrder', id: po._id.toString(), label: po.poNumber },
    summary: `Created ${po.poNumber} for ${supplier.name}: ${lines.map((l) => `${l.orderedQuantity} × ${l.name}`).join(', ')}`,
  });
  return res.status(201).json({ success: true, data: { purchaseOrder: po } });
});

/* Edits are only legal while the order is still a draft — once sent, changing
   quantities behind the supplier's back is exactly the kind of quiet rewrite
   the ledger rules exist to prevent. */
const updateSchema = createSchema.partial();

export const updatePurchaseOrder = asyncHandler(async (req, res) => {
  if (!id(req.params.poId)) throw ApiError.badRequest('That purchase order id is not valid.');
  const po = await PurchaseOrder.findById(req.params.poId);
  if (!po) throw ApiError.notFound('We could not find that purchase order.');
  if (po.status !== 'draft') {
    throw ApiError.conflict('Only a draft purchase order can be edited. Cancel it and create a new one instead.');
  }

  const body = updateSchema.parse(req.body);
  if (body.supplierId) {
    if (!id(body.supplierId)) throw ApiError.badRequest('That supplier id is not valid.');
    const supplier = await Supplier.findOne({ _id: body.supplierId, status: 'active' });
    if (!supplier) throw ApiError.conflict('That supplier is not active. Restore it first.');
    po.supplier = supplier._id;
  }
  if (body.lines) po.lines = await buildLines(body.lines);
  if (body.expectedDate !== undefined) po.expectedDate = body.expectedDate;
  if (body.notes !== undefined) po.notes = body.notes;

  await po.save();
  await recordAudit({
    actor: req.user,
    action: 'purchase.update',
    entity: { type: 'purchaseOrder', id: po._id.toString(), label: po.poNumber },
    summary: `Updated draft ${po.poNumber}`,
  });
  return res.json({ success: true, data: { purchaseOrder: po } });
});

export const sendPurchaseOrder = asyncHandler(async (req, res) => {
  if (!id(req.params.poId)) throw ApiError.badRequest('That purchase order id is not valid.');
  const po = await PurchaseOrder.findById(req.params.poId);
  if (!po) throw ApiError.notFound('We could not find that purchase order.');
  if (po.status !== 'draft') throw ApiError.conflict('Only a draft purchase order can be sent.');

  po.status = 'sent';
  po.sentAt = new Date();
  await po.save();
  await recordAudit({
    actor: req.user,
    action: 'purchase.send',
    entity: { type: 'purchaseOrder', id: po._id.toString(), label: po.poNumber },
    summary: `Sent ${po.poNumber}`,
  });
  return res.json({ success: true, data: { purchaseOrder: po } });
});

export const cancelPurchaseOrder = asyncHandler(async (req, res) => {
  if (!id(req.params.poId)) throw ApiError.badRequest('That purchase order id is not valid.');
  const po = await PurchaseOrder.findById(req.params.poId);
  if (!po) throw ApiError.notFound('We could not find that purchase order.');
  if (po.status === 'received') throw ApiError.conflict('A fully received order cannot be cancelled.');
  if (po.status === 'cancelled') return res.json({ success: true, data: { purchaseOrder: po } });

  po.status = 'cancelled';
  po.cancelledAt = new Date();
  await po.save();
  await recordAudit({
    actor: req.user,
    action: 'purchase.cancel',
    entity: { type: 'purchaseOrder', id: po._id.toString(), label: po.poNumber },
    summary: `Cancelled ${po.poNumber}`,
  });
  return res.json({ success: true, data: { purchaseOrder: po } });
});

/* ── Receiving ───────────────────────────────────────────────────────────── */

const receiveSchema = z.object({
  lines: z
    .array(
      z.object({
        lineId: z.string().min(1),
        quantityReceived: z.number().int().min(1),
      })
    )
    .min(1),
  idempotencyKey: z.string().trim().min(8).max(120),
  note: z.string().trim().max(500).default(''),
});

/* The one path that raises stock from a purchase order. Idempotent on the
   client-supplied key: resubmitting the same receipt returns the first one
   instead of counting the goods twice. */
export const receiveAgainstPurchaseOrder = asyncHandler(async (req, res) => {
  if (!id(req.params.poId)) throw ApiError.badRequest('That purchase order id is not valid.');
  const body = receiveSchema.parse(req.body);

  const result = await recordReceipt({
    purchaseOrderId: req.params.poId,
    lines: body.lines,
    idempotencyKey: body.idempotencyKey,
    note: body.note,
    actor: req.user,
  });

  return res.status(result.replayed ? 200 : 201).json({
    success: true,
    data: {
      receipt: result.receipt,
      purchaseOrder: result.purchaseOrder || (await PurchaseOrder.findById(req.params.poId).lean()),
      replayed: result.replayed,
    },
  });
});

/* Receipts against one order, for its detail page. */
export const listReceipts = asyncHandler(async (req, res) => {
  if (!id(req.params.poId)) throw ApiError.badRequest('That purchase order id is not valid.');
  const { StockReceipt } = await import('../models/StockReceipt.js');
  const receipts = await StockReceipt.find({ purchaseOrder: req.params.poId }).sort({ receivedAt: -1 }).lean();
  return res.json({ success: true, data: { items: receipts } });
});
