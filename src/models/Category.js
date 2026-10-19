/* -------------------------------------------------------------------------
   Category
   -------------------------------------------------------------------------

   The list of product categories, made manageable so an administrator can add
   or retire a category without a code deploy. Product.category stores the
   category `slug`; the storefront's filter is `?category=<slug>`, which keeps
   working unchanged.

   Seeded from the enum the Product schema used to enforce (see
   src/db/seed.js), so the shop's existing filter links behave identically
   before and after. Deactivating a category hides it from new product forms
   but never touches products already filed under it.
   ------------------------------------------------------------------------- */

import mongoose from 'mongoose';

const categorySchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    active: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const Category = mongoose.model('Category', categorySchema);
export default Category;
