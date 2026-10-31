/* -------------------------------------------------------------------------
   Ritual
   -------------------------------------------------------------------------

   Editorial ritual content: a name, what it is for, what you need, and the
   steps. Stored as structure, not as HTML. That is the safety decision:

     - the admin editor produces arrays of strings and step objects;
     - the model refuses rich-text blobs outright, so no stored value can ever
       contain a <script> for a public page to execute;
     - the public pages render each field as text, never as innerHTML.

   A ritual is content. It is not an inventory item and never decrements stock.
   If a ritual is also sold (a reading, a kit), `linkedProduct` points at the
   existing Product document. The relationship is explicit and one-way, so the
   same thing is not duplicated as both a ritual and a product.

   Lifecycle matches products: draft -> active -> archived. Only `active`
   reaches the public API, and publishing sets `publishedAt` once.
   ------------------------------------------------------------------------- */

import mongoose from 'mongoose';

const stepSchema = new mongoose.Schema(
  {
    title: { type: String, default: '', maxlength: 160 },
    body: { type: String, required: true, maxlength: 4000 },
  },
  { _id: false }
);

const ritualSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 160 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    previousSlugs: { type: [String], default: [] },

    intro: { type: String, default: '', maxlength: 500 },
    description: { type: String, default: '', maxlength: 6000 },
    purpose: { type: String, default: '', maxlength: 160 },
    preparation: { type: String, default: '', maxlength: 2000 },
    duration: { type: String, default: '', maxlength: 80 },

    materials: { type: [String], default: [] },
    steps: { type: [stepSchema], default: [] },

    images: { type: [String], default: [] },
    imageAlts: { type: [String], default: [] },

    relatedProducts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
    relatedCollections: { type: [String], default: [] },
    linkedProduct: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },

    tags: { type: [String], default: [] },
    featured: { type: Boolean, default: false, index: true },

    status: { type: String, enum: ['draft', 'active', 'archived'], default: 'draft', index: true },
    publishedAt: { type: Date, default: null },

    seoTitle: { type: String, default: '', maxlength: 70 },
    seoDescription: { type: String, default: '', maxlength: 170 },
  },
  { timestamps: true }
);

ritualSchema.index({ status: 1, featured: -1, publishedAt: -1 });
ritualSchema.index({ title: 'text', intro: 'text', description: 'text' });

/* Public shape. Related products are passed in by the provider already
   serialised for the storefront, so this method never reaches into another
   collection. */
ritualSchema.methods.toPublic = function toPublic({ relatedProducts = [], linkedProduct = null } = {}) {
  return {
    id: this._id.toString(),
    slug: this.slug,
    title: this.title,
    intro: this.intro,
    description: this.description,
    purpose: this.purpose,
    preparation: this.preparation,
    duration: this.duration,
    materials: this.materials,
    steps: this.steps.map((s) => ({ title: s.title, body: s.body })),
    images: this.images,
    imageAlts: this.imageAlts,
    tags: this.tags,
    featured: this.featured,
    publishedAt: this.publishedAt,
    seoTitle: this.seoTitle,
    seoDescription: this.seoDescription,
    relatedProducts,
    linkedProduct,
  };
};

ritualSchema.methods.toAdmin = function toAdmin({ relatedProducts = [], linkedProduct = null, collections = [] } = {}) {
  return {
    ...this.toPublic({ relatedProducts, linkedProduct }),
    status: this.status,
    previousSlugs: this.previousSlugs,
    relatedCollections: this.relatedCollections,
    collections,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

export const Ritual = mongoose.model('Ritual', ritualSchema);
export default Ritual;
