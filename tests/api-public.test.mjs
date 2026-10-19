import test from 'node:test';
import assert from 'node:assert';
import 'dotenv/config';
import mongoose from 'mongoose';
import { tcpUp } from './helpers/server.mjs';

const mongoUp = await tcpUp('127.0.0.1', 27017);

test('public products include image fields', { skip: mongoUp ? false : 'mongod is not reachable' }, async () => {
  const uri = process.env.DATABASE_URL || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/astrovetro';
  await mongoose.connect(uri);
  try {
    const { Product } = await import('../src/models/Product.js');
    const found = await Product.findOne({ status: 'active', images: { $ne: [] } }).lean();
    assert.ok(found, 'at least one active product should carry photography');
    assert.ok(Array.isArray(found.images));
    assert.ok(Array.isArray(found.imageAlts));
    assert.strictEqual(found.imageAlts.length, found.images.length);
  } finally {
    await mongoose.disconnect();
  }
});
