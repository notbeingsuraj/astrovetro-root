import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { S3Client, ListObjectsV2Command, HeadObjectCommand, DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import { b2Adapter } from '../src/utils/storage.js';

const mockS3 = mockClient(S3Client);

// Minimal valid 1x1 PNG (transparent)
const validPng = Buffer.from([
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
  0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xDE,
  0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, 0x54,
  0x08, 0xD7, 0x63, 0xF8, 0xFF, 0xFF, 0x3F, 0x00, 0x05, 0x00, 0x05,
  0x9D, 0x5A, 0x4E, 0x2E,
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82
]);

describe('B2 storage adapter', () => {
  // Minimal valid 1x1 transparent PNG (base64)
  const validPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );

  beforeEach(() => {
    mockS3.reset();
    process.env.B2_BUCKET_NAME = 'test-bucket';
    process.env.B2_KEY_ID = 'test-key';
    process.env.B2_APPLICATION_KEY = 'test-secret';
    process.env.B2_ENDPOINT = 'https://s3.us-west-004.backblazeb2.com';
    process.env.B2_REGION = 'us-west-004';
    process.env.STORAGE_PUBLIC_URL = '/assets/img';
  });

  afterEach(() => {
    delete process.env.B2_BUCKET_NAME;
    delete process.env.B2_KEY_ID;
    delete process.env.B2_APPLICATION_KEY;
    delete process.env.B2_ENDPOINT;
    delete process.env.B2_REGION;
    delete process.env.STORAGE_PUBLIC_URL;
  });

  it('uploads image and returns correct public URLs with single prefix', async () => {
    mockS3.on(PutObjectCommand).resolves({});

    const result = await b2Adapter.upload({ buffer: validPng, filename: 'test.png' });

    assert.ok(result.original.includes('/assets/img/products/'));
    assert.ok(result.large.includes('/assets/img/products/'));
    assert.ok(result.thumb.includes('/assets/img/products/'));
    assert.ok(result.width > 0 && result.height > 0);
  });

  it('lists uploaded objects with correct prefix', async () => {
    mockS3.on(ListObjectsV2Command).resolves({
      Contents: [
        { Key: 'products/abc-original.png' },
        { Key: 'products/abc-large.webp' },
        { Key: 'products/abc-thumb.webp' },
      ],
    });

    const list = await b2Adapter.list({ assignedPaths: new Set() });
    assert.strictEqual(list.length, 1);
    assert.ok(list[0].files.includes('/assets/img/products/abc-original.png'));
    assert.ok(list[0].files.includes('/assets/img/products/abc-large.webp'));
    assert.ok(list[0].files.includes('/assets/img/products/abc-thumb.webp'));
  });

  it('checks existence of object', async () => {
    mockS3.on(HeadObjectCommand).resolves({});
    const exists = await b2Adapter.exists('/assets/img/products/test-large.webp');
    assert.strictEqual(exists, true);

    mockS3.on(HeadObjectCommand).rejects({ name: 'NotFound', $metadata: { httpStatusCode: 404 } });
    const notExists = await b2Adapter.exists('/assets/img/products/missing.webp');
    assert.strictEqual(notExists, false);
  });

  it('deletes object and its derivatives', async () => {
    mockS3.on(DeleteObjectCommand).resolves({});
    mockS3.on(ListObjectsV2Command).resolves({ Contents: [{ Key: 'products/abc-original.png' }] });
    mockS3.on(DeleteObjectCommand).resolves({});

    const deleted = await b2Adapter.delete('/assets/img/products/test-large.webp');
    assert.ok(deleted >= 1);
  });

  it('returns stat for existing object', async () => {
    mockS3.on(HeadObjectCommand).resolves({ ContentLength: 12345, LastModified: new Date('2024-01-01') });
    const stat = await b2Adapter.stat('/assets/img/products/test-large.webp');
    assert.strictEqual(stat.size, 12345);
  });

  it('returns null for missing object stat', async () => {
    mockS3.on(HeadObjectCommand).rejects({ name: 'NotFound', $metadata: { httpStatusCode: 404 } });
    const stat = await b2Adapter.stat('/assets/img/products/missing.webp');
    assert.strictEqual(stat, null);
  });
});