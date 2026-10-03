/* -------------------------------------------------------------------------
   Data provider — MongoDB (not yet connected)
   -------------------------------------------------------------------------

   THIS IS THE SWAP POINT.

   The site runs today on the static provider and needs no database. When
   MongoDB is ready, this file becomes the live provider and src/providers/index.js
   picks it up automatically the moment DATABASE_URL is set. No route handler,
   no page and no UI file has to change when that happens.

   It implements the exact contract staticProvider.js does, so the two are
   interchangeable:

       listProducts(query)   -> { data, meta }
       getProduct(slug)      -> product | null
       listIntentions()      -> [{ name }]
       listServices(query)   -> service[]
       getService(slug)      -> service | null
       listArticles(query)   -> article[]
       getArticle(slug)      -> article | null
       listTestimonials()    -> testimonial[]

   Until then every method refuses rather than pretending, so a missing database
   surfaces as an honest error instead of silently returning an empty catalogue
   that would look like the shop had simply sold out.
   ------------------------------------------------------------------------- */

export class ProviderNotConfiguredError extends Error {
  constructor(what) {
    super(`${what} requires a database, which is not configured yet.`);
    this.name = 'ProviderNotConfiguredError';
    this.code = 'DATABASE_NOT_CONFIGURED';
    this.status = 503;
    /* Tells the API layer to answer 503 rather than 500: the request was
       understood, the deployment simply has no database attached. */
    this.expected = true;
  }
}

const notReady = (what) => async () => {
  throw new ProviderNotConfiguredError(what);
};

export const mongoProvider = {
  name: 'mongo',

  listProducts: notReady('Reading products'),
  getProduct: notReady('Reading a product'),
  listIntentions: notReady('Reading intentions'),

  listServices: notReady('Reading services'),
  getService: notReady('Reading a service'),

  listArticles: notReady('Reading articles'),
  getArticle: notReady('Reading an article'),

  listTestimonials: notReady('Reading testimonials'),
};

export default mongoProvider;