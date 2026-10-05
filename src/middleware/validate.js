/* -------------------------------------------------------------------------
   Validation and rate limiting
   -------------------------------------------------------------------------

   `validate(schema, source)` parses and *replaces* the named part of the
   request with the parsed result. Replacing rather than merely checking is the
   important part: handlers then read coerced, trimmed, defaulted values and can
   trust their types. Without it, `quantity` arrives as the string "3" and
   arithmetic quietly concatenates.

   `rateLimit` is a thin wrapper over express-rate-limit so every limiter in the
   project is configured and keyed identically. The auth limiter is deliberately
   much tighter than the general one — it is the only route where guessing is
   worth attempting.
   ------------------------------------------------------------------------- */

import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { ZodError } from 'zod';
import { ApiError } from '../utils/ApiError.js';

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

const limiter = ({ windowMs, max, message, code }) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    /* Keyed by user where there is one, so one customer cannot exhaust the
       allowance of everyone behind the same NAT or office IP.

       The IP half must go through `ipKeyGenerator`: a raw req.ip on IPv6 is a
       /64 subnet, so without it every customer on the same network shares — or
       evades — a single bucket. */
    keyGenerator: (req) => req.user?._id?.toString() || ipKeyGenerator(req.ip),
    handler: (_req, res) =>
      res.status(429).json({
        success: false,
        message,
        error: { code, message },
      }),
  });

/* Credential endpoints: tight, because this is where password guessing pays
   off. 10 attempts per 15 minutes is enough for a real customer and useless
   for an attack. */
export const authLimiter = limiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many attempts. Please wait a few minutes and try again.',
  code: 'RATE_LIMITED',
});

export const signupLimiter = limiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: 'Too many accounts created from this connection. Please try again later.',
  code: 'RATE_LIMITED',
});

/* Order creation gets its own, looser limit: it is the one route a legitimate
   customer may retry after a slow payment, and it is already protected by the
   idempotency key, so a double submit cannot create two orders anyway. */
export const checkoutLimiter = limiter({
  windowMs: 10 * 60 * 1000,
  max: 30,
  message: 'Too many checkout attempts. Please wait a moment.',
  code: 'RATE_LIMITED',
});

export const writeLimiter = limiter({
  windowMs: 60 * 1000,
  max: 120,
  message: 'Slow down a moment.',
  code: 'RATE_LIMITED',
});

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
