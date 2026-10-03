/* -------------------------------------------------------------------------
   Data provider — static (in-process catalogue)
   -------------------------------------------------------------------------

   Implements the repository contract the API layer depends on, reading from
   the static catalogue instead of a database.

   Every query the storefront can make lives here, so this file - not the route
   handlers, and never the UI - is the single place that knows how products are
   filtered, sorted and paginated. Keeping that logic here is what lets the
   Mongo provider be dropped in later without touching a single page.
   ------------------------------------------------------------------------- */

import catalogue from '../data/catalogue.js';

const { products, services, testimonials, articles } = catalogue;

const matches = (a, b) => String(a) === String(b);

export const staticProvider = {
  name: 'static',

  /* ── Products ────────────────────────────────────────────────────────── */

  async listProducts(query = {}) {
    let list = products.slice();

    if (query.search) {
      const term = String(query.search).toLowerCase();
      list = list.filter((p) =>
        `${p.name} ${p.shortDescription || ''} ${p.description || ''} ${p.stone || ''}`
          .toLowerCase()
          .includes(term)
      );
    }

    if (query.category) list = list.filter((p) => matches(p.category, query.category));
    if (query.intention) {
      list = list.filter((p) => (p.intentions || []).some((i) => matches(i, query.intention)));
    }
    if (query.featured === true || query.featured === 'true') {
      list = list.filter((p) => p.featured);
    }
    if (query.availability === true || query.availability === 'true') {
      list = list.filter((p) => p.availability);
    }

    const byPrice = (a, b) => a.price - b.price;
    const sort = query.sort || 'featured';
    if (sort === 'price') {
      list.sort(query.order === 'asc' ? byPrice : (a, b) => byPrice(b, a));
    } else if (sort === 'rating') {
      list.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    } else if (sort === 'name') {
      list.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    } else if (sort === 'newest') {
      list.slice().sort((a, b) => String(b.slug).localeCompare(String(a.slug)));
    } else {
      /* Default. Featured first, then best rated, so an unconfigured shop still
         leads with the strongest pieces instead of alphabetical noise. */
      list.sort(
        (a, b) =>
          Number(b.featured) - Number(a.featured) ||
          (b.rating || 0) - (a.rating || 0) ||
          String(a.name).localeCompare(String(b.name))
      );
    }

    const limit = Math.max(1, Number(query.limit) || 12);
    const page = Math.max(1, Number(query.page) || 1);
    const total = list.length;
    const slice = list.slice((page - 1) * limit, page * limit);

    return {
      data: slice,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        hasMore: page * limit < total,
      },
    };
  },

  async getProduct(slug) {
    return products.find((p) => p.slug === slug) || null;
  },

  async listIntentions() {
    const names = [...new Set(products.flatMap((p) => p.intentions || []))].sort();
    return names.map((name) => ({ name }));
  },

  /* ── Services ────────────────────────────────────────────────────────── */

  async listServices(query = {}) {
    let list = services.slice();
    if (query.type) list = list.filter((s) => matches(s.type, query.type));
    if (query.featured === true || query.featured === 'true') {
      list = list.filter((s) => s.featured);
    }
    return list;
  },

  async getService(slug) {
    return services.find((s) => s.slug === slug) || null;
  },

  /* ── Journal & voices ────────────────────────────────────────────────── */

  async listArticles(query = {}) {
    let list = articles.slice();
    if (query.category) list = list.filter((a) => matches(a.category, query.category));
    if (query.featured === true || query.featured === 'true') {
      list = list.filter((a) => a.featured);
    }
    return list;
  },

  async getArticle(slug) {
    return articles.find((a) => a.slug === slug) || null;
  },

  async listTestimonials() {
    return testimonials.slice();
  },
};

export default staticProvider;