/* -------------------------------------------------------------------------
   Account controller
   -------------------------------------------------------------------------

   The `/api/me` aggregate behind the account overview, plus profile edits.

   One endpoint returns everything the overview needs — counts, the most recent
   order, the default address — because a dashboard that fires five requests to
   draw one screen is five chances to render a half-populated page.

   Every number here is counted in the database. None is derived from anything
   the browser sent, and none is cached on the client, so the overview cannot
   disagree with the pages it links to.

   On email changes: the address is not switched immediately. It is stored as
   `pendingEmail` and the account keeps working on the old address until the
   change is confirmed through an email round-trip. Silently changing the email
   on a logged-in session is how accounts get taken over — a shared or hijacked
   session would otherwise be able to lock the real owner out permanently by
   changing the address they log in with.
   ------------------------------------------------------------------------- */

import { z } from 'zod';
import { Order, PAYMENT_METHOD, PAYMENT_STATUS, SHIPPED_STATUSES } from '../models/Order.js';
import { User } from '../models/User.js';
import { Address } from '../models/Address.js';
import { Wishlist } from '../models/Wishlist.js';
import { Cart } from '../models/Cart.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const getAccountSummary = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  /* Everything is independent, so it is fetched concurrently rather than in
     sequence — one round trip's latency instead of five. */
  const [orderCount, activeCount, wishlistCount, cartCount, defaultAddress, latestOrder] =
    await Promise.all([
      Order.countDocuments({ user: userId }),
      Order.countDocuments({ user: userId, status: { $in: SHIPPED_STATUSES } }),
      Wishlist.countDocuments({ user: userId }),
      Cart.countDocuments({ user: userId }),
      Address.findOne({ user: userId, isDefault: true }),
      Order.findOne({
        user: userId,
        /* Same filter as the order list, so the "latest order" on the overview
           is one that actually appears in order history. */
        $or: [{ paymentMethod: PAYMENT_METHOD.COD }, { paymentStatus: { $ne: PAYMENT_STATUS.PENDING } }],
      })
        .sort({ createdAt: -1 })
        .lean(),
    ]);

  /* Whether the cart holds anything, without counting lines twice. */
  const cart = cartCount
    ? await Cart.findOne({ user: userId }).select('items').lean()
    : null;
  const bagCount = cart ? cart.items.reduce((n, i) => n + i.quantity, 0) : 0;

  res.json({
    success: true,
    data: {
      user: req.user.toPublic(),
      counts: {
        orders: orderCount,
        /* "On the way" — anything that has left but not arrived. */
        inTransit: activeCount,
        wishlist: wishlistCount,
        bag: bagCount,
      },
      defaultAddress: defaultAddress ? defaultAddress.toPublic() : null,
      addressCount: await Address.countDocuments({ user: userId }),
      latestOrder: latestOrder
        ? {
            orderNumber: latestOrder.orderNumber,
            createdAt: latestOrder.createdAt,
            status: latestOrder.status,
            paymentStatus: latestOrder.paymentStatus,
            total: latestOrder.total,
            currency: latestOrder.currency,
            itemCount: latestOrder.items.reduce((n, i) => n + i.quantity, 0),
            /* Drives the "Track order" button: no point offering tracking for
               an order that has not shipped. */
            trackable: SHIPPED_STATUSES.includes(latestOrder.status),
          }
        : null,
      /* Drives the navigation entries the reference shows. */
      pendingEmail: req.user.pendingEmail || null,
    },
  });
});

const updateProfileSchema = z.object({
  name: z.string().trim().min(2, 'Enter your name.').max(120).optional(),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9+\-\s()]{7,20}$/, 'Enter a contact number we can reach you on.')
    .optional()
    .or(z.literal('')),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').optional(),
});

export const updateProfile = asyncHandler(async (req, res) => {
  const body = updateProfileSchema.parse(req.body);
  const user = req.user;

  if (body.name !== undefined) user.name = body.name;
  if (body.phone !== undefined) user.phone = body.phone;

  if (body.email !== undefined && body.email !== user.email) {
    const taken = await emailInUse(body.email, user._id);
    if (taken) throw ApiError.conflict('Another account already uses that email address.');

    /* Held, not applied. See the file header for why an email change cannot be
       applied directly on a live session. */
    user.pendingEmail = body.email;
  }

  await user.save();
  res.json({ success: true, data: { user: user.toPublic(), pendingEmail: user.pendingEmail || null } });
});

/* True when another account already holds that address. The exclusion is by id
   so saving your own unchanged email is not treated as a collision. */
async function emailInUse(email, excludeId) {
  const found = await User.findOne({ email }).select('_id').lean();
  return Boolean(found && found._id.toString() !== excludeId.toString());
}

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.'),
  newPassword: z.string().min(8, 'Use at least 8 characters.').max(200),
});

export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);

  /* Loaded with the hash, which is `select: false` by default precisely so it
     has to be requested deliberately. */
  const user = await User.findById(req.user._id).select('+passwordHash');

  if (!(await user.verifyPassword(currentPassword))) {
    throw ApiError.badRequest('That is not your current password.');
  }

  user.passwordHash = newPassword;
  await user.save();

  /* Every existing token is invalidated, so a session stolen before the change
     stops working the moment the owner resets their password. */
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save({ validateBeforeSave: false });

  res.json({ success: true, data: { changed: true, message: 'Your password has been changed. Please sign in again.' } });
});

export const deleteAccount = asyncHandler(async (req, res) => {
  throw ApiError.conflict(
    'Account deletion is handled by our team so that past orders stay intact. Please contact us and we will help.'
  );
});
