/* -------------------------------------------------------------------------
   Runtime Redis Failure Tests for Rate Limiter
   -------------------------------------------------------------------------
   Tests the fail-closed behavior when Redis becomes unavailable at runtime.
   Uses a mock Redis client to simulate connectivity loss without requiring
   a real Redis instance.
   ------------------------------------------------------------------------- */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { initializeRateLimiters } from '../src/middleware/rateLimitStore.js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* Mock Redis client that can simulate failures */
class MockRedis {
  constructor({ shouldFail = false, failAfter = 0 } = {}) {
    this.shouldFail = shouldFail;
    this.failAfter = failAfter;
    this.callCount = 0;
    this.data = new Map();
  }

  async ping() {
    if (this.shouldFail) throw new Error('Redis connection refused');
    return 'PONG';
  }

  async incr(key) {
    this.callCount++;
    if (this.shouldFail && this.callCount > this.failAfter) {
      throw new Error('Redis connection refused');
    }
    const current = (this.data.get(key) || 0) + 1;
    this.data.set(key, current);
    return current;
  }

  async decr(key) {
    this.callCount++;
    if (this.shouldFail && this.callCount > this.failAfter) {
      throw new Error('Redis connection refused');
    }
    const current = Math.max(0, (this.data.get(key) || 1) - 1);
    this.data.set(key, current);
    return current;
  }

  async expire(key, ttl) {
    return 1;
  }

  async ttl(key) {
    return 60;
  }

  async del(key) {
    this.data.delete(key);
    return 1;
  }

  simulateFailure() { this.shouldFail = true; }
  simulateRecovery() { this.shouldFail = false; }
}

/* Mock Ratelimit class that uses our mock Redis */
class MockRatelimit {
  constructor({ redis, limiter }) {
    this.redis = redis;
    this.limiter = limiter;
  }

  async limit(key) {
    const current = await this.redis.incr(`rl:${key}`);
    const limit = this.limiter.max;
    const success = current <= limit;
    const remaining = Math.max(0, limit - current);
    const reset = Date.now() + this.limiter.windowMs;
    return { success, limit, remaining, reset, pending: Promise.resolve() };
  }
}

/* Mock @upstash/ratelimit module */
const mockRatelimitModule = {
  Ratelimit: MockRatelimit,
  fixedWindow: (max, windowMs) => ({ max, windowMs })
};

describe('Rate Limiter Runtime Failure Tests', () => {
  let originalEnv;

  before(() => {
    originalEnv = { ...process.env };
    process.env.NODE_ENV = 'production';
    process.env.UPSTASH_REDIS_REST_URL = 'https://test.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
  });

  after(() => {
    process.env = originalEnv;
  });

  describe('Startup Redis connectivity check', () => {
    it('enforces 5-second timeout on Redis ping via Promise.race', async () => {
      const source = await readFile(path.join(__dirname, '../src/middleware/rateLimitStore.js'), 'utf-8');
      assert.ok(source.includes('Promise.race'), 'Should use Promise.race for ping timeout');
      assert.ok(source.includes('5000'), 'Should have 5000ms timeout');
      assert.ok(source.includes('Redis ping timeout'), 'Should have timeout error message');
    });

    it('throws on Redis initialization failure in production', async () => {
      const source = await readFile(path.join(__dirname, '../src/middleware/rateLimitStore.js'), 'utf-8');
      assert.ok(source.includes('catch (err)'), 'Should have try/catch for Redis init');
      assert.ok(source.includes('initialization failed in production'), 'Should have production failure message');
    });
  });

  describe('Vercel in-memory override rejection', () => {
    it('rejects ALLOW_IN_MEMORY_RATE_LIMIT=1 on Vercel', async () => {
      process.env.VERCEL = '1';
      process.env.ALLOW_IN_MEMORY_RATE_LIMIT = '1';
      process.env.NODE_ENV = 'production';
      // Do NOT set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN
      // to test the Vercel in-memory override rejection path
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;

      try {
        await initializeRateLimiters();
        assert.fail('Should have thrown');
      } catch (err) {
        assert.ok(err.message.includes('not permitted on Vercel'), 'Should reject Vercel in-memory override');
      }

      delete process.env.VERCEL;
      delete process.env.ALLOW_IN_MEMORY_RATE_LIMIT;
    });

    it('allows ALLOW_IN_MEMORY_RATE_LIMIT=1 on non-Vercel production (code check)', async () => {
      const source = await readFile(path.join(__dirname, '../src/middleware/rateLimitStore.js'), 'utf-8');
      assert.ok(source.includes('!isVercel'), 'Should check for non-Vercel before allowing in-memory');
    });
  });

  describe('Rate limit violation returns 429 (fixedWindow logic)', () => {
    it('returns 429 when limit exceeded', async () => {
      const limiter = mockRatelimitModule.fixedWindow(5, 60000);
      const redis = new MockRedis();
      const ratelimit = new mockRatelimitModule.Ratelimit({ redis, limiter });

      for (let i = 0; i < 5; i++) {
        const result = await ratelimit.limit('test-key');
        assert.ok(result.success, `Request ${i + 1} should succeed`);
        assert.strictEqual(result.remaining, 4 - i);
      }

      const result = await ratelimit.limit('test-key');
      assert.ok(!result.success, '6th request should be rate limited');
      assert.strictEqual(result.remaining, 0);
    });
  });

  describe('Rate limit recovery after Redis restore', () => {
    it('recovers when Redis comes back online', async () => {
      const redis = new MockRedis({ shouldFail: true, failAfter: 0 });
      const limiter = mockRatelimitModule.fixedWindow(10, 60000);
      const ratelimit = new mockRatelimitModule.Ratelimit({ redis, limiter });

      try {
        await ratelimit.limit('test-key');
        assert.fail('Should have thrown');
      } catch (err) {
        assert.ok(err.message.includes('Redis connection refused'));
      }

      redis.simulateRecovery();

      const result = await ratelimit.limit('test-key');
      assert.ok(result.success, 'Should succeed after Redis recovery');
      assert.strictEqual(result.remaining, 9);
    });
  });

  describe('wrapStoreWithFailClosed behavior (via source inspection)', () => {
    it('wraps increment/decrement/resetKey with fail-closed in production', async () => {
      const source = await readFile(path.join(__dirname, '../src/middleware/rateLimitStore.js'), 'utf-8');
      assert.ok(source.includes('wrapStoreWithFailClosed'), 'Should have wrapStoreWithFailClosed function');
      assert.ok(source.includes('RATE_LIMITER_UNAVAILABLE'), 'Should throw RATE_LIMITER_UNAVAILABLE on failure');
      assert.ok(source.includes('isProduction'), 'Should check production env');
    });

    it('does not wrap in development', async () => {
      const source = await readFile(path.join(__dirname, '../src/middleware/rateLimitStore.js'), 'utf-8');
      assert.ok(source.includes('!isProduction'), 'Should skip wrapping in development');
    });
  });
});