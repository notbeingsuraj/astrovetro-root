import test from 'node:test';
import assert from 'node:assert';
import mongoose from 'mongoose';
import { tcpUp, dropDatabase } from './helpers/server.mjs';

const mongoUp = await tcpUp('127.0.0.1', 27017);

/* This used to read whichever database the environment happened to point at,
   so a fresh machine failed a test that had nothing to do with the code. It now
   seeds its own disposable database: the assertion is about the seed contract
   (photography plus parallel alt text), not about a developer's local data. */
const TEST_DB = 'mongodb://127.0.0.1:27017/astrovetro_public_test';

test('public products include image fields', { skip: mongoUp ? false : 'mongod is not reachable' }, async () => {
  process.env.DATABASE_URL = TEST_DB;
  const { connectDB, disconnectDB } = await import('../src/db/connect.js');
  assert.ok(await connectDB(), 'test database should connect');

  try {
    const { seedCatalogue } = await import('../src/db/seed.js');
    await seedCatalogue({ quiet: true });

    const { Product } = await import('../src/models/Product.js');
    const found = await Product.findOne({ status: 'active', images: { $ne: [] } }).lean();
    assert.ok(found, 'seeding should produce at least one active product with photography');
    assert.ok(Array.isArray(found.images));
    assert.ok(Array.isArray(found.imageAlts));
    assert.strictEqual(found.imageAlts.length, found.images.length);

    /* The same document must survive the public serialiser with its alts. */
    const { default: dbProvider } = await import('../src/providers/dbProvider.js');
    const pub = await dbProvider.getProduct(found.slug);
    assert.ok(pub, 'a seeded product should resolve publicly');
    assert.deepStrictEqual(pub.imageAlts, found.imageAlts);
  } finally {
    await disconnectDB();
    await dropDatabase(TEST_DB);
  }
});
