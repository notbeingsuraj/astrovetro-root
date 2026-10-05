/* -------------------------------------------------------------------------
   Authentication middleware
   -------------------------------------------------------------------------

   One identity mechanism: a signed JWT delivered in an httpOnly cookie.

   Why a cookie rather than the Authorization header: the token is then
   unreachable from JavaScript, so a successful cross-site scripting attack
   cannot read it out of localStorage and replay it. The trade-off is that
   cookie auth needs CSRF protection, which `requireSameOrigin` below provides
   — state-changing requests must carry an origin or content-type that proves
   they came from our own pages.

   `optionalAuth` attaches req.user when a valid token is present and otherwise
   carries on anonymously. It never rejects. That is what lets a signed-in
   customer and a guest reach the same cart and checkout routes.

   Ownership is decided here and nowhere else. No handler reads a userId from a
   request body to decide whose data it is; every query is scoped to req.user._id.
   ------------------------------------------------------------------------- */

import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { User } from '../models/User.js';

export const COOKIE_NAME = 'av_token';

const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax',
  /* Required in production so the cookie is never sent over plain HTTP. Left
     off in development, where the site is served over http://localhost and a
     secure cookie would simply never be sent. */
  secure: env.isProduction,
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/',
});

export function issueToken(res, user) {
  const token = jwt.sign(
    { sub: user._id.toString(), role: user.role, tv: user.tokenVersion || 0 },
    env.jwt.secret,
    {
      expiresIn: env.jwt.expiresIn,
      issuer: env.jwt.issuer,
    }
  );
  res.cookie(COOKIE_NAME, token, cookieOptions());
  return token;
}

export function clearToken(res) {
  /* The options must match those used when setting it, or the browser keeps
     the original cookie. */
  res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
}

const readToken = (req) => {
  const fromCookie = req.cookies?.[COOKIE_NAME];
  if (fromCookie) return fromCookie;
  /* Kept so an API client or the test suite can authenticate with a bearer
     token without a cookie jar. Not a second identity system — same token,
     same verification. */
  const header = req.get('authorization');
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return null;
};

/* Verifies the token and loads the user. A token that is valid but whose user
   has since been deleted resolves to no user rather than throwing, so a stale
   cookie degrades to "signed out" instead of a 500 on every page. */
const resolveUser = async (req) => {
  const token = readToken(req);
  if (!token || !env.jwt.secret) return null;

  let payload;
  try {
    payload = jwt.verify(token, env.jwt.secret, { issuer: env.jwt.issuer });
  } catch {
    return null;
  }

  const user = await User.findById(payload.sub);
  if (!user) return null;

  /* A token issued before the last sign-out carries an older tokenVersion and
     is refused here. This is the revocation that a stateless JWT lacks on its
     own. */
  if ((payload.tv || 0) !== (user.tokenVersion || 0)) return null;

  return user;
};

export const optionalAuth = asyncHandler(async (req, _res, next) => {
  req.user = await resolveUser(req);
  next();
});

export const requireAuth = asyncHandler(async (req, _res, next) => {
  const user = await resolveUser(req);
  if (!user) throw ApiError.unauthorized();
  req.user = user;
  next();
});

export const requireAdmin = asyncHandler(async (req, _res, next) => {
  const user = await resolveUser(req);
  if (!user) throw ApiError.unauthorized();
  if (user.role !== 'admin') throw ApiError.forbidden('That area is for administrators.');
  req.user = user;
  next();
});

/* ── CSRF ──────────────────────────────────────────────────────────────────
   Cookie auth means a third-party page can cause the browser to send a
   credentialed request. These headers are the defence: a cross-origin form
   cannot set them, and a cross-origin fetch that tries is rejected by CORS
   before it reaches here.

   GET/HEAD are exempt — they must be safe, and the API never mutates on them.
   -------------------------------------------------------------------------- */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function requireSameOrigin(req, _res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const fetchSite = req.get('sec-fetch-site');
  if (fetchSite) {
    /* 'same-origin' is sent by our own pages; 'none' by a direct address-bar
       navigation or a bookmark, which cannot be a cross-site POST. */
    if (fetchSite !== 'same-origin' && fetchSite !== 'none') {
      return next(ApiError.forbidden('That request did not come from this site.'));
    }
    return next();
  }

  /* No Sec-Fetch-Site: an older browser or a non-browser client. Fall back to
     comparing Origin, and only then to Referer. If neither is present the
     request is allowed, because command-line clients and the test suite send
     neither and refusing them would break legitimate API use. */
  const origin = req.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== req.get('host')) {
        return next(ApiError.forbidden('That request did not come from this site.'));
      }
    } catch {
      return next(ApiError.forbidden('That request did not come from this site.'));
    }
    return next();
  }

  const referer = req.get('referer');
  if (referer) {
    try {
      if (new URL(referer).host !== req.get('host')) {
        return next(ApiError.forbidden('That request did not come from this site.'));
      }
    } catch {
      return next(ApiError.forbidden('That request did not come from this site.'));
    }
    return next();
  }

  /* No Sec-Fetch-Site, no Origin and no Referer. Only worth allowing when the
     request carries no session to abuse.

     A browser POSTing from a page always sends at least one of the three, so a
     missing Origin here means either a non-browser client or a request stripped
     of its headers — and in the second case, allowing it would hand an attacker a
     way to bypass the check entirely by suppressing the header they cannot
     control. Requests authenticated by a cookie are therefore refused outright. */
  if (req.cookies?.[COOKIE_NAME]) {
    return next(ApiError.forbidden('That request could not be verified as coming from this site.'));
  }

  return next();
}
