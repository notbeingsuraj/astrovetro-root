/* -------------------------------------------------------------------------
   Database provider
   -------------------------------------------------------------------------

   Serves the catalogue from MongoDB when a database is connected, and defers
   to the static provider for everything it does not yet own.

   It implements the same contract as staticProvider.js, so src/api/ can mount
   either without knowing which is answering. That is what makes the swap
   invisible to the storefront: the shop, the product page and the cart all
   read the same document whichever provider is live.

   Products are overridden; services, journal and testimonials still come from
   the static catalogue, because a reading session and an article are editorial
   content that the commerce flow has no reason to own. Only products are
   overridden, and only because a cart has to resolve a price and a stock count
   from the same row the shop displayed.
   ------------------------------------------------------------------------- */

import { Product } from '../models/Product.js';
import { Collection } from '../models/Collection.js';
import { Ritual } from '../models/Ritual.js';
import { BlogPost } from '../models/BlogPost.js';
import { SiteContent } from '../models/SiteContent.js';
import { HOMEPAGE_DEFAULTS, CONTACT_DEFAULTS } from '../data/siteContent.js';
import staticProvider from './staticProvider.js';

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* The compact product shape embedded in ritual and collection responses. One
   helper so every editorial page shows the same price and image fields. */
const productSummary = (p) => ({
  id: String(p._id),
  slug: p.slug,
  name: p.name,
  price: p.price,
  salePrice: p.salePrice ?? null,
  image: p.images?.[0] || null,
});

/* Reused by list and get so a filter and a lookup cannot drift on how a
   category or availability is interpreted. */
const matchesQuery = (product, query = {}) => {
  const { category, featured, availability, search, minPrice, maxPrice } = query;

  if (category && product.category !== category) return false;
  if (featured !== undefined && Boolean(featured) !== Boolean(product.featured)) return false;
  if (availability !== undefined && Boolean(availability) !== Boolean(product.availability)) return false;
  if (minPrice != null && product.effectivePrice() < Number(minPrice)) return false;
  if (maxPrice != null && product.effectivePrice() > Number(maxPrice)) return false;
  if (search) {
    const needle = String(search).toLowerCase();
    const haystack = `${product.name} ${product.shortDescription} ${product.description}`.toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
};

export const dbProvider = {
  name: 'mongo',

  async listProducts(query = {}) {
    const filter = {};

    /* Lifecycle gate: the public catalogue never lists drafts or archived
       pieces. Carts, wishlist and orders load products by id elsewhere, so an
       archived product still resolves for the history that references it. */
    filter.status = 'active';

    if (query.category) filter.category = query.category;
    if (query.featured !== undefined) filter.featured = Boolean(query.featured);
    if (query.availability !== undefined) filter.availability = Boolean(query.availability);

    /* A collection is a merchandising shelf, not a category. Resolving it to
       the ids stored on the collection keeps membership in one place. */
    if (query.collection) {
      const collection = await Collection.findOne({
        slug: String(query.collection).toLowerCase(),
        active: true,
      })
        .select('products')
        .lean();
      filter._id = { $in: collection?.products || [] };
    }

    if (query.minPrice != null || query.maxPrice != null) {
      /* salePrice-aware: a product is within range if its *effective* price is,
         which is what the customer sees. Comparing against `price` alone would
         include something whose discounted price is out of range. */
      filter.$and = [
        ...(filter.$and || []),
        {
          $or: [
            { salePrice: null },
            {
              $expr: {
                $lt: ['$salePrice', '$price'],
              },
            },
          ],
        },
      ];
      if (query.minPrice != null) filter.$and.push({ $expr: { $gte: [{ $ifNull: ['$salePrice', '$price'] }, Number(query.minPrice)] } });
      if (query.maxPrice != null) filter.$and.push({ $expr: { $lte: [{ $ifNull: ['$salePrice', '$price'] }, Number(query.maxPrice)] } });
    }

    if (query.search) {
      const rx = new RegExp(escapeRegex(query.search), 'i');
      filter.$or = [{ name: rx }, { shortDescription: rx }, { description: rx }, { stone: rx }];
    }

    /* Sorting and the meta shape are a contract with staticProvider, and the
       storefront is written against that contract — not against whichever
       provider happens to be live. So the sort keys, the default ordering and
       the pagination field names are copied exactly rather than reinvented.
       Getting this wrong makes the shop reorder itself the day a database is
       connected, which reads as a bug in the shop rather than in the provider. */
    const limit = Math.max(1, Number(query.limit) || 12);
    const page = Math.max(1, Number(query.page) || 1);
    const skip = (page - 1) * limit;

    const sortSpec = {
      /* Default: featured first, then best rated, then alphabetical. */
      featured: { featured: -1, rating: -1, name: 1 },
      price: query.order === 'asc' ? { price: 1 } : { price: -1 },
      rating: { rating: -1 },
      /* localeCompare in the static provider is case-insensitive-ish; a plain
         index sort is case-sensitive, so "Amethyst" and "amethyst" would swap
         places between providers. The collation makes both agree. */
      name: { name: 1 },
      /* The static provider's "newest" is reverse-alphabetical by slug, which is
         arbitrary but stable; matched here so the order does not shift. */
      newest: { slug: -1 },
    }[query.sort] || { featured: -1, rating: -1, name: 1 };

    const [rows, total] = await Promise.all([
      Product.find(filter).collation({ locale: 'en', strength: 2 }).sort(sortSpec).skip(skip).limit(limit),
      Product.countDocuments(filter),
    ]);

    return {
      data: rows.map((p) => p.toPublic()),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        hasMore: page * limit < total,
        /* Lets the storefront and the tests tell which provider answered. */
        provider: 'mongo',
        database: true,
      },
    };
  },

  async getProduct(slug) {
    /* Same lifecycle gate as the list — a retired product's page 404s for the
       public but the document itself is untouched. Old slugs resolve too, so a
       renamed product does not break a shared link. */
    const key = String(slug).toLowerCase();
    const product = await Product.findOne({
      status: 'active',
      $or: [{ slug: key }, { previousSlugs: key }],
    });
    return product ? product.toPublic() : null;
  },

  /* Distinct categories actually present, so the shop's filter chips cannot
     offer a category with nothing in it. */
  async listIntentions() {
    const rows = await Product.distinct('intentions');
    return rows.filter(Boolean).sort().map((name) => ({ name }));
  },

  /* ── Collections ─────────────────────────────────────────────────────── */

  async listCollections() {
    const rows = await Collection.find({ active: true }).sort({ sortOrder: 1, name: 1 }).lean();
    return {
      data: rows.map((c) => ({
        id: String(c._id),
        slug: c.slug,
        name: c.name,
        description: c.description,
        image: c.image || null,
        featured: Boolean(c.featured),
        productCount: (c.products || []).length,
      })),
      meta: { provider: 'mongo', database: true },
    };
  },

  async getCollection(slug) {
    const collection = await Collection.findOne({ slug: String(slug).toLowerCase(), active: true });
    if (!collection) return null;

    const products = await Product.find({
      _id: { $in: collection.products },
      status: 'active',
    });
    const byId = new Map(products.map((p) => [String(p._id), p]));
    const ordered = collection.products.map((id) => byId.get(String(id))).filter(Boolean);

    return {
      ...collection.toPublic(ordered.length),
      seoTitle: collection.seoTitle,
      seoDescription: collection.seoDescription,
      products: ordered.map((p) => p.toPublic()),
    };
  },

  /* ── Rituals ─────────────────────────────────────────────────────────── */

  async listRituals(query = {}) {
    const filter = { status: 'active' };
    if (query.featured !== undefined) filter.featured = Boolean(query.featured);
    if (query.search) {
      const rx = new RegExp(escapeRegex(query.search), 'i');
      filter.$or = [{ title: rx }, { intro: rx }, { purpose: rx }, { tags: rx }];
    }

    const limit = Math.max(1, Number(query.limit) || 12);
    const page = Math.max(1, Number(query.page) || 1);
    const skip = (page - 1) * limit;

    const [rows, total] = await Promise.all([
      Ritual.find(filter).sort({ featured: -1, publishedAt: -1, title: 1 }).skip(skip).limit(limit),
      Ritual.countDocuments(filter),
    ]);

    /* One query for every product referenced on this page, rather than one per
       ritual — the index renders up to a page of rituals at a time. */
    const productIds = [...new Set(rows.flatMap((r) => (r.relatedProducts || []).map(String)))];
    const products = productIds.length
      ? await Product.find({ _id: { $in: productIds }, status: 'active' }).lean()
      : [];
    const byId = new Map(products.map((p) => [String(p._id), p]));

    const data = rows.map((ritual) =>
      ritual.toPublic({
        relatedProducts: (ritual.relatedProducts || [])
          .map((id) => byId.get(String(id)))
          .filter(Boolean)
          .map(productSummary),
      })
    );

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        hasMore: page * limit < total,
        provider: 'mongo',
        database: true,
      },
    };
  },

  async getRitual(slug) {
    const key = String(slug).toLowerCase();
    const ritual = await Ritual.findOne({
      status: 'active',
      $or: [{ slug: key }, { previousSlugs: key }],
    });
    if (!ritual) return null;

    const [products, collections, linkedProduct] = await Promise.all([
      Product.find({ _id: { $in: ritual.relatedProducts || [] }, status: 'active' }).lean(),
      Collection.find({ slug: { $in: ritual.relatedCollections || [] }, active: true }).lean(),
      /* The linked product is the sellable form of the ritual (a kit, a
         reading). Only an active product is public; a draft or archived one
         simply disappears from the page. */
      ritual.linkedProduct
        ? Product.findOne({ _id: ritual.linkedProduct, status: 'active' }).lean()
        : null,
    ]);

    const byId = new Map(products.map((p) => [String(p._id), p]));
    const ordered = (ritual.relatedProducts || [])
      .map((id) => byId.get(String(id)))
      .filter(Boolean);

    return {
      ...ritual.toPublic({
        relatedProducts: ordered.map(productSummary),
        linkedProduct: linkedProduct ? productSummary(linkedProduct) : null,
      }),
      relatedCollections: collections.map((c) => ({
        slug: c.slug,
        name: c.name,
        description: c.description,
      })),
    };
  },

  /* ── Website content ─────────────────────────────────────────────────── */

  async getHomepageContent() {
    const doc = await SiteContent.findOne({ key: 'homepage' }).lean();
    return {
      homepage: { ...HOMEPAGE_DEFAULTS, ...(doc?.homepage || {}) },
      contact: { ...CONTACT_DEFAULTS, ...(doc?.contact || {}) },
      updatedAt: doc?.updatedAt || null,
    };
  },

  /* ── Journal ─────────────────────────────────────────────────────────── */

  async listArticles(query = {}) {
    /* Until the journal has any documents at all, keep serving the static
       starter articles so a brand-new install is not an empty page. Once one
       post exists — draft, active or archived — the database owns the journal:
       falling back on "no active posts" would make an archived post reappear
       from the static file, which is not what archiving means. */
    const totalPosts = await BlogPost.countDocuments({});
    if (!totalPosts) return staticProvider.listArticles(query);

    const filter = { status: 'active' };
    if (query.category) filter.category = String(query.category);
    if (query.featured !== undefined) filter.featured = Boolean(query.featured);

    const limit = Math.max(1, Number(query.limit) || 12);
    const page = Math.max(1, Number(query.page) || 1);
    const skip = (page - 1) * limit;

    const [rows, total] = await Promise.all([
      BlogPost.find(filter).sort({ featured: -1, publishedAt: -1 }).skip(skip).limit(limit),
      BlogPost.countDocuments(filter),
    ]);

    return {
      data: rows.map((post) => post.toPublic()),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        hasMore: page * limit < total,
        provider: 'mongo',
        database: true,
      },
    };
  },

  async getArticle(slug) {
    const totalPosts = await BlogPost.countDocuments({});
    if (!totalPosts) return staticProvider.getArticle(slug);

    const key = String(slug).toLowerCase();
    const post = await BlogPost.findOne({
      status: 'active',
      $or: [{ slug: key }, { previousSlugs: key }],
    });
    if (!post) return null;

    const related = await BlogPost.find({ status: 'active', _id: { $ne: post._id } })
      .sort({ publishedAt: -1 })
      .limit(3)
      .lean();
    return post.toPublic({
      related: related.map((r) => ({
        slug: r.slug,
        title: r.title,
        category: r.category,
        excerpt: r.excerpt,
        image: r.image || null,
        readingTime: Math.max(1, Math.ceil(String(r.content || '').trim().split(/\s+/).filter(Boolean).length / 220)),
        publishedAt: r.publishedAt,
      })),
    });
  },

  /* Services and testimonials are still static editorial content. */
  listServices: (...args) => staticProvider.listServices(...args),
  getService: (...args) => staticProvider.getService(...args),
  listTestimonials: (...args) => staticProvider.listTestimonials(...args),
};

export default dbProvider;
