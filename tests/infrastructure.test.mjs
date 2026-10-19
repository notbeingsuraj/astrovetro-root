import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import { products } from '../src/data/catalogue.js';

test('catalogue has 12 products and wired imageAlts', () => {
  assert.strictEqual(products.length, 12);
  for (const p of products.slice(0, 3)) {
    assert.ok(Array.isArray(p.images));
    assert.ok(Array.isArray(p.imageAlts));
    assert.strictEqual(p.images.length, p.imageAlts.length);
  }
});
