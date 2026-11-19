/* -------------------------------------------------------------------------
   Validation and rate limiting
   -------------------------------------------------------------------------

   `validate(schema, source)` parses and *replaces* the named part of the
   request with the parsed result. Replacing rather than merely checking is the
   important part: handlers then read coerced, trimmed, defaulted values and can
   trust their types. Without it, `quantity` arrives as the string "3" and
   arithmetic quietly concatenates.

   Rate limiters are initialized at server startup via initializeRateLimiters()
   in server.js. They use a distributed Redis store (Upstash) in production,
   falling back to in-memory store in development.
   ------------------------------------------------------------------------- */

import { ZodError } from 'zod';
import { ApiError } from '../utils/ApiError.js';
import { getAuthLimiter, getSignupLimiter, getCheckoutLimiter, getWriteLimiter } from './rateLimitStore.js';

export const validate = (schema, source = 'body') => (req, _res, next) => {
  try {
    const parsed = schema.parse(req[source]);
    /* req.query and req.params are getter-only on some Express versions, so the
       parsed query is stashed for handlers rather than assigned in place. */
    if (source === 'query') req.validatedQuery = parsed;
    else req[source] = parsed;
    next();
  } catch (err) {
    if (err instanceof ZodError) return next(err);
    return next(err);
  }
};

/* Credential endpoints: tight, because this is where password guessing pays
   off. 10 attempts per 15 minutes is enough for a real customer and useless
   for an attack. */
export const authLimiter = getAuthLimiter();

export const signupLimiter = getSignupLimiter();

/* Order creation gets its own, looser limit: it is the one route a legitimate
   customer may retry after a slow payment, and it is already protected by the
   idempotency key, so a double submit cannot create two orders anyway. */
export const checkoutLimiter = getCheckoutLimiter();

export const writeLimiter = getWriteLimiter();

/* ── Shared field schemas ───────────────────────────────────────────────────
   Defined once because the same address shape is validated when saving an
   address and when checking out, and the two must not drift apart.
   -------------------------------------------------------------------------- */

export const objectId = (label = 'id') =>
  ApiError.badRequest(`${label} is not a valid identifier.`);

export const addressFields = {
  name: (z) => z.string().trim().min(2, 'Enter the recipient name.').max(120),
  phone: (z) =>
    z
      .string()
      .trim()
      .regex(/^[0-9+\-\s()]{7,20}$/, 'Enter a contact number we can reach you on.')
      .optional()
      .default(''),
  line1: (z) => z.string().trim().min(4, 'Enter the street address.').max(200),
  line2: (z) => z.string().trim().max(200).optional().default(''),
  city: (z) => z.string().trim().min(2, 'Enter the city.').max(100),
  state: (z) => z.string().trim().max(100).optional().default(''),
  pincode: (z) => z.string().trim().regex(/^[0-9]{6}$/, 'Enter a six-digit PIN code.'),
  country: (z) => z.string().trim().max(100).optional().default('India'),
};

export { ApiError };