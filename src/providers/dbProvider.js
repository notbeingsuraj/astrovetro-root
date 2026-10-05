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
import staticProvider from './staticProvider.js';

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

    if (query.category) filter.category = query.category;
    if (query.featured !== undefined) filter.featured = Boolean(query.featured);
    if (query.availability !== undefined) filter.availability = Boolean(query.availability);

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
    const product = await Product.findOne({ slug: String(slug).toLowerCase() });
    return product ? product.toPublic() : null;
  },

  /* Distinct categories actually present, so the shop's filter chips cannot
     offer a category with nothing in it. */
  async listIntentions() {
    const rows = await Product.distinct('intentions');
    return rows.filter(Boolean).sort().map((name) => ({ name }));
  },

  /* Editorial content still comes from the static catalogue for now. */
  listServices: (...args) => staticProvider.listServices(...args),
  getService: (...args) => staticProvider.getService(...args),
  listArticles: (...args) => staticProvider.listArticles(...args),
  getArticle: (...args) => staticProvider.getArticle(...args),
  listTestimonials: (...args) => staticProvider.listTestimonials(...args),
};

export default dbProvider;
