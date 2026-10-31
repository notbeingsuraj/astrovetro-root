/* -------------------------------------------------------------------------
   Product
   -------------------------------------------------------------------------

   The commerce-side mirror of a catalogue entry.

   Field names and semantics deliberately match src/data/catalogue.js exactly, so
   the database provider is a drop-in replacement for the static one: the same
   product document satisfies both, and the storefront does not change shape
   when the site moves between them.

   `stock` is the addition the commerce flow needs and the catalogue never had.
   Two conventions make it safe:

     - `null` means "not tracked". An untracked product is never blocked by a
       stock check, which is what lets the existing 12-piece catalogue sell
       without anyone inventing inventory numbers for jewellery made in small
       batches.
     - A number is authoritative, and the server re-reads it inside the order
       transaction. A stock value sent by a browser is never consulted.

   `price` is the live price. Orders do not read it — they snapshot it — so
   repricing a product cannot rewrite what someone already paid.

   Two newer layers, kept separate on purpose:

   - `status` is the lifecycle: draft (being prepared), active (in the public
     catalogue), archived (retired). Only `active` products appear in the
     public catalogue reads (src/providers/dbProvider.js); carts, wishlist and
     orders resolve products by id and therefore still see archived ones, which
     is what keeps past orders readable after a piece is retired. Archiving
     never deletes anything.
   - Inventory fields (`costPrice`, `reorderThreshold`, `reorderQuantity`) are
     operational data: shown to administrators, never serialised to the public
     (see toPublic vs toAdmin).

   `sku` is the stable identifier used across inventory, movements and
   purchase orders. Unique (sparse, so legacy documents without one can be
   back-filled safely), and generated from the slug when a product is created
   through the admin API.

   `category` is no longer an enum on this schema. The authoritative list
   lives in the Category collection so administrators can manage it without a
   deploy; products keep referencing their category by slug, exactly as the
   storefront's `?category=` filter already expects.

   `imageAlts` runs parallel to `images` (same order, same length after any
   admin image operation; treated as optional everywhere it is read, falling
   back to a name-based alt) so each photograph can carry its own description.
   ------------------------------------------------------------------------- */

import mongoose from 'mongoose';

/* System default for "low stock" when a product has no explicit
   reorderThreshold. Exported so the dashboard, the table and the inventory
   service all derive the same status from the same number. */
export const LOW_STOCK_DEFAULT = 3;

/* Stable SKU derivation for products created without an explicit one.
   slug is unique, so this cannot collide: "amethyst-ring" -> "AV-AMETHYST-RING". */
export const defaultSku = (slug) =>
  `AV-${String(slug)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')}`;

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    /* Managed via the Category collection; see file header. */
    category: { type: String, required: true, trim: true, lowercase: true, index: true },

    /* Stable inventory identifier. Sparse: documents created before SKUs
       existed do not block a new one, but two SKUs can never collide. */
    sku: { type: String, trim: true, uppercase: true, unique: true, sparse: true, index: true },

    price: { type: Number, required: true, min: 0 },
    /* Optional strike-through price. Null means not on sale; 0 would be a
       free product, which is never what a zero here means. */
    salePrice: { type: Number, default: null, min: 0 },
    /* What the shop paid for the piece, when known. Null means unknown and is
       never substituted with the selling price in any valuation. */
    costPrice: { type: Number, default: null, min: 0 },

    /* Editorial classification used by the storefront and the admin filters.
       `category` remains the taxonomy (ring, tower, bracelet); productType says
       what kind of object it is. Kept separate so neither has to be overloaded. */
    productType: {
      type: String,
      enum: ['crystal', 'jewellery', 'tarot', 'object', 'other'],
      default: 'other',
      index: true,
    },
    /* ISO 4217 code. The storefront currently formats INR; the field exists so
       a product cannot silently inherit the wrong symbol when that changes. */
    currency: { type: String, enum: ['INR'], default: 'INR' },

    images: { type: [String], default: [] },
    /* Parallel to `images`; readers fall back to a generated alt when the
       entry is missing (legacy documents). */
    imageAlts: { type: [String], default: [] },
    shortDescription: { type: String, default: '' },
    description: { type: String, default: '' },
    intentions: { type: [String], default: [] },

    rating: { type: Number, default: 5, min: 0, max: 5 },
    reviewCount: { type: Number, default: 0, min: 0 },
    availability: { type: Boolean, default: true },
    featured: { type: Boolean, default: false, index: true },
    stone: { type: String, default: '' },
    metal: { type: String, default: '' },

    /* null = inventory not tracked for this piece. See the file header. */
    stock: { type: Number, default: null, min: 0 },
    /* Reorder guidance. null threshold = fall back to the system default
       (LOW_STOCK_DEFAULT in the inventory service); null quantity means the
       administrator has not decided a restock size. */
    reorderThreshold: { type: Number, default: null, min: 0 },
    reorderQuantity: { type: Number, default: null, min: 0 },

    status: { type: String, enum: ['draft', 'active', 'archived'], default: 'active', index: true },
    tags: { type: [String], default: [] },

    /* Search/social copy. Empty falls back to the product's own name and
       short description on the storefront. */
    seoTitle: { type: String, default: '', maxlength: 70 },
    seoDescription: { type: String, default: '', maxlength: 170 },

    /* Set once when a product first becomes public, so "newest" can mean
       "newly published" rather than "recently edited". */
    publishedAt: { type: Date, default: null, index: true },
    /* Old slugs are kept so a renamed product can still be reached — the
       provider looks them up when the current slug misses. */
    previousSlugs: { type: [String], default: [] },

    /* True while the product's identity/photography needs a human check
       (e.g. an uncertain image mapping). Surfaces on the admin dashboard. */
    needsReview: { type: Boolean, default: false, index: true },
    reviewNote: { type: String, default: '', maxlength: 500 },
  },
  { timestamps: true }
);

productSchema.index({ name: 'text', shortDescription: 'text', description: 'text' });

/* The single place that decides what a product costs right now, so the cart,
   the wishlist, checkout and the order screen cannot disagree. */
productSchema.methods.effectivePrice = function effectivePrice() {
  if (this.salePrice != null && this.salePrice < this.price) return this.salePrice;
  return this.price;
};

/* True when the requested quantity can actually be fulfilled. Untracked stock
   (null) always passes; a tracked product must have enough on hand. */
productSchema.methods.canFulfil = function canFulfil(qty) {
  if (!this.availability) return false;
  if (this.stock == null) return true;
  return this.stock >= qty;
};

/* Serialised for the storefront. Identical field set to the static provider's
   output so no consumer has to branch on which provider answered.

   Operational fields (costPrice, sku, status, reorder data, needsReview) are
   deliberately absent: this object is served to anyone browsing the shop. */
productSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id.toString(),
    slug: this.slug,
    name: this.name,
    category: this.category,
    price: this.price,
    salePrice: this.salePrice ?? null,
    effectivePrice: this.effectivePrice(),
    images: this.images,
    imageAlts: this.imageAlts,
    shortDescription: this.shortDescription,
    description: this.description,
    intentions: this.intentions,
    rating: this.rating,
    reviewCount: this.reviewCount,
    availability: this.availability,
    featured: this.featured,
    stone: this.stone,
    metal: this.metal,
    productType: this.productType || 'other',
    currency: this.currency || 'INR',
    seoTitle: this.seoTitle,
    seoDescription: this.seoDescription,
    publishedAt: this.publishedAt,
    /* Exposed as a boolean, not the raw number: the storefront needs to know
       whether an item is available, not how many are on the shelf. */
    inStock: this.availability && (this.stock == null || this.stock > 0),
  };
};

/* Serialised for the admin API. Everything the dashboard shows, including
   operational fields, plus computed inventory status so every screen agrees
   on what "low stock" means instead of re-deriving it. */
productSchema.methods.toAdmin = function toAdmin() {
  const stockState =
    this.stock == null ? 'untracked' : this.stock === 0 ? 'out' : this.isLowStock() ? 'low' : 'in';
  return {
    id: this._id.toString(),
    slug: this.slug,
    name: this.name,
    sku: this.sku || defaultSku(this.slug),
    category: this.category,
    status: this.status,
    price: this.price,
    salePrice: this.salePrice ?? null,
    costPrice: this.costPrice ?? null,
    images: this.images,
    imageAlts: this.imageAlts,
    shortDescription: this.shortDescription,
    description: this.description,
    intentions: this.intentions,
    stone: this.stone,
    metal: this.metal,
    tags: this.tags,
    productType: this.productType || 'other',
    currency: this.currency || 'INR',
    seoTitle: this.seoTitle,
    seoDescription: this.seoDescription,
    publishedAt: this.publishedAt,
    previousSlugs: this.previousSlugs,
    featured: this.featured,
    availability: this.availability,
    rating: this.rating,
    reviewCount: this.reviewCount,
    stock: this.stock,
    reorderThreshold: this.reorderThreshold,
    reorderQuantity: this.reorderQuantity,
    stockState,
    needsReview: this.needsReview,
    reviewNote: this.reviewNote,
    updatedAt: this.updatedAt,
    createdAt: this.createdAt,
  };
};

/* Low when the balance is at or below the product's threshold, or — when no
   threshold was decided — at or below the system default. Shared by the
   dashboard, the table's status column and the toAdmin serialisation so the
   three can never disagree. */
productSchema.methods.isLowStock = function isLowStock(defaultThreshold = LOW_STOCK_DEFAULT) {
  if (this.stock == null || this.stock === 0) return false;
  const threshold = this.reorderThreshold ?? defaultThreshold;
  return this.stock <= threshold;
};

/* The derivation rule for "would this change make stock negative", used by
   the inventory service before applying a delta. */
productSchema.statics.canApplyDelta = function canApplyDelta(stock, delta) {
  if (stock == null) return delta >= 0; /* starting to track: only >= 0 */
  return stock + delta >= 0;
};

export const Product = mongoose.model('Product', productSchema);
export default Product;
