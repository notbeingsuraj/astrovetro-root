/* -------------------------------------------------------------------------
   Admin supplier controller
   -------------------------------------------------------------------------

   Suppliers are archived, never deleted: purchase orders and receipts point
   at them, and history that references a supplier has to keep resolving. */

import { z } from 'zod';
import { Supplier } from '../models/Supplier.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { recordAudit } from '../services/auditService.js';

const supplierSchema = z.object({
  name: z.string().trim().min(1).max(120),
  code: z.string().trim().max(40).optional(),
  email: z.string().trim().lowercase().max(160).default(''),
  phone: z.string().trim().max(40).default(''),
  address: z.string().trim().max(400).default(''),
  notes: z.string().trim().max(2000).default(''),
});

export const listSuppliers = asyncHandler(async (req, res) => {
  const includeArchived = req.query.includeArchived === 'true';
  const filter = includeArchived ? {} : { status: 'active' };
  const suppliers = await Supplier.find(filter).sort({ name: 1 }).lean();
  return res.json({ success: true, data: { items: suppliers } });
});

export const getSupplier = asyncHandler(async (req, res) => {
  const supplier = await Supplier.findById(req.params.supplierId).lean();
  if (!supplier) throw ApiError.notFound('We could not find that supplier.');
  return res.json({ success: true, data: { supplier } });
});

export const createSupplier = asyncHandler(async (req, res) => {
  const body = supplierSchema.parse(req.body);
  const exists = await Supplier.findOne({ name: body.name });
  if (exists) throw ApiError.conflict('A supplier with that name already exists.');

  const supplier = await Supplier.create(body);
  await recordAudit({
    actor: req.user,
    action: 'supplier.create',
    entity: { type: 'supplier', id: supplier._id.toString(), label: supplier.name },
    summary: `Created supplier ${supplier.name}`,
  });
  return res.status(201).json({ success: true, data: { supplier } });
});

export const updateSupplier = asyncHandler(async (req, res) => {
  const body = supplierSchema.partial().parse(req.body);
  const supplier = await Supplier.findById(req.params.supplierId);
  if (!supplier) throw ApiError.notFound('We could not find that supplier.');

  Object.assign(supplier, body);
  await supplier.save();
  await recordAudit({
    actor: req.user,
    action: 'supplier.update',
    entity: { type: 'supplier', id: supplier._id.toString(), label: supplier.name },
    summary: `Updated supplier ${supplier.name}`,
  });
  return res.json({ success: true, data: { supplier } });
});

export const archiveSupplier = asyncHandler(async (req, res) => {
  const supplier = await Supplier.findById(req.params.supplierId);
  if (!supplier) throw ApiError.notFound('We could not find that supplier.');
  supplier.status = 'archived';
  await supplier.save();
  await recordAudit({
    actor: req.user,
    action: 'supplier.archive',
    entity: { type: 'supplier', id: supplier._id.toString(), label: supplier.name },
    summary: `Archived supplier ${supplier.name}`,
  });
  return res.json({ success: true, data: { supplier } });
});

export const restoreSupplier = asyncHandler(async (req, res) => {
  const supplier = await Supplier.findById(req.params.supplierId);
  if (!supplier) throw ApiError.notFound('We could not find that supplier.');
  supplier.status = 'active';
  await supplier.save();
  await recordAudit({
    actor: req.user,
    action: 'supplier.restore',
    entity: { type: 'supplier', id: supplier._id.toString(), label: supplier.name },
    summary: `Restored supplier ${supplier.name}`,
  });
  return res.json({ success: true, data: { supplier } });
});
