/* -------------------------------------------------------------------------
   Wishlist controller
   -------------------------------------------------------------------------

   Saved pieces per account.

   Duplicate prevention is enforced by the unique index on the embedded items,
   not by reading the list first. A check-then-insert has a window between the
   two operations in which two rapid taps both pass and both insert; the index
   cannot be raced. The duplicate-key error is then treated as success, so the
   customer's second tap is harmless and the response is still the saved list.

   "Move to bag" is deliberately two calls rather than one clever endpoint: it
   adds to the cart, and only removes the wishlist entry if that add actually
   succeeded. If the piece has sold out, the customer keeps it saved instead of
   losing it from both lists.
   ------------------------------------------------------------------------- */

import { z } from 'zod';
import { Wishlist } from '../models/Wishlist.js';
import { Cart } from '../models/Cart.js';
import { Product } from '../models/Product.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { addLine } from '../services/cartService.js';
import { DUPLICATE_KEY } from '../middleware/errorHandler.js';

const productIdSchema = z.string().min(1, 'Which piece would you like to save?');

const moveSchema = z.object({
  quantity: z.coerce.number().int().min(1).max(99).optional().default(1),
});

/* A malformed id is rejected before it reaches the database, where it would
   otherwise surface as a CastError and a confusing 500. */
const validId = (id) => {
  if (!/^[a-f\d]{24}$/i.test(id)) throw ApiError.badRequest('That piece could not be identified.');
  return id;
};

/* Read the product id out of a route parameter.

   The route is `/:productId`, so req.params.productId is the value — NOT
   req.params, which is the whole parameter object. Validating req.params against
   a string schema fails every time with "expected string, received object", which
   is what made wishlist add and move-to-cart return 422 on every call. */
const paramProductId = (req) => validId(productIdSchema.parse(req.params.productId));

async function getOrCreateWishlist(userId) {
  const existing = await Wishlist.findOne({ user: userId });
  if (existing) return existing;
  try {
    return await Wishlist.create({ user: userId, items: [] });
  } catch (err) {
    if (err?.code === DUPLICATE_KEY) return Wishlist.findOne({ user: userId });
    throw err;
  }
}

/* Wishlist entries resolve to live products, so a price change or a rename is
   reflected at once. This is the opposite of orders, which snapshot, and the
   difference is intentional: a wishlist is a current intention, an order is a
   historical fact. */
async function readWishlist(userId) {
  const list = await Wishlist.findOne({ user: userId }).populate('items.product');
  if (!list) return { items: [], count: 0 };

  const live = list.items.filter((i) => i.product);
  if (live.length !== list.items.length) {
    list.items = live;
    await list.save();
  }

  return {
    items: live
      .map((i) => ({
        productId: i.product._id.toString(),
        slug: i.product.slug,
        name: i.product.name,
        image: i.product.images?.[0] || null,
        price: i.product.effectivePrice(),
        shortDescription: i.product.shortDescription,
        availability: i.product.availability,
        inStock: i.product.availability && (i.product.stock == null || i.product.stock > 0),
        addedAt: i.addedAt,
      }))
      .sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt)),
    count: live.length,
  };
}

export const getWishlist = asyncHandler(async (req, res) => {
  res.json({ success: true, data: { wishlist: await readWishlist(req.user._id) } });
});

export const addToWishlist = asyncHandler(async (req, res) => {
  const productId = paramProductId(req);

  const product = await Product.findById(productId);
  if (!product) throw ApiError.notFound('We could not find that piece.');

  const wishlist = await getOrCreateWishlist(req.user._id);

  if (wishlist.items.some((i) => i.product.toString() === productId)) {
    /* Already saved. Idempotent success rather than an error, so the button can
       be pressed twice without the second press looking like a failure. */
    return res.json({ success: true, data: { wishlist: await readWishlist(req.user._id), alreadySaved: true } });
  }

  try {
    wishlist.items.push({ product: product._id });
    await wishlist.save();
  } catch (err) {
    /* Lost a race with a concurrent identical save. Same outcome as above. */
    if (err?.code !== DUPLICATE_KEY) throw err;
  }

  return res.status(201).json({ success: true, data: { wishlist: await readWishlist(req.user._id) } });
});

export const removeFromWishlist = asyncHandler(async (req, res) => {
  /* Validated the same way as the other two, so an unsave of a malformed id is a
     clean 400 rather than a silent no-op that looks like it worked. */
  const productId = paramProductId(req);
  const wishlist = await Wishlist.findOne({ user: req.user._id });
  if (!wishlist) throw ApiError.notFound('That piece is not in your saved list.');

  const before = wishlist.items.length;
  wishlist.items = wishlist.items.filter((i) => i.product.toString() !== productId);
  if (wishlist.items.length === before) throw ApiError.notFound('That piece is not in your saved list.');

  await wishlist.save();
  res.json({ success: true, data: { wishlist: await readWishlist(req.user._id) } });
});

/* Add to the bag, and only unsave if the add worked.

   Implemented as two steps against the cart *service*, not the cart
   controller: addLine throws on invalid product, unavailable or insufficient
   stock, so reaching the line after it means the piece is genuinely in the bag
   and it is safe to remove from the wishlist. If the add fails, the customer
   keeps the saved item instead of losing it from both lists. */
export const moveToCart = asyncHandler(async (req, res) => {
  const id = paramProductId(req);
  const { quantity } = moveSchema.parse(req.body ?? {});

  const cart = await addLine(req.user._id, id, quantity);

  const wishlist = await Wishlist.findOne({ user: req.user._id });
  if (wishlist) {
    wishlist.items = wishlist.items.filter((i) => i.product.toString() !== id);
    await wishlist.save();
  }

  return res.json({
    success: true,
    data: {
      cart,
      wishlist: await readWishlist(req.user._id),
      moved: true,
      message: 'Moved to your bag.',
    },
  });
});
