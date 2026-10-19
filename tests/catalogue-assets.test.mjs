/* The catalogue promises that every product that has photography points at a
   file that actually exists, locally, with parallel alt text — and that the
   one product deliberately left without photos keeps them empty so the card
   falls back to the gradient art instead of showing a wrong photograph.
   These are the guard rails for that promise. */

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { products } from '../src/data/catalogue.js';

const PUBLIC_DIR = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '..',
  'public'
);

test('every catalogue image path is local and the file exists on disk', () => {
  const missing = [];
  for (const p of products) {
    for (const src of p.images || []) {
      assert.ok(src.startsWith('/assets/img/'), `${p.slug}: image must be a local path, got ${src}`);
      assert.ok(!/^https?:/i.test(src), `${p.slug}: hotlinked image ${src}`);
      const file = path.join(PUBLIC_DIR, src);
      if (!fs.existsSync(file)) missing.push(`${p.slug} -> ${src}`);
    }
  }
  assert.deepStrictEqual(missing, [], `missing image files:\n${missing.join('\n')}`);
});

test('imageAlts runs parallel to images and every alt is non-empty', () => {
  for (const p of products) {
    const images = p.images || [];
    const alts = p.imageAlts || [];
    assert.strictEqual(alts.length, images.length, `${p.slug}: imageAlts length out of step`);
    images.forEach((_, i) => {
      assert.ok(alts[i] && alts[i].trim().length > 0, `${p.slug}: alt #${i} is empty`);
    });
  }
});

test('images live under the product own directory', () => {
  for (const p of products) {
    for (const src of p.images || []) {
      assert.ok(
        src.startsWith(`/assets/img/products/${p.slug}/`),
        `${p.slug}: image outside its own directory: ${src}`
      );
    }
  }
});

test('only labradorite-pendant is intentionally photo-less', () => {
  const empty = products.filter((p) => (p.images || []).length === 0).map((p) => p.slug);
  assert.deepStrictEqual(empty, ['labradorite-pendant']);
});

test('no file is claimed by two different products', () => {
  const seen = new Map();
  for (const p of products) {
    for (const src of p.images || []) {
      assert.ok(!seen.has(src), `${src} used by both ${seen.get(src)} and ${p.slug}`);
      seen.set(src, p.slug);
    }
  }
});
