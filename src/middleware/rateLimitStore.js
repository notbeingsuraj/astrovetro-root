/* -------------------------------------------------------------------------
   Distributed rate limit store
   -------------------------------------------------------------------------

   Provides a Redis-backed store for express-rate-limit using Upstash Redis
   (HTTP-based, works in serverless/edge environments). Falls back to
   in-memory store in development when Redis is not configured.

   Production on Vercel: set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN
   in Vercel environment variables.

   Test mode: set DISABLE_RATE_LIMIT=true to disable all rate limiting
   (for automated testing only — never enable in production).

   This module uses top-level await to initialize the store and limiters.
   Import it early in server.js to ensure initialization happens at startup.
   ------------------------------------------------------------------------- */

import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

/* Check if rate limiting should be disabled (test mode only). */
const isRateLimitDisabled = process.env.DISABLE_RATE_LIMIT === 'true';

/* Create a no-op limiter that allows all requests (for test mode). */
function createNoOpLimiter() {
  return (_req, _res, next) => next();
}

/* Create a rate limit store compatible with express-rate-limit.
   In production with Upstash credentials, uses distributed Redis store.
   In development without credentials, falls back to in-memory store (default). */
async function createRateLimitStoreInternal() {
  // Test mode: disable rate limiting entirely
  if (isRateLimitDisabled) {
    console.log('[rate-limit] DISABLED (test mode)');
    return undefined;
  }

  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  // In production, Redis is required for distributed rate limiting
  if (process.env.NODE_ENV === 'production') {
    if (!redisUrl || !redisToken) {
      console.warn('[rate-limit] UPSTASH_REDIS_REST_URL/TOKEN not set in production — falling back to in-memory store (NOT distributed across instances)');
      return undefined; // express-rate-limit will use default in-memory store
    }

    try {
      // Dynamic import to avoid bundling issues when not used
      const { Ratelimit } = await import('@upstash/ratelimit');
      const { Redis } = await import('@upstash/redis');

      const redis = new Redis({
        url: redisUrl,
        token: redisToken,
      });

      // Create a store adapter for express-rate-limit
      // express-rate-limit expects a store with: increment(key), decrement(key), resetKey(key)
      const upstashStore = {
        async increment(key) {
          const current = await redis.incr(`rl:${key}`);
          if (current === 1) {
            // Set expiry on first request (15 minutes default window)
            await redis.expire(`rl:${key}`, 60 * 15);
          }
          const ttl = await redis.ttl(`rl:${key}`);
          return {
            totalHits: current,
            resetTime: Date.now() + (ttl > 0 ? ttl * 1000 : 15 * 60 * 1000),
          };
        },
        async decrement(key) {
          const current = await redis.decr(`rl:${key}`);
          return { totalHits: Math.max(0, current) };
        },
        async resetKey(key) {
          await redis.del(`rl:${key}`);
        },
      };

      console.log('[rate-limit] Using Upstash Redis distributed store');
      return upstashStore;
    } catch (err) {
      console.error('[rate-limit] Failed to initialize Upstash Redis store:', err.message);
      console.warn('[rate-limit] Falling back to in-memory store');
      return undefined;
    }
  }

  // Development: use in-memory store (default)
  console.log('[rate-limit] Using in-memory store (development)');
  return undefined;
}

/* Initialize store and create limiters at module load time (top-level await). */
const storePromise = createRateLimitStoreInternal();

async function createRateLimiter(options) {
  // Test mode: return no-op limiter
  if (isRateLimitDisabled) {
    return createNoOpLimiter();
  }
  
  const store = await storePromise;
  return rateLimit({
    windowMs: options.windowMs || 15 * 60 * 1000,
    max: options.max || 100,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: options.keyGenerator || ((req) => req.ip),
    handler: options.handler || ((_req, res) =>
      res.status(429).json({
        success: false,
        message: options.message || 'Too many requests, please try again later.',
        error: { code: options.code || 'RATE_LIMITED', message: options.message || 'Too many requests, please try again later.' },
      })),
    skipSuccessfulRequests: options.skipSuccessfulRequests || false,
    skipFailedRequests: options.skipFailedRequests || false,
    store,
  });
}

/* Pre-configured limiters matching the existing validate.js patterns. */
export const authLimiterPromise = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: 'Too many attempts. Please wait a few minutes and try again.',
  code: 'RATE_LIMITED',
  keyGenerator: (req) => req.user?._id?.toString() || ipKeyGenerator(req.ip),
});

export const signupLimiterPromise = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: 'Too many accounts created from this connection. Please try again later.',
  code: 'RATE_LIMITED',
  keyGenerator: (req) => ipKeyGenerator(req.ip),
});

export const checkoutLimiterPromise = createRateLimiter({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 30,
  message: 'Too many checkout attempts. Please wait a moment.',
  code: 'RATE_LIMITED',
  keyGenerator: (req) => req.user?._id?.toString() || ipKeyGenerator(req.ip),
});

export const writeLimiterPromise = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 120,
  message: 'Slow down a moment.',
  code: 'RATE_LIMITED',
  keyGenerator: (req) => req.user?._id?.toString() || ipKeyGenerator(req.ip),
});

/* Synchronous accessors that throw if not yet initialized.
   In practice, these are imported after server.js startup which awaits initialization. */
let _authLimiter = null;
let _signupLimiter = null;
let _checkoutLimiter = null;
let _writeLimiter = null;

export function getAuthLimiter() {
  if (!_authLimiter) throw new Error('authLimiter not initialized — ensure server.js awaits initialization');
  return _authLimiter;
}
export function getSignupLimiter() {
  if (!_signupLimiter) throw new Error('signupLimiter not initialized — ensure server.js awaits initialization');
  return _signupLimiter;
}
export function getCheckoutLimiter() {
  if (!_checkoutLimiter) throw new Error('checkoutLimiter not initialized — ensure server.js awaits initialization');
  return _checkoutLimiter;
}
export function getWriteLimiter() {
  if (!_writeLimiter) throw new Error('writeLimiter not initialized — ensure server.js awaits initialization');
  return _writeLimiter;
}

/* Initialize all limiters and store them for synchronous access.
   Call this once at server startup. */
export async function initializeRateLimiters() {
  _authLimiter = await authLimiterPromise;
  _signupLimiter = await signupLimiterPromise;
  _checkoutLimiter = await checkoutLimiterPromise;
  _writeLimiter = await writeLimiterPromise;
  console.log('[rate-limit] All limiters initialized');
  return { authLimiter: _authLimiter, signupLimiter: _signupLimiter, checkoutLimiter: _checkoutLimiter, writeLimiter: _writeLimiter };
}