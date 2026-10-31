/* -------------------------------------------------------------------------
   Admin collection controller
   -------------------------------------------------------------------------

   Collections are merchandising groups. Membership lives only in
   Collection.products (see the model header), so every write here is the single
   authority for which products belong to which collection.

   Deletion is refused while the collection still holds products. The caller can
   pass ?reassignTo=<collectionId> to move them first; that keeps a delete from
   silently orphaning a shelf. Archiving is the ordinary way to retire one.
   ------------------------------------------------------------------------- */

import { z } from 'zod';
import { Collection } from '../models/Collection.js';
import { Product } from '../models/Product.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { recordAudit } from '../services/auditService.js';
import { plainText, slugify, cleanList, statusEnum, pickSubmitted } from '../utils/content.js';
import { assertOptionalImage } from '../utils/media.js';

const listSchema = z.object({
  includeArchived: z.coerce.boolean().optional(),
  search: z.string().trim().optional(),
});

const bodySchema = z.object({
  name: plainText(120, { required: true }),
  slug: z.string().trim().max(120).optional(),
  description: plainText(2000).default(''),
  image: z.string().trim().max(300).default(''),
  products: z.array(z.string()).max(500).optional(),
  sortOrder: z.coerce.number().int().default(0),
  active: z.boolean().default(true),
  featured: z.boolean().default(false),
  seoTitle: plainText(70).default(''),
  seoDescription: plainText(170).default(''),
});

const updateSchema = bodySchema.partial();

function serialise(c, productCount) {
  return c.toAdmin(productCount);
}

async function countsFor(ids) {
  if (!ids.length) return {};
  const rows = await Product.aggregate([
    { $match: { _id: { $in: ids } } },
    { $project: { status: 1 } },
  ]);
  return Object.fromEntries(rows.map((r) => [String(r._id), r.status]));
}

export const listCollections = asyncHandler(async (req, res) => {
  const q = listSchema.parse(req.query);
  const filter = {};
  if (!q.includeArchived) filter.active = true;
  if (q.search) {
    const rx = new RegExp(q.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: rx }, { slug: rx }, { description: rx }];
  }
  const rows = await Collection.find(filter).sort({ sortOrder: 1, name: 1 });
  return res.json({
    success: true,
    data: { items: rows.map((c) => serialise(c, c.products.length)) },
  });
});

export const getCollection = asyncHandler(async (req, res) => {
  const collection = await Collection.findById(req.params.collectionId);
  if (!collection) throw ApiError.notFound('We could not find that collection.');

  const products = await Product.find({ _id: { $in: collection.products } })
    .select('name slug status images price')
    .lean();
  const byId = new Map(products.map((p) => [String(p._id), p]));
  const members = collection.products
    .map((id) => byId.get(String(id)))
    .filter(Boolean)
    .map((p) => ({
      id: String(p._id),
      name: p.name,
      slug: p.slug,
      status: p.status,
      image: p.images?.[0] || null,
      price: p.price,
    }));

  return res.json({ success: true, data: { collection: serialise(collection, members.length), members } });
});

async function resolveProducts(ids = []) {
  const unique = cleanList(ids);
  if (!unique.length) return [];
  const found = await Product.find({ _id: { $in: unique } }).select('_id').lean();
  if (found.length !== unique.length) throw ApiError.badRequest('One or more products no longer exist.');
  return found.map((p) => p._id);
}

export const createCollection = asyncHandler(async (req, res) => {
  const body = bodySchema.parse(req.body);
  const slug = slugify(body.slug || body.name);
  if (!slug) throw ApiError.badRequest('That name cannot become a collection link.');
  if (await Collection.findOne({ slug })) throw ApiError.conflict('A collection with that link already exists.');

  const products = await resolveProducts(body.products || []);
  const collection = await Collection.create({
    ...body,
    slug,
    image: assertOptionalImage(body.image, 'Cover image'),
    products,
  });

  await recordAudit({
    actor: req.user,
    action: 'collection.create',
    entity: { type: 'collection', id: collection._id.toString(), label: collection.name },
    summary: `Created collection ${collection.slug}`,
  });
  return res.status(201).json({ success: true, data: { collection: serialise(collection, products.length) } });
});

export const updateCollection = asyncHandler(async (req, res) => {
  const body = pickSubmitted(updateSchema.parse(req.body), req.body);
  const collection = await Collection.findById(req.params.collectionId);
  if (!collection) throw ApiError.notFound('We could not find that collection.');

  if (body.slug !== undefined && slugify(body.slug) !== collection.slug) {
    const next = slugify(body.slug);
    if (!next) throw ApiError.badRequest('A collection needs a link.');
    if (await Collection.findOne({ slug: next, _id: { $ne: collection._id } })) {
      throw ApiError.conflict('A collection with that link already exists.');
    }
    collection.slug = next;
  }
  if (body.image !== undefined) body.image = assertOptionalImage(body.image, 'Cover image');
  if (body.products !== undefined) body.products = await resolveProducts(body.products);

  Object.assign(collection, body);
  await collection.save();

  await recordAudit({
    actor: req.user,
    action: 'collection.update',
    entity: { type: 'collection', id: collection._id.toString(), label: collection.name },
    summary: `Updated collection ${collection.slug}`,
  });
  return res.json({ success: true, data: { collection: serialise(collection, collection.products.length) } });
});

export const setCollectionProducts = asyncHandler(async (req, res) => {
  const schema = z.object({ products: z.array(z.string()).max(500) });
  const body = schema.parse(req.body);
  const collection = await Collection.findById(req.params.collectionId);
  if (!collection) throw ApiError.notFound('We could not find that collection.');

  const products = await resolveProducts(body.products);
  collection.products = products;
  await collection.save();

  await recordAudit({
    actor: req.user,
    action: 'collection.products',
    entity: { type: 'collection', id: collection._id.toString(), label: collection.name },
    summary: `Set collection membership to ${products.length} product(s)`,
  });
  return res.json({ success: true, data: { collection: serialise(collection, products.length) } });
});

export const archiveCollection = asyncHandler(async (req, res) => {
  const collection = await Collection.findById(req.params.collectionId);
  if (!collection) throw ApiError.notFound('We could not find that collection.');
  collection.active = false;
  await collection.save();
  await recordAudit({
    actor: req.user,
    action: 'collection.archive',
    entity: { type: 'collection', id: collection._id.toString(), label: collection.name },
    summary: `Archived collection ${collection.slug}`,
  });
  return res.json({ success: true, data: { collection: serialise(collection, collection.products.length) } });
});

export const restoreCollection = asyncHandler(async (req, res) => {
  const collection = await Collection.findById(req.params.collectionId);
  if (!collection) throw ApiError.notFound('We could not find that collection.');
  collection.active = true;
  await collection.save();
  await recordAudit({
    actor: req.user,
    action: 'collection.restore',
    entity: { type: 'collection', id: collection._id.toString(), label: collection.name },
    summary: `Restored collection ${collection.slug}`,
  });
  return res.json({ success: true, data: { collection: serialise(collection, collection.products.length) } });
});

export const deleteCollection = asyncHandler(async (req, res) => {
  const collection = await Collection.findById(req.params.collectionId);
  if (!collection) throw ApiError.notFound('We could not find that collection.');

  if (collection.products.length) {
    const targetId = String(req.query.reassignTo || '');
    if (!targetId) {
      throw ApiError.conflict(
        `This collection still holds ${collection.products.length} product(s). Move them to another collection first, or archive it instead.`
      );
    }
    if (targetId === collection._id.toString()) throw ApiError.badRequest('Choose a different collection.');
    const target = await Collection.findById(targetId);
    if (!target) throw ApiError.notFound('The collection to move products into does not exist.');

    /* Additive union: a product already in the target is not duplicated. */
    const merged = [...target.products.map(String)];
    for (const id of collection.products.map(String)) if (!merged.includes(id)) merged.push(id);
    target.products = merged;
    await target.save();
  }

  await Collection.deleteOne({ _id: collection._id });
  await recordAudit({
    actor: req.user,
    action: 'collection.delete',
    entity: { type: 'collection', id: collection._id.toString(), label: collection.name },
    summary: `Deleted collection ${collection.slug}`,
  });
  return res.json({ success: true, data: { deleted: true } });
});

export const collectionOptions = asyncHandler(async (req, res) => {
  const rows = await Collection.find({ active: true }).select('name slug').sort({ sortOrder: 1, name: 1 }).lean();
  return res.json({ success: true, data: { items: rows.map((c) => ({ id: String(c._id), name: c.name, slug: c.slug })) } });
});
