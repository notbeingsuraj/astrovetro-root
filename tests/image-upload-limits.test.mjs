/* -------------------------------------------------------------------------
   Image upload size and validation tests
   -------------------------------------------------------------------------

   Tests for file size limits, validation, and error handling.
   Uses a test storage adapter to avoid external dependencies.
   ------------------------------------------------------------------------- */

import test from 'node:test';
import assert from 'node:assert';
import { startServer, tcpUp } from './helpers/server.mjs';
import { setStorageAdapter } from '../src/utils/storage.js';
import { testStorageAdapter } from './storage-adapter-test.mjs';

const mongoUp = await tcpUp('127.0.0.1', 27017);

const TEST_DB = 'mongodb://127.0.0.1:27017/astrovetro_upload_test';

test('Image upload size limits', { skip: mongoUp ? false : 'mongod is not reachable on 127.0.0.1:27017' }, async (t) => {
  let server;
  let base;
  let cookie;

  // Set up test storage adapter
  const { testStorageAdapter } = await import('./storage-adapter-test.mjs');
  setStorageAdapter('test-storage');
  const { testStorageAdapter: adapter } = await import('./storage-adapter-test.mjs');
  adapter.clear();

  await t.test('setup: create admin user and login', async () => {
    const { startServer } = await import('./helpers/server.mjs');
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);
    
    server = await startServer({ port: 5600, databaseUrl: TEST_DB });
    base = server.base;

    // Create admin user
    await execFileAsync(process.execPath, ['scripts/create-admin.mjs', 'admin@test.com'], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: TEST_DB, MONGODB_URI: TEST_DB, AV_ADMIN_PASSWORD: 'testpass123' },
    });

    // Login
    const loginRes = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify({ email: 'admin@test.com', password: 'testpass123' }),
    });
    assert.strictEqual(loginRes.status, 200);

    const cookieHeader = loginRes.headers.get('set-cookie');
    cookie = cookieHeader?.split(';')[0];
    assert.ok(cookie);
  });

  // Minimal valid 1x1 PNG (transparent)
  const validPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );

  await t.test('valid image upload succeeds', async () => {
    const res = await fetch(`${base}/api/admin/images/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png', Cookie: cookie, Origin: base },
      body: validPng,
    });

    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.ok(body.data.image.large);
    assert.ok(body.data.image.large.includes('/assets/img/'));
    assert.ok(body.data.image.width > 0);
    assert.ok(body.data.image.height > 0);
  });

  await t.test('oversized image rejected with 413', async () => {
    const oversized = Buffer.alloc(13 * 1024 * 1024);
    oversized[0] = 0x89;
    oversized[1] = 0x50;
    oversized[2] = 0x4E;
    oversized[3] = 0x47;

    const res = await fetch(`${base}/api/admin/images/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png', Cookie: cookie, Origin: base },
      body: oversized,
    });

    assert.ok(res.status === 413 || res.status === 400, `Expected 413 or 400, got ${res.status}`);
  });

  await t.test('invalid image format rejected', async () => {
    const res = await fetch(`${base}/api/admin/images/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png', Cookie: cookie, Origin: base },
      body: 'this is not an image',
    });

    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.ok(body.error?.message?.toLowerCase().includes('format') || body.error?.message?.toLowerCase().includes('recognised'));
  });

  await t.test('empty file rejected', async () => {
    const res = await fetch(`${base}/api/admin/images/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png', Cookie: cookie, Origin: base },
      body: Buffer.alloc(0),
    });

    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.ok(body.error?.message?.toLowerCase().includes('no image data') || body.error?.message?.toLowerCase().includes('empty'));
  });

  await t.test('missing file rejected', async () => {
    const res = await fetch(`${base}/api/admin/images/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png', Cookie: cookie, Origin: base },
    });

    assert.strictEqual(res.status, 400);
  });

  await t.after(async () => {
    if (server) await server.stop();
    // Clean up test storage
    const { testStorageAdapter } = await import('./storage-adapter-test.mjs');
    adapter.clear();
  });
});

const TEST_DB = 'mongodb://127.0.0.1:27017/astrovetro_upload_test';