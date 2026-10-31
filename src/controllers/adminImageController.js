/* -------------------------------------------------------------------------
   Admin image controller
   -------------------------------------------------------------------------

   Photographs live on disk under public/assets/img/ and the database only
   stores their public paths. This controller is the only way files enter
   that directory, and it validates before it writes:

     - the body must be raw image bytes with a recognised magic number
       (JPEG, PNG or WebP) — a .exe renamed to .jpg fails here
     - derivatives are generated with sharp (canonical WebP + a small
       thumbnail); the uploaded original is preserved as-is alongside them
     - every path this controller accepts or returns is proved to resolve
       inside public/ before it is used, so no request can point the site at
       /etc/passwd or write outside the image root

   Assigning a photo to a product is a database edit (images[] order decides
   which is primary); deleting a file from disk is a separate, explicitly
   destructive call that refuses to run while any product still references it. */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { z } from 'zod';
import { Product } from '../models/Product.js';
import { Ritual } from '../models/Ritual.js';
import { BlogPost } from '../models/BlogPost.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { recordAudit } from '../services/auditService.js';
import { getStorageAdapter } from '../utils/storage.js';

const PUBLIC_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
const IMG_ROOT = path.join(PUBLIC_ROOT, 'assets', 'img');
const LIBRARY_DIR = path.join(IMG_ROOT, 'library');

/* Magic numbers we accept. The content-type header alone proves nothing —
   it is whatever the client claims. */
const MAGIC = [
  { bytes: [0xff, 0xd8, 0xff], ext: 'jpg', mime: 'image/jpeg' },
  { bytes: [0x89, 0x50, 0x4e, 0x47], ext: 'png', mime: 'image/png' },
  { bytes: [0x52, 0x49, 0x46, 0x46], ext: 'webp', mime: 'image/webp' }, // RIFF; WEBP checked below
];

function detectImage(buffer) {
  for (const sig of MAGIC) {
    if (sig.bytes.every((b, i) => buffer[i] === b)) {
      if (sig.ext === 'webp' && buffer.toString('ascii', 8, 12) !== 'WEBP') continue;
      return sig;
    }
  }
  return null;
}

/* Resolve a caller-supplied public path to an absolute file, or null when it
   would escape the image root. Used for every path that crosses the API. */
function safeResolve(publicPath) {
  const adapter = getStorageAdapter();
  return adapter.resolve(publicPath);
}

/* ── Upload ──────────────────────────────────────────────────────────────── */

export const uploadImage = asyncHandler(async (req, res) => {
  const buffer = req.body;
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw ApiError.badRequest('No image data received. Send the file as a raw image body.');
  }
  if (buffer.length > 12 * 1024 * 1024) {
    throw ApiError.badRequest('That image is over 12MB. Resize it and try again.');
  }
  const sig = detectImage(buffer);
  if (!sig) throw ApiError.badRequest('Unrecognised image format. JPEG, PNG and WebP are supported.');

  let meta;
  try {
    meta = await sharp(buffer).metadata();
  } catch {
    throw ApiError.badRequest('That file could not be read as an image.');
  }
  if (!meta.width || !meta.height) throw ApiError.badRequest('That image has no readable dimensions.');

  const adapter = getStorageAdapter();
  const result = await adapter.upload({ buffer });

  await recordAudit({
    actor: req.user,
    action: 'image.upload',
    entity: { type: 'image', id: result.large, label: path.basename(result.original) },
    summary: `Uploaded image (${meta.width}×${meta.height}, ${Math.round(buffer.length / 1024)}KB)`,
  });

  return res.status(201).json({
    success: true,
    data: {
      image: {
        original: result.original,
        large: result.large,
        thumb: result.thumb,
        width: meta.width,
        height: meta.height,
      },
    },
  });
});

/* ── Library listing ─────────────────────────────────────────────────────── */

/* Every image file under assets/img, marked with what references it. This is
   the admin "Image Library" view: unassigned photographs (the tier-B album
   candidates and any upload) sit alongside the ones products use. */
export const listLibrary = asyncHandler(async (_req, res) => {
  const assignedBy = new Map(); // publicPath -> [{productId, name, index}]
  const [products, rituals, posts] = await Promise.all([
    Product.find({ images: { $ne: [] } }).select('name slug images imageAlts').lean(),
    Ritual.find({ images: { $ne: [] } }).select('title slug images').lean(),
    BlogPost.find({ image: { $ne: '' } }).select('title slug image').lean(),
  ]);
  for (const p of products) {
    (p.images || []).forEach((img, index) => {
      if (!assignedBy.has(img)) assignedBy.set(img, []);
      assignedBy.get(img).push({ productId: p._id.toString(), name: p.name, index });
    });
  }
  for (const r of rituals) {
    (r.images || []).forEach((img, index) => {
      if (!assignedBy.has(img)) assignedBy.set(img, []);
      assignedBy.get(img).push({ ritualId: r._id.toString(), name: r.title, index });
    });
  }
  for (const post of posts) {
    if (!assignedBy.has(post.image)) assignedBy.set(post.image, []);
    assignedBy.get(post.image).push({ blogId: post._id.toString(), name: post.title, index: 0 });
  }

  const adapter = getStorageAdapter();
  const assignedPaths = new Set(assignedBy.keys());
  const library = await adapter.list({ assignedPaths });

  const perProduct = products.map((p) => ({
    productId: p._id.toString(),
    name: p.name,
    slug: p.slug,
    images: (p.images || []).map((img, index) => ({
      path: img,
      alt: (p.imageAlts || [])[index] || '',
      index,
      primary: index === 0,
    })),
  }));

  return res.json({
    success: true,
    data: {
      unassigned: library.filter((g) => !g.assigned),
      library,
      products: perProduct,
    },
  });
});

/* ── Product image operations ────────────────────────────────────────────── */

const imagesPatchSchema = z.object({
  images: z.array(z.string().min(1)),
  imageAlts: z.array(z.string().max(300)).optional(),
});

async function assertFilesExist(images) {
  const adapter = getStorageAdapter();
  for (const img of images) {
    if (!adapter.exists(img)) {
      throw ApiError.badRequest(`That image does not exist on the server: ${img}`);
    }
  }
}

export const setProductImages = asyncHandler(async (req, res) => {
  const body = imagesPatchSchema.parse(req.body);
  const product = await Product.findById(req.params.productId);
  if (!product) throw ApiError.notFound('We could not find that product.');

  await assertFilesExist(body.images);
  if (body.imageAlts && body.imageAlts.length > body.images.length) {
    throw ApiError.badRequest('There are more alt texts than images.');
  }

  product.images = body.images;
  product.imageAlts = body.imageAlts || body.images.map((_, i) => (product.imageAlts || [])[i] || '');
  await product.save();

  await recordAudit({
    actor: req.user,
    action: 'product.images',
    entity: { type: 'product', id: product._id.toString(), label: product.name },
    summary: `Set ${body.images.length} image(s); primary is now ${body.images[0] || 'none'}`,
  });
  return res.json({ success: true, data: { product: product.toAdmin() } });
});

const addImagesSchema = z.object({
  paths: z.array(z.string().min(1)).min(1),
  alts: z.array(z.string().max(300)).optional(),
});

export const addProductImages = asyncHandler(async (req, res) => {
  const body = addImagesSchema.parse(req.body);
  const product = await Product.findById(req.params.productId);
  if (!product) throw ApiError.notFound('We could not find that product.');

  await assertFilesExist(body.paths);
  const nextImages = [...product.images, ...body.paths];
  if (nextImages.length > 24) throw ApiError.badRequest('A product can carry at most 24 images.');
  const nextAlts = [...(product.imageAlts || [])];
  body.paths.forEach((_, i) => nextAlts.push(body.alts?.[i] || ''));

  product.images = nextImages;
  product.imageAlts = nextAlts;
  await product.save();

  await recordAudit({
    actor: req.user,
    action: 'product.images.add',
    entity: { type: 'product', id: product._id.toString(), label: product.name },
    summary: `Added ${body.paths.length} image(s)`,
  });
  return res.json({ success: true, data: { product: product.toAdmin() } });
});

/* Remove one photograph from a product. The file stays on disk and returns to
   the unassigned pool — removing a picture is not destroying it. */
export const removeProductImage = asyncHandler(async (req, res) => {
  const index = Number(req.params.index);
  const product = await Product.findById(req.params.productId);
  if (!product) throw ApiError.notFound('We could not find that product.');
  if (!Number.isInteger(index) || index < 0 || index >= product.images.length) {
    throw ApiError.badRequest('That image position does not exist.');
  }

  const [removed] = product.images.splice(index, 1);
  (product.imageAlts || []).splice(index, 1);
  await product.save();

  await recordAudit({
    actor: req.user,
    action: 'product.images.remove',
    entity: { type: 'product', id: product._id.toString(), label: product.name },
    summary: `Removed image ${removed}`,
  });
  return res.json({ success: true, data: { product: product.toAdmin(), removed } });
});

/* ── Physical deletion ───────────────────────────────────────────────────── */

/* Destructive, and deliberately so: refuses to delete any file a product or
   a derivative sibling still points at. */
export const deleteLibraryFile = asyncHandler(async (req, res) => {
  const publicPath = String(req.query.path || '');
  const adapter = getStorageAdapter();
  const abs = adapter.resolve(publicPath);
  if (!abs || !adapter.exists(publicPath)) throw ApiError.notFound('We could not find that file.');

  /* Any product, ritual or journal post referencing this exact path blocks
     deletion. */
  const [refProduct, refRitual, refPost] = await Promise.all([
    Product.findOne({ images: publicPath }).select('name').lean(),
    Ritual.findOne({ images: publicPath }).select('title').lean(),
    BlogPost.findOne({ image: publicPath }).select('title').lean(),
  ]);
  const referencing = refProduct || refRitual || refPost;
  if (referencing) {
    throw ApiError.conflict(`${referencing.name || referencing.title} still uses this image. Remove it there first.`);
  }

  const deleted = await adapter.delete(publicPath);

  await recordAudit({
    actor: req.user,
    action: 'image.delete',
    entity: { type: 'image', id: publicPath, label: path.basename(publicPath) },
    summary: `Permanently deleted ${deleted} file(s)`,
  });
  return res.json({ success: true, data: { deleted } });
});
