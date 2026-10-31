/* -------------------------------------------------------------------------
   Admin product controller
   -------------------------------------------------------------------------

   The catalogue operations that the new admin UI needs: listing with filters,
   creating, editing, archiving, re-ordering/replacing/removing images and the
   new fields (sku, status, costPrice, reorder, tags, review flag). All
   mutations record an audit line and return `toAdmin`-shaped objects so the
   table and the editor stay consistent with one another. */

import { z } from 'zod';
import { Product, defaultSku } from '../models/Product.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { recordAudit } from '../services/auditService.js';
import { Category } from '../models/Category.js';
import { Collection } from '../models/Collection.js';
import { Ritual } from '../models/Ritual.js';
import { Cart } from '../models/Cart.js';
import { Wishlist } from '../models/Wishlist.js';
import { Order } from '../models/Order.js';
import { cleanList, pickSubmitted } from '../utils/content.js';

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  category: z.string().trim().optional(),
  search: z.string().trim().optional(),
  sort: z.enum(['name', 'updatedAt', 'price', 'stock']).default('updatedAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
  needsReview: z.coerce.boolean().optional(),
  stockState: z.enum(['in', 'low', 'out', 'untracked']).optional(),
  includeCategories: z.coerce.boolean().optional(),
  collection: z.string().trim().optional(),
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(160),
  slug: z.string().trim().min(1).max(120).optional(),
  category: z.string().trim().min(1).max(80),
  sku: z.string().trim().max(80).optional(),
  price: z.coerce.number().min(0),
  salePrice: z.coerce.number().min(0).nullish().transform((v) => (v == null ? null : v)),
  costPrice: z.coerce.number().min(0).nullish().transform((v) => (v == null ? null : v)),
  shortDescription: z.string().trim().max(500).default(''),
  description: z.string().trim().max(4000).default(''),
  stone: z.string().trim().max(120).default(''),
  metal: z.string().trim().max(120).default(''),
  featured: z.boolean().default(false),
  status: z.enum(['draft', 'active', 'archived']).default('draft'),
  availability: z.boolean().default(true),
  needsReview: z.boolean().default(false),
  reviewNote: z.string().trim().max(500).default(''),
  reorderThreshold: z.coerce.number().int().min(0).nullish().transform((v) => (v == null ? null : v)),
  reorderQuantity: z.coerce.number().int().min(0).nullish().transform((v) => (v == null ? null : v)),
  tags: z.array(z.string().trim().min(1)).max(20).default([]),
  productType: z.enum(['crystal', 'jewellery', 'tarot', 'object', 'other']).default('other'),
  currency: z.enum(['INR']).default('INR'),
  seoTitle: z.string().trim().max(70).default(''),
  seoDescription: z.string().trim().max(170).default(''),
});

const updateSchema = createSchema.partial().extend({
  status: z.enum(['draft', 'active', 'archived']).optional(),
  slug: z.string().trim().max(120).optional().transform((s) => (s === '' ? undefined : s)),
});

function parseSort(sort, order) {
  const dir = order === 'asc' ? 1 : -1;
  const spec = {
    name: { name: dir },
    price: { price: dir },
    stock: { stock: dir },
    updatedAt: { updatedAt: dir },
  }[sort];
  return spec || { updatedAt: -1 };
}

function skuFromSlug(slug) {
  return defaultSku(slug);
}

export const listProductsAdmin = asyncHandler(async (req, res) => {
  const q = listSchema.parse(req.query);
  const limit = q.limit;
  const skip = (q.page - 1) * limit;
  const filter = {};

  if (q.status) filter.status = q.status;
  if (q.category) filter.category = String(q.category).toLowerCase();
  if (q.needsReview !== undefined) filter.needsReview = q.needsReview;
  if (q.collection) {
    const collection = await Collection.findOne({ slug: String(q.collection).toLowerCase() }).select('products').lean();
    filter._id = { $in: collection?.products || [] };
  }

  if (q.search) {
    const rx = new RegExp(q.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: rx }, { shortDescription: rx }, { description: rx }, { sku: rx }, { slug: rx }];
  }

  if (q.stockState) {
    if (q.stockState === 'untracked') filter.stock = null;
    if (q.stockState === 'out') filter.stock = 0;
    if (q.stockState === 'low') {
      filter.stock = { $gt: 0 };
      filter.$expr = { $lte: ['$stock', { $ifNull: ['$reorderThreshold', 3] }] };
    }
    if (q.stockState === 'in') {
      filter.stock = { $gt: 0 };
      filter.$expr = { $gt: ['$stock', { $ifNull: ['$reorderThreshold', 3] }] };
    }
  }

  const [rows, total, categories] = await Promise.all([
    Product.find(filter).sort(parseSort(q.sort, q.order)).skip(skip).limit(limit),
    Product.countDocuments(filter),
    q.includeCategories ? Category.find({ active: true }).sort({ sortOrder: 1, name: 1 }) : Promise.resolve([]),
  ]);

  return res.json({
    success: true,
    data: {
      items: rows.map((p) => p.toAdmin()),
      meta: {
        page: q.page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        hasMore: q.page * limit < total,
      },
      categories: categories.map((c) => ({ slug: c.slug, name: c.name, active: c.active })),
    },
  });
});

export const getProductAdmin = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.productId);
  if (!product) throw ApiError.notFound('We could not find that product.');
  const collections = await Collection.find({ products: product._id }).select('name slug active').lean();
  return res.json({
    success: true,
    data: {
      product: {
        ...product.toAdmin(),
        collections: collections.map((c) => ({ id: String(c._id), name: c.name, slug: c.slug, active: c.active })),
      },
    },
  });
});

function sanitizeSku(sku, slug) {
  if (sku && String(sku).trim()) return String(sku).trim().toUpperCase();
  return skuFromSlug(slug);
}

export const createProduct = asyncHandler(async (req, res) => {
  const body = createSchema.parse(req.body);
  const slug = (body.slug || body.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'untitled';
  const sku = sanitizeSku(body.sku, slug);

  const exists = await Product.findOne({ $or: [{ slug }, { sku }] });
  if (exists) throw ApiError.conflict('A product with that slug or SKU already exists.');

  const product = await Product.create({
    name: body.name,
    slug,
    category: String(body.category).toLowerCase(),
    sku,
    price: body.price,
    salePrice: body.salePrice,
    costPrice: body.costPrice,
    shortDescription: body.shortDescription,
    description: body.description,
    stone: body.stone,
    metal: body.metal,
    featured: body.featured,
    status: body.status,
    availability: body.availability,
    needsReview: body.needsReview,
    reviewNote: body.reviewNote,
    reorderThreshold: body.reorderThreshold,
    reorderQuantity: body.reorderQuantity,
    tags: body.tags,
    productType: body.productType,
    currency: body.currency,
    seoTitle: body.seoTitle,
    seoDescription: body.seoDescription,
    publishedAt: body.status === 'active' ? new Date() : null,
  });

  await recordAudit({
    actor: req.user,
    action: 'product.create',
    entity: { type: 'product', id: product._id.toString(), label: product.name },
    summary: `Created product ${product.slug} (SKU ${product.sku})`,
  });

  return res.status(201).json({ success: true, data: { product: product.toAdmin() } });
});

export const updateProduct = asyncHandler(async (req, res) => {
  /* Only the fields the caller sent are applied — see pickSubmitted(). */
  const body = pickSubmitted(updateSchema.parse(req.body), req.body);
  const product = await Product.findById(req.params.productId);
  if (!product) throw ApiError.notFound('We could not find that product.');

  if (body.slug !== undefined && body.slug !== product.slug) {
    const exists = await Product.findOne({ slug: body.slug });
    if (exists) throw ApiError.conflict('A product with that slug already exists.');
    product.previousSlugs = cleanList([...(product.previousSlugs || []), product.slug]);
  }
  if (body.sku !== undefined) {
    const sku = sanitizeSku(body.sku, body.slug || product.slug);
    if (sku !== product.sku) {
      const exists = await Product.findOne({ sku });
      if (exists) throw ApiError.conflict('A product with that SKU already exists.');
      body.sku = sku;
    }
  }

  if (body.status === 'archived') body.availability = false; // hide on public

  const wasActive = product.status === 'active';
  Object.assign(product, body);
  if (product.slug) product.slug = String(product.slug).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (product.category) product.category = String(product.category).toLowerCase();
  if (product.status === 'active' && (!wasActive || !product.publishedAt)) product.publishedAt = new Date();

  await product.save();

  await recordAudit({
    actor: req.user,
    action: 'product.update',
    entity: { type: 'product', id: product._id.toString(), label: product.name },
    summary: `Updated product ${product.slug}`,
  });

  return res.json({ success: true, data: { product: product.toAdmin() } });
});

export const archiveProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.productId);
  if (!product) throw ApiError.notFound('We could not find that product.');
  if (product.status === 'archived') return res.json({ success: true, data: { product: product.toAdmin() } });

  product.status = 'archived';
  product.availability = false;
  await product.save();

  await recordAudit({
    actor: req.user,
    action: 'product.archive',
    entity: { type: 'product', id: product._id.toString(), label: product.name },
    summary: `Archived product ${product.slug}`,
  });
  return res.json({ success: true, data: { product: product.toAdmin() } });
});

export const restoreProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.productId);
  if (!product) throw ApiError.notFound('We could not find that product.');
  if (product.status !== 'archived') return res.json({ success: true, data: { product: product.toAdmin() } });

  product.status = 'active';
  await product.save();

  await recordAudit({
    actor: req.user,
    action: 'product.restore',
    entity: { type: 'product', id: product._id.toString(), label: product.name },
    summary: `Restored product ${product.slug}`,
  });
  return res.json({ success: true, data: { product: product.toAdmin() } });
});

/* Permanent deletion is deliberately hard to do by accident.
   An order line is a financial record and must keep resolving its product, so a
   product referenced by any order cannot be deleted — archive it instead. For a
   product that has never sold, deleting also removes the join rows that would
   otherwise point at a missing document. */
export const deleteProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.productId);
  if (!product) throw ApiError.notFound('We could not find that product.');

  const ordered = await Order.exists({ 'items.product': product._id });
  if (ordered) {
    throw ApiError.conflict(
      'This product appears in an order and cannot be deleted. Archive it instead so order history stays readable.'
    );
  }

  await Promise.all([
    Collection.updateMany({ products: product._id }, { $pull: { products: product._id } }),
    Cart.updateMany({ 'items.product': product._id }, { $pull: { items: { product: product._id } } }),
    Wishlist.updateMany({ 'items.product': product._id }, { $pull: { items: { product: product._id } } }),
    Ritual.updateMany(
      { $or: [{ relatedProducts: product._id }, { linkedProduct: product._id }] },
      { $pull: { relatedProducts: product._id }, $set: { linkedProduct: null } }
    ),
  ]);

  await Product.deleteOne({ _id: product._id });
  await recordAudit({
    actor: req.user,
    action: 'product.delete',
    entity: { type: 'product', id: product._id.toString(), label: product.name },
    summary: `Deleted product ${product.slug}`,
  });
  return res.json({ success: true, data: { deleted: true } });
});
