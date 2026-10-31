/* -------------------------------------------------------------------------
   Collection
   -------------------------------------------------------------------------

   A merchandising grouping (as opposed to a Category, which is a taxonomy).
   "Gifts under ₹1,000", "The grounding edit" and "New arrivals" are
   collections; "ring", "tower" and "bracelet" are categories.

   Products are referenced by ObjectId in one place only — here. The product
   document deliberately does not keep a second copy of its collection
   memberships, because two lists that can disagree are worse than one list
   that is a join away. The admin product endpoint joins this collection when
   it needs to show which collections a product belongs to.

   Archiving keeps history and public links working. Deleting is refused while
   any product still points at the collection, so a catalogue cannot be
   orphaned by an accidental click.
   ------------------------------------------------------------------------- */

import mongoose from 'mongoose';

const collectionSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: '', maxlength: 2000 },
    image: { type: String, default: '' },
    products: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],

    sortOrder: { type: Number, default: 0 },
    active: { type: Boolean, default: true, index: true },
    featured: { type: Boolean, default: false, index: true },

    seoTitle: { type: String, default: '', maxlength: 70 },
    seoDescription: { type: String, default: '', maxlength: 170 },
  },
  { timestamps: true }
);

collectionSchema.index({ active: 1, sortOrder: 1, name: 1 });

/* Public shape. The product count and cover image are resolved by the provider
   so the storefront never lists an empty collection as if it had stock. */
collectionSchema.methods.toPublic = function toPublic(productCount = null) {
  return {
    id: this._id.toString(),
    slug: this.slug,
    name: this.name,
    description: this.description,
    image: this.image || null,
    featured: Boolean(this.featured),
    productCount,
  };
};

collectionSchema.methods.toAdmin = function toAdmin() {
  return {
    id: this._id.toString(),
    slug: this.slug,
    name: this.name,
    description: this.description,
    image: this.image || '',
    products: (this.products || []).map((id) => id.toString()),
    productCount: (this.products || []).length,
    sortOrder: this.sortOrder,
    active: this.active,
    featured: this.featured,
    seoTitle: this.seoTitle,
    seoDescription: this.seoDescription,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

export const Collection = mongoose.model('Collection', collectionSchema);
export default Collection;
