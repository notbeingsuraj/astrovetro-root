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
   ------------------------------------------------------------------------- */

import mongoose from 'mongoose';

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    category: {
      type: String,
      enum: ['ring', 'bracelet', 'pendant', 'tower', 'cluster', 'tumble', 'raw', 'other'],
      required: true,
      index: true,
    },

    price: { type: Number, required: true, min: 0 },
    /* Optional strike-through price. Null means not on sale; 0 would be a
       free product, which is never what a zero here means. */
    salePrice: { type: Number, default: null, min: 0 },

    images: { type: [String], default: [] },
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
   output so no consumer has to branch on which provider answered. */
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
    shortDescription: this.shortDescription,
    description: this.description,
    intentions: this.intentions,
    rating: this.rating,
    reviewCount: this.reviewCount,
    availability: this.availability,
    featured: this.featured,
    stone: this.stone,
    metal: this.metal,
    /* Exposed as a boolean, not the raw number: the storefront needs to know
       whether an item is available, not how many are on the shelf. */
    inStock: this.availability && (this.stock == null || this.stock > 0),
  };
};

export const Product = mongoose.model('Product', productSchema);
export default Product;
