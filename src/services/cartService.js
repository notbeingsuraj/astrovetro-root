/* -------------------------------------------------------------------------
   Cart service
   -------------------------------------------------------------------------

   The cart operations, as plain functions over a user id.

   These exist separately from the HTTP layer because two different routes need
   the same behaviour: adding a line from the product page, and moving a line
   from the wishlist. When the wishlist controller called the cart *controller*
   it would inherit its response handling and try to send a second set of
   headers, so the shared logic lives here where it can be called for its result
   instead of for its side effects.

   Controllers own the HTTP. This file owns the rules.
   ------------------------------------------------------------------------- */

import { Cart } from '../models/Cart.js';
import { Product } from '../models/Product.js';
import { ApiError } from '../utils/ApiError.js';
import { priceCart, cartPayload } from './pricing.js';
import { DUPLICATE_KEY } from '../middleware/errorHandler.js';

/** The caller's cart with products populated, priced. Used by every response. */
export async function readCart(userId) {
  const cart = await Cart.findOne({ user: userId }).populate('items.product');
  if (!cart) return cartPayload(priceCart([]));

  /* Prune lines whose product has been deleted from the catalogue, so the
     stored cart cannot accumulate references that can never be priced. */
  const live = cart.items.filter((i) => i.product);
  if (live.length !== cart.items.length) {
    cart.items = live;
    await cart.save();
  }

  return cartPayload(priceCart(cart.items.map((i) => ({ product: i.product, quantity: i.quantity }))));
}

/** Find or create the single cart for this account. */
export async function getOrCreateCart(userId) {
  const existing = await Cart.findOne({ user: userId });
  if (existing) return existing;
  try {
    return await Cart.create({ user: userId, items: [] });
  } catch (err) {
    /* Lost a race with a concurrent create. The unique index on `user` is what
       guarantees there is only ever one cart, so the loser simply re-reads. */
    if (err?.code === DUPLICATE_KEY) return Cart.findOne({ user: userId });
    throw err;
  }
}

/** How many pieces are in the bag. Cheap enough for the header on every page. */
export async function cartCount(userId) {
  const cart = await Cart.findOne({ user: userId }).select('items');
  if (!cart) return 0;
  return cart.items.reduce((n, i) => n + i.quantity, 0);
}

/**
 * Add `quantity` of a product, merging into an existing line.
 *
 * Stock is validated against the *combined* quantity, not the increment: adding
 * 2 to a bag that already holds 3 of a 4-in-stock item must fail, even though
 * each individual request would have passed.
 *
 * @returns {Promise<object>} the authoritative, priced cart
 */
export async function addLine(userId, productId, quantity = 1) {
  const product = await Product.findById(productId);
  if (!product) throw ApiError.notFound('We could not find that piece.');
  if (!product.availability) throw ApiError.conflict(`${product.name} is no longer available.`);

  const cart = await getOrCreateCart(userId);
  const line = cart.items.find((i) => i.product.toString() === String(productId));
  const wanted = (line?.quantity || 0) + quantity;

  if (!product.canFulfil(wanted)) {
    throw ApiError.outOfStock(
      product.stock == null
        ? `${product.name} is not available in that quantity.`
        : `Only ${product.stock} of ${product.name} ${product.stock === 1 ? 'is' : 'are'} left.`
    );
  }

  if (line) line.quantity = wanted;
  else cart.items.push({ product: product._id, quantity });

  await cart.save();
  return readCart(userId);
}

/** Set an absolute quantity. Rejects rather than clamping, so the customer is
    told what is actually available instead of silently getting less. */
export async function setLineQuantity(userId, productId, quantity) {
  const cart = await Cart.findOne({ user: userId });
  const line = cart?.items.find((i) => i.product.toString() === String(productId));
  /* Scoped to this user's cart: another account's line is "not found" rather
     than something that can be read or changed. */
  if (!line) throw ApiError.notFound('That piece is not in your bag.');

  const product = await Product.findById(line.product);
  if (!product) throw ApiError.notFound('That piece is no longer available.');

  if (!product.canFulfil(quantity)) {
    throw ApiError.outOfStock(
      product.stock == null
        ? `${product.name} is not available in that quantity.`
        : `Only ${product.stock} of ${product.name} ${product.stock === 1 ? 'is' : 'are'} left.`
    );
  }

  line.quantity = quantity;
  await cart.save();
  return readCart(userId);
}

export async function removeLine(userId, productId) {
  const cart = await Cart.findOne({ user: userId });
  if (!cart) throw ApiError.notFound('That piece is not in your bag.');

  const before = cart.items.length;
  cart.items = cart.items.filter((i) => i.product.toString() !== String(productId));
  if (cart.items.length === before) throw ApiError.notFound('That piece is not in your bag.');

  await cart.save();
  return readCart(userId);
}

export async function clearCart(userId) {
  await Cart.findOneAndUpdate({ user: userId }, { $set: { items: [] } }, { new: true });
  return readCart(userId);
}
