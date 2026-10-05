/* -------------------------------------------------------------------------
   Wishlist
   -------------------------------------------------------------------------

   Saved pieces, per account.

   The unique index on `{ user, items.product }` below is what prevents
   duplicates: a second POST of the same product fails on the index rather than
   relying on a read-then-write check that two concurrent requests could both
   pass. The route treats that specific duplicate-key error as an idempotent
   success, so double-tapping "save" is harmless.

   Products are referenced, never copied. A wishlist entry resolves to the live
   Product, so a price change or a renamed piece is reflected immediately —
   which is the opposite of how orders behave, and deliberately so.
   ------------------------------------------------------------------------- */

import mongoose from 'mongoose';

const itemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const wishlistSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    items: { type: [itemSchema], default: [] },
  },
  { timestamps: true }
);

/* Uniqueness is per user AND per product, and both halves are required.

   A bare `index({ product: 1 }, { unique: true })` on the subdocument is a
   collection-wide constraint, which is wrong twice over:
     - every EMPTY wishlist stores items.product as null, so the second customer
       to create a wishlist collides on null and the request fails with E11000;
     - two different customers saving the same piece would be rejected, since the
       index has no user in it.

   So the key is the pair, and `partialFilterExpression` keeps documents with no
   items out of the index entirely — an empty wishlist is not a duplicate of
   anything, and must not be treated as one. */
wishlistSchema.index(
  { user: 1, 'items.product': 1 },
  {
    unique: true,
    partialFilterExpression: { 'items.0': { $exists: true } },
  }
);

export const Wishlist = mongoose.model('Wishlist', wishlistSchema);
export default Wishlist;
