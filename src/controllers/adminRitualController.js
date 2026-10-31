/* -------------------------------------------------------------------------
   Admin ritual controller
   -------------------------------------------------------------------------

   Ritual content is structured plain text (see the Ritual model). This
   controller is the boundary that proves it:

     - every text field goes through plainText(), which refuses angle brackets;
     - steps are objects with a title and a body, never an HTML blob;
     - images must already exist in the local media library;
     - related products/collections are checked to exist before being stored.

   Publishing sets publishedAt once. Editing a published ritual does not move
   that date, so the journal/rituals index keeps a stable order.
   ------------------------------------------------------------------------- */

import { z } from 'zod';
import { Ritual } from '../models/Ritual.js';
import { Product } from '../models/Product.js';
import { Collection } from '../models/Collection.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { recordAudit } from '../services/auditService.js';
import { plainText, slugify, cleanList, statusEnum, isObjectId, pickSubmitted, findProhibitedClaim } from '../utils/content.js';
import { assertImageList } from '../utils/media.js';

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: statusEnum.optional(),
  search: z.string().trim().optional(),
  featured: z.coerce.boolean().optional(),
  sort: z.enum(['updatedAt', 'title', 'publishedAt']).default('updatedAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

const stepSchema = z.object({
  title: plainText(160).default(''),
  body: plainText(4000, { required: true }),
});

const bodySchema = z.object({
  title: plainText(160, { required: true }),
  slug: z.string().trim().max(160).optional(),
  intro: plainText(500).default(''),
  description: plainText(6000).default(''),
  purpose: plainText(160).default(''),
  preparation: plainText(2000).default(''),
  duration: plainText(80).default(''),
  materials: z.array(plainText(160)).max(40).default([]),
  steps: z.array(stepSchema).max(40).default([]),
  images: z.array(z.string().max(300)).max(12).default([]),
  imageAlts: z.array(plainText(300)).max(12).default([]),
  relatedProducts: z.array(z.string()).max(24).default([]),
  relatedCollections: z.array(z.string().max(120)).max(12).default([]),
  linkedProduct: z.string().nullable().optional(),
  tags: z.array(plainText(60)).max(30).default([]),
  featured: z.boolean().default(false),
  status: statusEnum.default('draft'),
  seoTitle: plainText(70).default(''),
  seoDescription: plainText(170).default(''),
});

const updateSchema = bodySchema.partial();

async function resolveProductIds(ids = []) {
  const unique = cleanList(ids);
  if (!unique.length) return [];
  if (unique.some((id) => !isObjectId(id))) throw ApiError.badRequest('One or more related products are not valid.');
  const found = await Product.find({ _id: { $in: unique } }).select('_id').lean();
  if (found.length !== unique.length) throw ApiError.badRequest('One or more related products no longer exist.');
  return found.map((p) => p._id);
}

async function resolveCollections(slugs = []) {
  const unique = cleanList(slugs).map((s) => s.toLowerCase());
  if (!unique.length) return [];
  const found = await Collection.find({ slug: { $in: unique } }).select('slug').lean();
  const valid = new Set(found.map((c) => c.slug));
  const missing = unique.filter((s) => !valid.has(s));
  if (missing.length) throw ApiError.badRequest(`Unknown collection: ${missing.join(', ')}`);
  return unique;
}

async function resolveLinkedProduct(value) {
  if (value == null || value === '') return null;
  if (!isObjectId(value)) throw ApiError.badRequest('The linked product is not valid.');
  const found = await Product.findById(value).select('_id').lean();
  if (!found) throw ApiError.badRequest('The linked product no longer exists.');
  return found._id;
}

/* Refuse health promises before storage. A ritual can describe a practice; it
   cannot claim to cure, treat or diagnose anything, or guarantee an outcome. */
function assertNoHealthClaims(body) {
  const texts = [
    body.title,
    body.intro,
    body.description,
    body.purpose,
    body.preparation,
    body.duration,
    ...(body.materials || []),
    ...(body.steps || []).flatMap((step) => [step.title, step.body]),
    ...(body.tags || []),
    body.seoTitle,
    body.seoDescription,
  ];
  for (const text of texts) {
    const claim = findProhibitedClaim(text);
    if (claim) {
      throw ApiError.validation(
        { claim: `Remove the medical or guaranteed-outcome claim “${claim}”.` },
        'Ritual copy cannot promise medical results or guaranteed outcomes.'
      );
    }
  }
}

async function enrich(doc) {
  const [products, linked] = await Promise.all([
    Product.find({ _id: { $in: doc.relatedProducts || [] }, status: 'active' }).lean(),
    doc.linkedProduct ? Product.findById(doc.linkedProduct).lean() : null,
  ]);
  const byId = new Map(products.map((p) => [String(p._id), p]));
  const related = (doc.relatedProducts || [])
    .map((id) => byId.get(String(id)))
    .filter(Boolean)
    .map((p) => ({
      id: String(p._id),
      slug: p.slug,
      name: p.name,
      price: p.price,
      salePrice: p.salePrice ?? null,
      image: p.images?.[0] || null,
    }));
  return doc.toAdmin({
    relatedProducts: related,
    linkedProduct: linked
      ? { id: String(linked._id), slug: linked.slug, name: linked.name, status: linked.status }
      : null,
  });
}

export const listRituals = asyncHandler(async (req, res) => {
  const q = listSchema.parse(req.query);
  const filter = {};
  if (q.status) filter.status = q.status;
  if (q.featured !== undefined) filter.featured = q.featured;
  if (q.search) {
    const rx = new RegExp(q.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ title: rx }, { slug: rx }, { intro: rx }, { purpose: rx }];
  }
  const dir = q.order === 'asc' ? 1 : -1;
  const sort = { updatedAt: { updatedAt: dir }, title: { title: dir }, publishedAt: { publishedAt: dir } }[q.sort];
  const limit = q.limit;
  const skip = (q.page - 1) * limit;

  const [rows, total] = await Promise.all([
    Ritual.find(filter).sort(sort).skip(skip).limit(limit),
    Ritual.countDocuments(filter),
  ]);

  return res.json({
    success: true,
    data: {
      items: await Promise.all(rows.map(enrich)),
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

export const getRitual = asyncHandler(async (req, res) => {
  const ritual = await Ritual.findById(req.params.ritualId);
  if (!ritual) throw ApiError.notFound('We could not find that ritual.');
  return res.json({ success: true, data: { ritual: await enrich(ritual) } });
});

export const createRitual = asyncHandler(async (req, res) => {
  const body = bodySchema.parse(req.body);
  assertNoHealthClaims(body);
  const slug = slugify(body.slug || body.title);
  if (!slug) throw ApiError.badRequest('That title cannot become a ritual link.');
  if (await Ritual.findOne({ slug })) throw ApiError.conflict('A ritual with that link already exists.');

  const [relatedProducts, relatedCollections, linkedProduct] = await Promise.all([
    resolveProductIds(body.relatedProducts),
    resolveCollections(body.relatedCollections),
    resolveLinkedProduct(body.linkedProduct),
  ]);
  const images = assertImageList(body.images, 'Images', 12);

  const ritual = await Ritual.create({
    ...body,
    slug,
    images,
    imageAlts: body.imageAlts.slice(0, images.length),
    relatedProducts,
    relatedCollections,
    linkedProduct,
    publishedAt: body.status === 'active' ? new Date() : null,
  });

  await recordAudit({
    actor: req.user,
    action: 'ritual.create',
    entity: { type: 'ritual', id: ritual._id.toString(), label: ritual.title },
    summary: `Created ritual ${ritual.slug} (${ritual.status})`,
  });
  return res.status(201).json({ success: true, data: { ritual: await enrich(ritual) } });
});

export const updateRitual = asyncHandler(async (req, res) => {
  const body = pickSubmitted(updateSchema.parse(req.body), req.body);
  assertNoHealthClaims(body);
  const ritual = await Ritual.findById(req.params.ritualId);
  if (!ritual) throw ApiError.notFound('We could not find that ritual.');

  if (body.slug !== undefined && slugify(body.slug) !== ritual.slug) {
    const next = slugify(body.slug);
    if (!next) throw ApiError.badRequest('A ritual needs a link.');
    if (await Ritual.findOne({ slug: next, _id: { $ne: ritual._id } })) {
      throw ApiError.conflict('A ritual with that link already exists.');
    }
    ritual.previousSlugs = cleanList([...(ritual.previousSlugs || []), ritual.slug]);
    ritual.slug = next;
  }

  if (body.relatedProducts !== undefined) body.relatedProducts = await resolveProductIds(body.relatedProducts);
  if (body.relatedCollections !== undefined) body.relatedCollections = await resolveCollections(body.relatedCollections);
  if (body.linkedProduct !== undefined) body.linkedProduct = await resolveLinkedProduct(body.linkedProduct);
  if (body.images !== undefined) body.images = assertImageList(body.images, 'Images', 12);

  const wasActive = ritual.status === 'active';
  Object.assign(ritual, body);
  if (ritual.status === 'active' && (!wasActive || !ritual.publishedAt)) ritual.publishedAt = new Date();

  await ritual.save();
  await recordAudit({
    actor: req.user,
    action: 'ritual.update',
    entity: { type: 'ritual', id: ritual._id.toString(), label: ritual.title },
    summary: `Updated ritual ${ritual.slug} (${ritual.status})`,
  });
  return res.json({ success: true, data: { ritual: await enrich(ritual) } });
});

export const setRitualImages = asyncHandler(async (req, res) => {
  const schema = z.object({
    images: z.array(z.string().max(300)).max(12),
    imageAlts: z.array(plainText(300)).max(12).optional(),
  });
  const body = schema.parse(req.body);
  const ritual = await Ritual.findById(req.params.ritualId);
  if (!ritual) throw ApiError.notFound('We could not find that ritual.');

  ritual.images = assertImageList(body.images, 'Images', 12);
  ritual.imageAlts = (body.imageAlts || []).slice(0, ritual.images.length);
  await ritual.save();

  await recordAudit({
    actor: req.user,
    action: 'ritual.images',
    entity: { type: 'ritual', id: ritual._id.toString(), label: ritual.title },
    summary: `Set ${ritual.images.length} ritual image(s)`,
  });
  return res.json({ success: true, data: { ritual: await enrich(ritual) } });
});

export const archiveRitual = asyncHandler(async (req, res) => {
  const ritual = await Ritual.findById(req.params.ritualId);
  if (!ritual) throw ApiError.notFound('We could not find that ritual.');
  ritual.status = 'archived';
  await ritual.save();
  await recordAudit({
    actor: req.user,
    action: 'ritual.archive',
    entity: { type: 'ritual', id: ritual._id.toString(), label: ritual.title },
    summary: `Archived ritual ${ritual.slug}`,
  });
  return res.json({ success: true, data: { ritual: await enrich(ritual) } });
});

export const restoreRitual = asyncHandler(async (req, res) => {
  const ritual = await Ritual.findById(req.params.ritualId);
  if (!ritual) throw ApiError.notFound('We could not find that ritual.');
  ritual.status = 'draft';
  await ritual.save();
  await recordAudit({
    actor: req.user,
    action: 'ritual.restore',
    entity: { type: 'ritual', id: ritual._id.toString(), label: ritual.title },
    summary: `Restored ritual ${ritual.slug} to draft`,
  });
  return res.json({ success: true, data: { ritual: await enrich(ritual) } });
});

export const deleteRitual = asyncHandler(async (req, res) => {
  const ritual = await Ritual.findById(req.params.ritualId);
  if (!ritual) throw ApiError.notFound('We could not find that ritual.');
  await Ritual.deleteOne({ _id: ritual._id });
  await recordAudit({
    actor: req.user,
    action: 'ritual.delete',
    entity: { type: 'ritual', id: ritual._id.toString(), label: ritual.title },
    summary: `Deleted ritual ${ritual.slug}`,
  });
  return res.json({ success: true, data: { deleted: true } });
});
