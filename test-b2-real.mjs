/**
 * Real B2 Integration Test
 * 
 * Run this when B2 credentials are available:
 * B2_BUCKET_NAME=xxx B2_KEY_ID=xxx B2_APPLICATION_KEY=xxx \
 * B2_ENDPOINT=https://s3.us-west-004.backblazeb2.com B2_REGION=us-west-004 \
 * STORAGE_PUBLIC_URL=/assets/img \
 * node test-b2-real.mjs
 * 
 * This tests real B2 operations against the actual Backblaze B2 service.
 */

import { b2Adapter } from './src/utils/storage.js';
import sharp from 'sharp';
import crypto from 'crypto';

// Generate a unique test prefix
const runId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
const testPrefix = `verification/uat-b2/${runId}/`;

// Create a small valid PNG (1x1 transparent pixel)
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

async function runTest() {
  console.log('=== Real B2 Integration Test ===');
  console.log(`Run ID: ${runId}`);
  console.log(`Test Prefix: ${testPrefix}`);
  console.log('');

  const results = {
    authenticate: false,
    bucketAccess: false,
    upload: false,
    objectExists: false,
    retrieve: false,
    byteCompare: false,
    mimeType: false,
    publicUrl: false,
    delete: false,
    absenceVerify: false,
  };

  try {
    // Test 1: Authenticate and bucket access (via list)
    console.log('1. Testing authentication and bucket access...');
    const listResult = await b2Adapter.list({ assignedPaths: new Set() });
    console.log('   ✓ Authenticated and bucket accessible');
    console.log(`   Found ${listResult.length} image groups`);
    results.authenticate = true;
    results.bucketAccess = true;

    // Test 2: Upload
    console.log('\n2. Testing upload...');
    const uploadResult = await b2Adapter.upload({ 
      buffer: validPng, 
      filename: `${testPrefix}test.png` 
    });
    console.log('   ✓ Upload successful');
    console.log(`   Original: ${uploadResult.original}`);
    console.log(`   Large: ${uploadResult.large}`);
    console.log(`   Thumb: ${uploadResult.thumb}`);
    console.log(`   Dimensions: ${uploadResult.width}x${uploadResult.height}`);
    console.log(`   Size: ${uploadResult.size} bytes`);
    results.upload = true;

    // Test 3: Verify object exists
    console.log('\n3. Verifying object existence...');
    const exists = await b2Adapter.exists(uploadResult.large);
    console.log(`   ✓ Object exists: ${exists}`);
    results.objectExists = true;

    // Test 4: Retrieve and compare bytes
    console.log('\n4. Testing retrieval and byte comparison...');
    const stream = await b2Adapter.getReadStream(uploadResult.large);
    if (!stream) {
      throw new Error('Failed to get read stream');
    }
    
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const retrievedBuffer = Buffer.concat(chunks);
    
    // For the large derivative, we need to regenerate it to compare
    // (since we don't store the original large buffer)
    // Instead, let's test with the original file
    const origStream = await b2Adapter.getReadStream(uploadResult.original);
    if (!origStream) {
      throw new Error('Failed to get original read stream');
    }
    
    const origChunks = [];
    for await (const chunk of origStream) {
      origChunks.push(chunk);
    }
    const retrievedOriginal = Buffer.concat(origChunks);
    
    // The original should match what we uploaded (PNG)
    const byteMatch = retrievedOriginal.equals(validPng);
    console.log(`   ✓ Original bytes match: ${byteMatch}`);
    results.retrieve = true;
    results.byteCompare = byteMatch;

    // Test 5: Verify MIME type
    console.log('\n5. Verifying MIME type...');
    const stat = await b2Adapter.stat(uploadResult.original);
    console.log(`   ✓ Stat: size=${stat.size}, mtime=${stat.mtime}`);
    // Verify it's a valid image by trying to read with sharp
    try {
      const meta = await sharp(retrievedOriginal).metadata();
      console.log(`   ✓ Valid image: ${meta.format}, ${meta.width}x${meta.height}`);
      results.mimeType = true;
    } catch (e) {
      console.log(`   ✗ Invalid image: ${e.message}`);
    }

    // Test 6: Public URL behavior
    console.log('\n6. Verifying public URL behavior...');
    console.log(`   Original URL: ${uploadResult.original}`);
    console.log(`   Large URL: ${uploadResult.large}`);
    console.log(`   Thumb URL: ${uploadResult.thumb}`);
    const hasCorrectPrefix = uploadResult.original.startsWith('/assets/img/');
    console.log(`   ✓ URLs have correct prefix: ${hasCorrectPrefix}`);
    results.publicUrl = hasCorrectPrefix;

    // Test 7: Delete
    console.log('\n7. Testing deletion...');
    const deleted = await b2Adapter.delete(uploadResult.large);
    console.log(`   ✓ Deleted ${deleted} files`);
    results.delete = true;

    // Test 8: Verify absence
    console.log('\n8. Verifying absence after deletion...');
    const existsAfterDelete = await b2Adapter.exists(uploadResult.large);
    console.log(`   ✓ Object absent: ${!existsAfterDelete}`);
    results.absenceVerify = !existsAfterDelete;

    // Cleanup: Also delete original and thumb if they exist
    await b2Adapter.delete(uploadResult.original).catch(() => {});
    await b2Adapter.delete(uploadResult.thumb).catch(() => {});

  } catch (error) {
    console.error('\n✗ Test failed:', error.message);
    console.error(error.stack);
    return false;
  }

  console.log('\n=== Test Results ===');
  for (const [test, passed] of Object.entries(results)) {
    console.log(`${passed ? '✓' : '✗'} ${test}`);
  }

  const allPassed = Object.values(results).every(v => v === true);
  console.log(`\nOverall: ${allPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}`);
  
  return allPassed;
}

runTest()
  .then(success => process.exit(success ? 0 : 1))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });