/* -------------------------------------------------------------------------
   Unit tests for Backblaze B2 storage adapter (mocked)
   ------------------------------------------------------------------------- */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { S3Client, ListObjectsV2Command, HeadObjectCommand, DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import { b2Adapter } from '../src/utils/storage.js';

const mockS3 = mockClient(S3Client);

describe('B2 storage adapter', () => {
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

  /* -------------------------------------------------------------------------
   Unit tests for Backblaze B2 storage adapter (mocked)
   ------------------------------------------------------------------------- */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { S3Client, ListObjectsV2Command, HeadObjectCommand, DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import sharp from 'sharp';
import { b2Adapter } from '../src/utils/storage.js';

const mockS3 = mockClient(S3Client);

const mockSharp = {
  metadata: async () => ({ width: 100, height: 100 }),
  rotate: () => mockSharp,
  resize: () => mockSharp,
  webp: () => mockSharp,
  toBuffer: async () => Buffer.from('mock-image-data'),
};

describe('B2 storage adapter', () => {
  beforeEach(() => {
    mockS3.reset();
    process.env.B2_BUCKET_NAME = 'test-bucket';
    process.env.B2_KEY_ID = 'test-key';
    process.env.B2_APPLICATION_KEY = 'test-secret';
    process.env.B2_ENDPOINT = 'https://s3.us-west-004.backblazeb2.com';
    process.env.B2_REGION = 'us-west-004';
    process.env.STORAGE_PUBLIC_URL = '/assets/img';
    
    sharp.mockImplementation(() => ({
      metadata: async () => ({ width: 100, height: 100 }),
      rotate: () => sharp,
      resize: () => sharp,
      webp: () => sharp,
      toBuffer: async () => Buffer.from('mock-image-data'),
    }));
  });

  afterEach(() => {
    delete process.env.B2_BUCKET_NAME;
    delete process.env.B2_KEY_ID;
    delete process.env.B2_APPLICATION_KEY;
    delete process.env.B2_ENDPOINT;
    delete process.env.B2_REGION;
    delete process.env.STORAGE_PUBLIC_URL;
    sharp.mockRestore();
  }

  it('uploads image and returns correct public URLs with single prefix', async () => {
    mockS3.on(PutObjectCommand).resolves({});

    const result = await b2Adapter.upload({ buffer: Buffer.from('fake-image-data'), filename: 'test.png' });

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
});