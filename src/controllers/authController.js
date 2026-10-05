/* -------------------------------------------------------------------------
   Auth controller
   -------------------------------------------------------------------------

   Register, sign in, sign out, and who am I.

   Two details worth stating plainly because they are easy to get wrong:

   1. LOGIN IS CONSTANT-TIME WITH RESPECT TO ACCOUNT EXISTENCE. A missing
      account is verified against a dummy hash rather than short-circuiting, so
      the response takes the same time whether or not the email is registered.
      Without that, the endpoint is an account-enumeration oracle.

   2. SIGN-OUT IS SERVER-SIDE. The cookie is cleared, but because a JWT cannot
      be revoked without state, `tokenVersion` on the user is bumped. Any token
      issued before the bump fails verification, so a stolen cookie genuinely
      stops working instead of remaining valid until it expires.

   No endpoint here accepts a userId. Identity comes from the token alone.
   ------------------------------------------------------------------------- */

import { z } from 'zod';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { issueToken, clearToken } from '../middleware/auth.js';
import { DUPLICATE_KEY } from '../middleware/errorHandler.js';

const registerSchema = z.object({
  name: z.string().trim().min(2, 'Enter your name.').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(160),
  password: z
    .string()
    .min(8, 'Use at least 8 characters.')
    .max(200, 'That password is too long.')
    /* Length is what actually matters; a composition rule pushes people
       towards predictable substitutions. */
    .refine((v) => v.trim().length >= 8, 'Use at least 8 characters.'),
  phone: z.string().trim().max(20).optional().default(''),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

export const register = asyncHandler(async (req, res) => {
  const { name, email, password, phone } = registerSchema.parse(req.body);

  const existing = await User.findOne({ email });
  if (existing) {
    /* Deliberately explicit here, unlike login: on sign-up the address is
       already known to the person typing it, and a clear message is better
       service than a generic failure. */
    throw ApiError.conflict('An account already exists with that email address.');
  }

  let user;
  try {
    user = await User.create({ name, email, phone, passwordHash: password });
  } catch (err) {
    /* The unique index is the real guard against two simultaneous signups. */
    if (err?.code === DUPLICATE_KEY) {
      throw ApiError.conflict('An account already exists with that email address.');
    }
    throw err;
  }

  issueToken(res, user);
  return res.status(201).json({
    success: true,
    data: { user: user.toPublic() },
    meta: { tokenVersion: user.tokenVersion },
  });
});

export const login = asyncHandler(async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);

  const user = await User.findOne({ email }).select('+passwordHash');
  /* Always run a bcrypt comparison, even with no account, so the time taken
     does not reveal whether the address is registered. */
  const okPassword = user
    ? await user.verifyPassword(password)
    : await User.verifyAgainstNothing(password);

  /* One message for both "no such account" and "wrong password", and only after
     the password work has been done. */
  if (!user || !okPassword) throw ApiError.unauthorized('That email and password do not match.');

  user.lastLoginAt = new Date();
  await user.save({ validateBeforeSave: false });

  issueToken(res, user);
  return res.json({
    success: true,
    data: { user: user.toPublic() },
    meta: { tokenVersion: user.tokenVersion },
  });
});

export const logout = asyncHandler(async (req, res) => {
  clearToken(res);

  /* Invalidate anything already issued for this account. Without this, signing
     out only removes the local cookie and a copied token stays valid for the
     rest of its life. */
  if (req.user) {
    req.user.tokenVersion = (req.user.tokenVersion || 0) + 1;
    await req.user.save({ validateBeforeSave: false });
  }

  return res.json({ success: true, data: { signedOut: true } });
});

export const me = asyncHandler(async (req, res) =>
  res.json({ success: true, data: { user: req.user.toPublic() } })
);
