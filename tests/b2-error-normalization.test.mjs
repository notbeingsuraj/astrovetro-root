/* -------------------------------------------------------------------------
   B2 storage adapter error normalization tests
   -------------------------------------------------------------------------

   Tests for the normalizeS3Error function and B2 adapter error handling.
   ------------------------------------------------------------------------- */

import test from 'node:test';
import assert from 'node:assert';
import { normalizeS3Error, b2Adapter } from '../src/utils/storage.js';

test('normalizeS3Error', async (t) => {
  await t.test('AccessDenied maps to 403 Forbidden', () => {
    const err = new Error('Access Denied');
    err.name = 'AccessDenied';
    err.$metadata = { httpStatusCode: 403 };
    
    const normalized = normalizeS3Error(err, 'test');
    assert.strictEqual(normalized.status, 403);
    assert.strictEqual(normalized.code, 'FORBIDDEN');
    assert.ok(normalized.message.includes('access denied') || normalized.message.includes('Access denied'));
  });

  await t.test('InvalidAccessKeyId maps to 401 Unauthorized', () => {
    const err = new Error('Invalid Access Key');
    err.name = 'InvalidAccessKeyId';
    err.$metadata = { httpStatusCode: 401 };
    
    const normalized = normalizeS3Error(err, 'test');
    assert.strictEqual(normalized.status, 401);
    assert.strictEqual(normalized.code, 'UNAUTHORIZED');
  });

  await t.test('SignatureDoesNotMatch maps to 401 Unauthorized', () => {
    const err = new Error('Signature does not match');
    err.name = 'SignatureDoesNotMatch';
    err.$metadata = { httpStatusCode: 401 };
    
    const normalized = normalizeS3Error(err, 'test');
    assert.strictEqual(normalized.status, 401);
    assert.strictEqual(normalized.code, 'UNAUTHORIZED');
  });

  await t.test('NoSuchBucket maps to 404 Not Found', () => {
    const err = new Error('Bucket does not exist');
    err.name = 'NoSuchBucket';
    err.$metadata = { httpStatusCode: 404 };
    
    const normalized = normalizeS3Error(err, 'test');
    assert.strictEqual(normalized.status, 404);
    assert.strictEqual(normalized.code, 'NOT_FOUND');
  });

  await t.test('RequestTimeout maps to 503 Service Unavailable', () => {
    const err = new Error('Request timed out');
    err.name = 'RequestTimeout';
    err.$metadata = { httpStatusCode: 408 };
    
    const normalized = normalizeS3Error(err, 'test');
    assert.strictEqual(normalized.status, 503);
    assert.strictEqual(normalized.code, 'SERVICE_UNAVAILABLE');
  });

  await t.test('SlowDown maps to 429 Too Many Requests', () => {
    const err = new Error('Rate exceeded');
    err.name = 'SlowDown';
    err.$metadata = { httpStatusCode: 503 };
    
    const normalized = normalizeS3Error(err, 'test');
    assert.strictEqual(normalized.status, 429);
    assert.strictEqual(normalized.code, 'TOO_MANY_REQUESTS');
  });

  await t.test('Network errors map to 503 Service Unavailable', () => {
    const err = new Error('Connection refused');
    err.name = 'NetworkingError';
    err.code = 'ECONNREFUSED';
    
    const normalized = normalizeS3Error(err, 'test');
    assert.strictEqual(normalized.status, 503);
    assert.strictEqual(normalized.code, 'SERVICE_UNAVAILABLE');
  });

  await t.test('EntityTooLarge maps to 400 Bad Request', () => {
    const err = new Error('Entity too large');
    err.name = 'EntityTooLarge';
    err.$metadata = { httpStatusCode: 413 };
    
    const normalized = normalizeS3Error(err, 'test');
    assert.strictEqual(normalized.status, 400);
    assert.strictEqual(normalized.code, 'BAD_REQUEST');
  });

  await t.test('Unknown error with 500 status maps to 500', () => {
    const err = new Error('Unknown error');
    err.name = 'UnknownError';
    err.$metadata = { httpStatusCode: 500 };
    
    const normalized = normalizeS3Error(err, 'test');
    assert.strictEqual(normalized.status, 500);
    assert.strictEqual(normalized.code, 'INTERNAL_ERROR');
  });

  await t.test('Unknown error with 400 status maps to 400', () => {
    const err = new Error('Bad request');
    err.name = 'UnknownError';
    err.$metadata = { httpStatusCode: 400 };
    
    const normalized = normalizeS3Error(err, 'test');
    assert.strictEqual(normalized.status, 400);
    assert.strictEqual(normalized.code, 'BAD_REQUEST');
  });

  await t.test('Strips credentials from error messages', () => {
    const err = new Error('Access denied for user?access_key=SECRET&signature=SIG');
    err.name = 'AccessDenied';
    err.$metadata = { httpStatusCode: 403 };
    
    const normalized = normalizeS3Error(err, 'test');
    assert.ok(!normalized.message.includes('SECRET'));
    assert.ok(!normalized.message.includes('SIG'));
  });
});