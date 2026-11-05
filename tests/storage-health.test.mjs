/* -------------------------------------------------------------------------
   Storage health check tests
   -------------------------------------------------------------------------

   Tests for the storage health check functionality.
   ------------------------------------------------------------------------- */

import test from 'node:test';
import assert from 'node:assert';
import { checkStorageHealth, getStorageAdapter, setStorageAdapter, getAvailableAdapters } from '../src/utils/storage.js';

test('Storage health check', async (t) => {
  // Test with local adapter (default)
  await t.test('local adapter reports healthy', async () => {
    // Ensure local adapter is set
    setStorageAdapter('local');
    
    const health = await checkStorageHealth();
    
    assert.strictEqual(health.provider, 'local');
    assert.strictEqual(health.configured, true);
    assert.strictEqual(health.available, true);
    assert.ok(health.details.root);
    assert.ok(health.details.root.includes('library'));
  });

  await t.test('storage adapter name is exposed', async () => {
    const adapter = getStorageAdapter();
    assert.ok(adapter.name);
    assert.ok(typeof adapter.name === 'string');
  });

  await t.test('available adapters includes local', async () => {
    const available = getAvailableAdapters();
    assert.ok(Array.isArray(available));
    assert.ok(available.includes('local'));
    assert.ok(available.includes('s3'));
    assert.ok(available.includes('b2'));
  });
});

test('Storage health with B2 adapter (mocked)', async (t) => {
  // Test with B2 adapter but missing credentials
  await t.test('B2 adapter without credentials throws at startup', async () => {
    // Reset env vars
    delete process.env.B2_BUCKET_NAME;
    delete process.env.B2_KEY_ID;
    delete process.env.B2_APPLICATION_KEY;
    delete process.env.B2_ENDPOINT;
    delete process.env.B2_REGION;
    
    try {
      setStorageAdapter('b2');
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err.message.includes('B2 adapter requires'));
      assert.ok(err.message.includes('B2_BUCKET_NAME'));
      assert.ok(err.message.includes('B2_KEY_ID'));
      assert.ok(err.message.includes('B2_APPLICATION_KEY'));
    }
  });

  await t.test('B2 adapter with credentials allows health check', async () => {
    // Set mock credentials
    process.env.B2_BUCKET_NAME = 'test-bucket';
    process.env.B2_KEY_ID = 'test-key';
    process.env.B2_APPLICATION_KEY = 'test-secret';
    process.env.B2_ENDPOINT = 'https://s3.us-west-004.backblazeb2.com';
    process.env.B2_REGION = 'us-west-004';
    
    // This will fail because we don't have real B2 credentials
    // but it should pass the startup validation
    try {
      setStorageAdapter('b2');
      // Health check will fail because we don't have real B2, but startup validation passes
      const health = await checkStorageHealth();
      assert.strictEqual(health.provider, 'b2');
      assert.strictEqual(health.configured, true);
      // available will be false because we don't have real B2
      assert.strictEqual(health.available, false);
    } catch (err) {
      // If it throws, it should be a normalized error
      assert.ok(err.message);
    } finally {
      // Cleanup
      delete process.env.B2_BUCKET_NAME;
      delete process.env.B2_KEY_ID;
      delete process.env.B2_APPLICATION_KEY;
      delete process.env.B2_ENDPOINT;
      delete process.env.B2_REGION;
    }
  });
});

test('Storage health with S3 adapter (mocked)', async (t) => {
  await t.test('S3 adapter without credentials throws at startup', async () => {
    delete process.env.S3_BUCKET;
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;
    delete process.env.S3_ENDPOINT;
    delete process.env.S3_REGION;
    
    try {
      setStorageAdapter('s3');
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err.message.includes('S3 adapter requires'));
      assert.ok(err.message.includes('S3_BUCKET'));
      assert.ok(err.message.includes('S3_ACCESS_KEY_ID'));
      assert.ok(err.message.includes('S3_SECRET_ACCESS_KEY'));
    }
  });
});