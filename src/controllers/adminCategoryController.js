/* -------------------------------------------------------------------------
   Admin category controller
   -------------------------------------------------------------------------

   Categories are their own collection so the list can be managed without a
   deploy. Products reference a category by slug (unchanged from the
   storefront's ?category= filter), so renaming a display name is safe while
   changing a slug is treated as a migration the administrator confirms. */

import { z } from 'zod';
import { Category } from '../models/Category.js';
import { Product } from '../models/Product.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { recordAudit } from '../services/auditService.js';
import { plainText, pickSubmitted } from '../utils/content.js';
import { assertOptionalImage } from '../utils/media.js';

const slugify = (s) =>
  String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export const listCategories = asyncHandler(async (_req, res) => {
  const [categories, counts] = await Promise.all([
    Category.find({}).sort({ sortOrder: 1, name: 1 }).lean(),
    Product.aggregate([{ $group: { _id: '$category', count: { $sum: 1 } } }]),
  ]);
  const bySlug = Object.fromEntries(counts.map((c) => [c._id, c.count]));
  return res.json({
    success: true,
    data: {
      items: categories.map((c) => ({
        slug: c.slug,
        name: c.name,
        description: c.description || '',
        image: c.image || '',
        seoTitle: c.seoTitle || '',
        seoDescription: c.seoDescription || '',
        active: c.active,
        sortOrder: c.sortOrder,
        productCount: bySlug[c.slug] || 0,
        updatedAt: c.updatedAt,
      })),
    },
  });
});

const categorySchema = z.object({
  name: plainText(60, { required: true }),
  slug: z.string().trim().max(80).optional(),
  description: plainText(1200).default(''),
  image: z.string().trim().max(300).default(''),
  seoTitle: plainText(70).default(''),
  seoDescription: plainText(170).default(''),
  active: z.boolean().default(true),
  sortOrder: z.coerce.number().int().default(0),
});

export const createCategory = asyncHandler(async (req, res) => {
  const body = categorySchema.parse(req.body);
  const slug = slugify(body.slug || body.name);
  if (!slug) throw ApiError.badRequest('That name cannot become a category link.');

  const exists = await Category.findOne({ slug });
  if (exists) throw ApiError.conflict('A category with that link already exists.');

  const category = await Category.create({ ...body, slug, image: assertOptionalImage(body.image, 'Category image') });
  await recordAudit({
    actor: req.user,
    action: 'category.create',
    entity: { type: 'category', id: slug, label: body.name },
    summary: `Created category ${slug}`,
  });
  return res.status(201).json({ success: true, data: { category } });
});

export const updateCategory = asyncHandler(async (req, res) => {
  const body = pickSubmitted(categorySchema.partial().parse(req.body), req.body);
  const category = await Category.findOne({ slug: req.params.slug });
  if (!category) throw ApiError.notFound('We could not find that category.');

  if (body.slug !== undefined && slugify(body.slug) !== category.slug) {
    /* Changing the slug silently re-files nothing; the products would keep
       pointing at the old link and the filter would show an empty shelf.
       That is a migration, so it is refused here and the administrator can
       re-file products through the product editor instead. */
    throw ApiError.conflict(
      'A category link cannot be changed here, because products reference it. Create a new category and move products to it.'
    );
  }
  delete body.slug;

  if (body.image !== undefined) body.image = assertOptionalImage(body.image, 'Category image');
  Object.assign(category, body);
  await category.save();

  await recordAudit({
    actor: req.user,
    action: 'category.update',
    entity: { type: 'category', id: category.slug, label: category.name },
    summary: `Updated category ${category.slug}`,
  });
  return res.json({ success: true, data: { category } });
});

/* Retire a category without deleting history: it disappears from new product
   forms but products already filed under it keep resolving. */
export const archiveCategory = asyncHandler(async (req, res) => {
  const category = await Category.findOne({ slug: req.params.slug });
  if (!category) throw ApiError.notFound('We could not find that category.');

  category.active = false;
  await category.save();
  await recordAudit({
    actor: req.user,
    action: 'category.archive',
    entity: { type: 'category', id: category.slug, label: category.name },
    summary: `Retired category ${category.slug}`,
  });
  return res.json({ success: true, data: { category } });
});

export const restoreCategory = asyncHandler(async (req, res) => {
  const category = await Category.findOne({ slug: req.params.slug });
  if (!category) throw ApiError.notFound('We could not find that category.');

  category.active = true;
  await category.save();
  await recordAudit({
    actor: req.user,
    action: 'category.restore',
    entity: { type: 'category', id: category.slug, label: category.name },
    summary: `Reactivated category ${category.slug}`,
  });
  return res.json({ success: true, data: { category } });
});
