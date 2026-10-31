/* -------------------------------------------------------------------------
   Admin journal (blog) controller
   -------------------------------------------------------------------------

   Posts mirror the static `articles` shape so the existing journal and article
   pages keep working when the provider switches to the database.

   `content` is plain text, paragraphs separated by blank lines. The article
   page already renders it with escaping; refusing angle brackets here means a
   stored post cannot inject markup even if a future renderer forgets.

   Drafts are private. Only `active` posts are returned by the public provider.
   Publishing sets publishedAt once; editing a published post keeps the date.
   ------------------------------------------------------------------------- */

import { z } from 'zod';
import { BlogPost } from '../models/BlogPost.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { recordAudit } from '../services/auditService.js';
import { plainText, slugify, cleanList, statusEnum, pickSubmitted } from '../utils/content.js';
import { assertOptionalImage } from '../utils/media.js';

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: statusEnum.optional(),
  category: z.string().trim().max(80).optional(),
  search: z.string().trim().optional(),
  featured: z.coerce.boolean().optional(),
  sort: z.enum(['updatedAt', 'publishedAt', 'title']).default('updatedAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

const bodySchema = z.object({
  title: plainText(200, { required: true }),
  slug: z.string().trim().max(200).optional(),
  excerpt: plainText(500).default(''),
  content: plainText(40000).default(''),
  image: z.string().trim().max(300).default(''),
  imageAlt: plainText(300).default(''),
  author: plainText(120).default('Astro Vetro'),
  category: plainText(80).default('journal'),
  tags: z.array(plainText(60)).max(30).default([]),
  featured: z.boolean().default(false),
  status: statusEnum.default('draft'),
  seoTitle: plainText(70).default(''),
  seoDescription: plainText(170).default(''),
});

const updateSchema = bodySchema.partial();

const adminShape = (post) => post.toAdmin();

export const listBlogPosts = asyncHandler(async (req, res) => {
  const q = listSchema.parse(req.query);
  const filter = {};
  if (q.status) filter.status = q.status;
  if (q.category) filter.category = q.category.toLowerCase();
  if (q.featured !== undefined) filter.featured = q.featured;
  if (q.search) {
    const rx = new RegExp(q.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ title: rx }, { slug: rx }, { excerpt: rx }, { tags: rx }];
  }
  const dir = q.order === 'asc' ? 1 : -1;
  const sort = { updatedAt: { updatedAt: dir }, publishedAt: { publishedAt: dir }, title: { title: dir } }[q.sort];
  const limit = q.limit;
  const skip = (q.page - 1) * limit;

  const [rows, total] = await Promise.all([
    BlogPost.find(filter).sort(sort).skip(skip).limit(limit),
    BlogPost.countDocuments(filter),
  ]);

  return res.json({
    success: true,
    data: {
      items: rows.map(adminShape),
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

export const getBlogPost = asyncHandler(async (req, res) => {
  const post = await BlogPost.findById(req.params.postId);
  if (!post) throw ApiError.notFound('We could not find that post.');
  return res.json({ success: true, data: { post: adminShape(post) } });
});

export const createBlogPost = asyncHandler(async (req, res) => {
  const body = bodySchema.parse(req.body);
  const slug = slugify(body.slug || body.title);
  if (!slug) throw ApiError.badRequest('That title cannot become an article link.');
  if (await BlogPost.findOne({ slug })) throw ApiError.conflict('A post with that link already exists.');

  const post = await BlogPost.create({
    ...body,
    slug,
    image: assertOptionalImage(body.image, 'Cover image'),
    publishedAt: body.status === 'active' ? new Date() : null,
  });

  await recordAudit({
    actor: req.user,
    action: 'blog.create',
    entity: { type: 'blog', id: post._id.toString(), label: post.title },
    summary: `Created journal post ${post.slug} (${post.status})`,
  });
  return res.status(201).json({ success: true, data: { post: adminShape(post) } });
});

export const updateBlogPost = asyncHandler(async (req, res) => {
  const body = pickSubmitted(updateSchema.parse(req.body), req.body);
  const post = await BlogPost.findById(req.params.postId);
  if (!post) throw ApiError.notFound('We could not find that post.');

  if (body.slug !== undefined && slugify(body.slug) !== post.slug) {
    const next = slugify(body.slug);
    if (!next) throw ApiError.badRequest('A post needs a link.');
    if (await BlogPost.findOne({ slug: next, _id: { $ne: post._id } })) {
      throw ApiError.conflict('A post with that link already exists.');
    }
    post.previousSlugs = cleanList([...(post.previousSlugs || []), post.slug]);
    post.slug = next;
  }
  if (body.image !== undefined) body.image = assertOptionalImage(body.image, 'Cover image');

  const wasActive = post.status === 'active';
  Object.assign(post, body);
  if (post.status === 'active' && (!wasActive || !post.publishedAt)) post.publishedAt = new Date();
  await post.save();

  await recordAudit({
    actor: req.user,
    action: 'blog.update',
    entity: { type: 'blog', id: post._id.toString(), label: post.title },
    summary: `Updated journal post ${post.slug} (${post.status})`,
  });
  return res.json({ success: true, data: { post: adminShape(post) } });
});

export const archiveBlogPost = asyncHandler(async (req, res) => {
  const post = await BlogPost.findById(req.params.postId);
  if (!post) throw ApiError.notFound('We could not find that post.');
  post.status = 'archived';
  await post.save();
  await recordAudit({
    actor: req.user,
    action: 'blog.archive',
    entity: { type: 'blog', id: post._id.toString(), label: post.title },
    summary: `Archived journal post ${post.slug}`,
  });
  return res.json({ success: true, data: { post: adminShape(post) } });
});

export const restoreBlogPost = asyncHandler(async (req, res) => {
  const post = await BlogPost.findById(req.params.postId);
  if (!post) throw ApiError.notFound('We could not find that post.');
  post.status = 'draft';
  await post.save();
  await recordAudit({
    actor: req.user,
    action: 'blog.restore',
    entity: { type: 'blog', id: post._id.toString(), label: post.title },
    summary: `Restored journal post ${post.slug} to draft`,
  });
  return res.json({ success: true, data: { post: adminShape(post) } });
});

export const deleteBlogPost = asyncHandler(async (req, res) => {
  const post = await BlogPost.findById(req.params.postId);
  if (!post) throw ApiError.notFound('We could not find that post.');
  await BlogPost.deleteOne({ _id: post._id });
  await recordAudit({
    actor: req.user,
    action: 'blog.delete',
    entity: { type: 'blog', id: post._id.toString(), label: post.title },
    summary: `Deleted journal post ${post.slug}`,
  });
  return res.json({ success: true, data: { deleted: true } });
});
