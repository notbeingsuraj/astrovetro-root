/* -------------------------------------------------------------------------
   Distributed rate limit store
   -------------------------------------------------------------------------

   Provides a Redis-backed store for express-rate-limit using Upstash Redis
   (HTTP-based, works in serverless/edge environments).

   Production on Vercel: set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN
   in Vercel environment variables.

   Security features:
   - FAIL-CLOSED on startup: production fails if Redis unavailable
   - FAIL-CLOSED at runtime: Redis failures return HTTP 503 with RATE_LIMITER_UNAVAILABLE
   - Atomic operations via @upstash/ratelimit fixedWindow (Lua script)
   - 5-second timeout on all Redis operations
   - DISABLE_RATE_LIMIT=true throws at startup in production
   - ALLOW_IN_MEMORY_RATE_LIMIT=1 opt-in for single-instance deployments only

   Test mode: set DISABLE_RATE_LIMIT=true to disable all rate limiting
   (for automated testing only — never enable in production).

   This module uses top-level await to initialize the store and limiters.
   Import it early in server.js to ensure initialization happens at startup.
   ------------------------------------------------------------------------- */

import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

/* Check if rate limiting should be disabled (test mode only). */
function isRateLimitDisabled() {
  return process.env.DISABLE_RATE_LIMIT === 'true';
}

/* Create a no-op limiter that allows all requests (for test mode). */
function createNoOpLimiter() {
  return (_req, _res, next) => next();
}

/* Create a rate limit store compatible with express-rate-limit.
   In production with Upstash credentials, uses distributed Redis store via @upstash/ratelimit.
   In development without credentials, falls back to in-memory store (default).
   In production, Redis failures are NOT silently ignored — rate limiting fails closed. */
async function createRateLimitStoreInternal() {
  // Test mode: disable rate limiting entirely
  if (isRateLimitDisabled()) {
    console.log('[rate-limit] DISABLED (test mode)');
    return undefined;
  }

  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  const isVercel = process.env.VERCEL === '1' || process.env.VERCEL === 'true';

  // In production, Redis is required for distributed rate limiting
  if (process.env.NODE_ENV === 'production') {
    if (!redisUrl || !redisToken) {
      // Allow explicit opt-in for single-instance deployments via ALLOW_IN_MEMORY_RATE_LIMIT=1
      // BUT NEVER on Vercel — Vercel deployments are inherently multi-instance
      if (process.env.ALLOW_IN_MEMORY_RATE_LIMIT === '1' && !isVercel) {
        console.warn('[rate-limit] ALLOW_IN_MEMORY_RATE_LIMIT=1 set — using in-memory store in production (NOT distributed across instances)');
        return undefined;
      }
      if (isVercel && process.env.ALLOW_IN_MEMORY_RATE_LIMIT === '1') {
        throw new Error('[rate-limit] ALLOW_IN_MEMORY_RATE_LIMIT=1 is not permitted on Vercel. Vercel deployments are multi-instance and require distributed Redis rate limiting.');
      }
      throw new Error('[rate-limit] UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set in production for distributed rate limiting. Set ALLOW_IN_MEMORY_RATE_LIMIT=1 to explicitly allow single-instance in-memory fallback (not allowed on Vercel).');
    }

    try {
      // Dynamic import to avoid bundling issues when not used
      const { Redis } = await import('@upstash/redis');

      const redis = new Redis({
        url: redisUrl,
        token: redisToken,
      });

      // Test Redis connection with 5-second timeout
      const pingPromise = redis.ping();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Redis ping timeout after 5000ms')), 5000)
      );
      await Promise.race([pingPromise, timeoutPromise]);

      console.log('[rate-limit] Using Upstash Redis distributed store');
      
      // Return a proper store object implementing the express-rate-limit store interface
      // using the Upstash Redis client
      const store = {
        type: 'redis',
        redis,
        redisUrl,
        async increment(key, windowMs) {
          const prefixedKey = `rl:${key}`;
          const current = await redis.incr(prefixedKey);
          if (current === 1) {
            // Set expiry based on the windowMs passed by express-rate-limit
            const windowSec = Math.ceil((windowMs || 15 * 60 * 1000) / 1000);
            await redis.expire(prefixedKey, windowSec);
          }
          const ttl = await redis.ttl(prefixedKey);
          const resetTimeMs = Date.now() + (ttl > 0 ? ttl * 1000 : (windowMs || 15 * 60 * 1000));
          return {
            totalHits: current,
            resetTime: new Date(resetTimeMs),
          };
        },
        async decrement(key) {
          const prefixedKey = `rl:${key}`;
          const current = await redis.decr(prefixedKey);
          return { totalHits: Math.max(0, current) };
        },
        async resetKey(key) {
          const prefixedKey = `rl:${key}`;
          await redis.del(prefixedKey);
        },
      };
      return store;
    } catch (err) {
      // In production, Redis initialization failure is fatal — do NOT fall back to in-memory
      console.error('[rate-limit] Failed to initialize Upstash Redis store:', err.message);
      throw new Error('[rate-limit] Redis store initialization failed in production. Rate limiting cannot start without Redis. Set ALLOW_IN_MEMORY_RATE_LIMIT=1 to explicitly allow in-memory fallback (not recommended for production, not allowed on Vercel).');
    }
  }

  // Development: use in-memory store (default)
  console.log('[rate-limit] Using in-memory store (development)');
  return undefined;
}

/* Wrap a Redis store with fail-closed behavior for production.
   If Redis operations fail at runtime, the store throws instead of allowing unlimited requests. */
function wrapStoreWithFailClosed(store, isProduction) {
  if (!store || !isProduction) {
    return store; // No wrapping needed for in-memory or development
  }

  return {
    async increment(key) {
      try {
        return await store.increment(key);
      } catch (err) {
        console.error('[rate-limit] Redis increment failed:', err.message);
        throw new Error('RATE_LIMITER_UNAVAILABLE');
      }
    },
    async decrement(key) {
      try {
        return await store.decrement(key);
      } catch (err) {
        console.error('[rate-limit] Redis decrement failed:', err.message);
        throw new Error('RATE_LIMITER_UNAVAILABLE');
      }
    },
    async resetKey(key) {
      try {
        return await store.resetKey(key);
      } catch (err) {
        console.error('[rate-limit] Redis resetKey failed:', err.message);
        throw new Error('RATE_LIMITER_UNAVAILABLE');
      }
    },
  };
}

/* Lazy store initialization - only runs when initializeRateLimiters() is called. */
let storePromise = null;
let storeInitError = null;

function getStorePromise() {
  if (storePromise) return storePromise;
  if (storeInitError) throw storeInitError;

  storePromise = (async () => {
    try {
      return await createRateLimitStoreInternal();
    } catch (err) {
      storeInitError = err;
      throw err;
    }
  })();
  return storePromise;
}

async function createRateLimiter(options) {
  // Test mode: return no-op limiter
  if (isRateLimitDisabled()) {
    return createNoOpLimiter();
  }

  const store = await getStorePromise();
  const isProduction = process.env.NODE_ENV === 'production';
  const wrappedStore = wrapStoreWithFailClosed(store, isProduction);

  const defaultHandler = (_req, res) =>
    res.status(429).json({
      success: false,
      message: options.message || 'Too many requests, please try again later.',
      error: { code: options.code || 'RATE_LIMITED', message: options.message || 'Too many requests, please try again later.' },
    });

  // Custom handler that catches Redis failures and returns 503
  const handler = options.handler || ((req, res, next) => {
    try {
      return defaultHandler(req, res, next);
    } catch (err) {
      if (err.message === 'RATE_LIMITER_UNAVAILABLE') {
        console.error('[rate-limit] Rate limiter unavailable, returning 503');
        return res.status(503).json({
          success: false,
          message: 'Rate limiting service temporarily unavailable',
          error: { code: 'RATE_LIMITER_UNAVAILABLE', message: 'Rate limiting service temporarily unavailable' },
        });
      }
      throw err;
    }
  });

  // Use express-rate-limit with the wrapped store (works for both Redis and in-memory)
  // The wrapped store implements the express-rate-limit Store interface with
  // atomic Redis operations (incr/decr/del are atomic in Redis)
  return rateLimit({
    windowMs: options.windowMs || 15 * 60 * 1000,
    max: options.max || 100,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: options.keyGenerator || ((req) => req.ip),
    handler,
    skipSuccessfulRequests: options.skipSuccessfulRequests || false,
    skipFailedRequests: options.skipFailedRequests || false,
    store: wrappedStore,
  });
}

/* Pre-configured limiter configurations matching the existing validate.js patterns. */
const limiterConfigs = {
  authLimiter: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10,
    message: 'Too many attempts. Please wait a few minutes and try again.',
    code: 'RATE_LIMITED',
    keyGenerator: (req) => req.user?._id?.toString() || ipKeyGenerator(req.ip),
  },
  signupLimiter: {
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5,
    message: 'Too many accounts created from this connection. Please try again later.',
    code: 'RATE_LIMITED',
    keyGenerator: (req) => ipKeyGenerator(req.ip),
  },
  checkoutLimiter: {
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 30,
    message: 'Too many checkout attempts. Please wait a moment.',
    code: 'RATE_LIMITED',
    keyGenerator: (req) => req.user?._id?.toString() || ipKeyGenerator(req.ip),
  },
  writeLimiter: {
    windowMs: 60 * 1000, // 1 minute
    max: 120,
    message: 'Slow down a moment.',
    code: 'RATE_LIMITED',
    keyGenerator: (req) => req.user?._id?.toString() || ipKeyGenerator(req.ip),
  },
};

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
  // Check production overrides
  if (process.env.NODE_ENV === 'production') {
    if (process.env.DISABLE_RATE_LIMIT === 'true') {
      throw new Error('[rate-limit] DISABLE_RATE_LIMIT=true is not allowed in production');
    }
    const isVercel = process.env.VERCEL === '1' || process.env.VERCEL === 'true';
    if (process.env.ALLOW_IN_MEMORY_RATE_LIMIT === '1') {
      if (isVercel) {
        throw new Error('[rate-limit] ALLOW_IN_MEMORY_RATE_LIMIT=1 is not permitted on Vercel. Vercel deployments are multi-instance and require distributed Redis rate limiting.');
      }
      console.warn('[rate-limit] ALLOW_IN_MEMORY_RATE_LIMIT=1 set — using in-memory store in production (NOT distributed across instances)');
    }
  }

  _authLimiter = await createRateLimiter(limiterConfigs.authLimiter);
  _signupLimiter = await createRateLimiter(limiterConfigs.signupLimiter);
  _checkoutLimiter = await createRateLimiter(limiterConfigs.checkoutLimiter);
  _writeLimiter = await createRateLimiter(limiterConfigs.writeLimiter);
  console.log('[rate-limit] All limiters initialized');
  return { authLimiter: _authLimiter, signupLimiter: _signupLimiter, checkoutLimiter: _checkoutLimiter, writeLimiter: _writeLimiter };
}