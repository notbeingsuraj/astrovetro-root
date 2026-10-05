/* -------------------------------------------------------------------------
   Cart
   -------------------------------------------------------------------------

   The server-authoritative cart. This is the object that replaces the
   localStorage cart: the browser holds an id, never the contents.

   Only `product` and `quantity` are stored. No price, no line total, no
   subtotal — those are computed on every read from the current Product
   document. A cart that persisted its own prices would keep quoting yesterday's
   number after a price change, and a tampered client could write whatever total
   it liked into its own document.

   `user` is unique, which enforces one cart per account at the database level.
   ------------------------------------------------------------------------- */

import mongoose from 'mongoose';

const cartItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, required: true, min: 1, max: 99 },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const cartSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    items: { type: [cartItemSchema], default: [] },
  },
  { timestamps: true }
);

export const Cart = mongoose.model('Cart', cartSchema);
export default Cart;
