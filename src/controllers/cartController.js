/* -------------------------------------------------------------------------
   Cart controller
   -------------------------------------------------------------------------

   Thin HTTP layer over src/services/cartService.js. All of the rules — stock
   checks, merging duplicate lines, recomputing prices from live products —
   live in the service, because the wishlist's "move to bag" needs the same
   behaviour and must not get a second, subtly different implementation.

   No route here reads a user id from the request. Every query is scoped to
   req.user._id, which comes from the verified token and nothing else.

   Prices are recomputed on every response, including a plain GET. That is why a
   repriced product shows its new price in the bag immediately, and why there is
   no stored total for a client to disagree with.
   ------------------------------------------------------------------------- */

import { z } from 'zod';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as cartService from '../services/cartService.js';

/* Integers only: a fractional "1.5 rings" must not survive validation and then
   fail obscurely at order time. */
const quantitySchema = z.coerce
  .number()
  .int('Choose a whole number.')
  .min(1, 'Quantity cannot be less than one.')
  .max(99, 'For quantities above 99 please contact us.');

const addSchema = z.object({
  productId: z.string().min(1, 'Which piece would you like to add?'),
  quantity: quantitySchema.optional().default(1),
});

const updateSchema = z.object({ quantity: quantitySchema });

const validId = (id) => {
  if (!/^[a-f\d]{24}$/i.test(id)) throw ApiError.badRequest('That piece could not be identified.');
  return id;
};

export const getCart = asyncHandler(async (req, res) => {
  res.json({ success: true, data: { cart: await cartService.readCart(req.user._id) } });
});

export const addItem = asyncHandler(async (req, res) => {
  const { productId, quantity } = addSchema.parse(req.body);
  const cart = await cartService.addLine(req.user._id, validId(productId), quantity);
  res.status(201).json({ success: true, data: { cart } });
});

export const updateItem = asyncHandler(async (req, res) => {
  const { quantity } = updateSchema.parse(req.body);
  const cart = await cartService.setLineQuantity(req.user._id, validId(req.params.productId), quantity);
  res.json({ success: true, data: { cart } });
});

export const removeItem = asyncHandler(async (req, res) => {
  const cart = await cartService.removeLine(req.user._id, validId(req.params.productId));
  res.json({ success: true, data: { cart } });
});

export const clearCart = asyncHandler(async (req, res) => {
  res.json({ success: true, data: { cart: await cartService.clearCart(req.user._id) } });
});
