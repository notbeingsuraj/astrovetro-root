/* Storefront wiring: the pages must render the catalogue's real photography
   and must never reference Google Photos or any other temporary image host.
   These are static checks on purpose — they fail the moment someone rewires
   a page back to placeholders or hotlinks the shared album. */

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const PUBLIC_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'public');
const read = (p) => fs.readFileSync(path.join(PUBLIC_DIR, p), 'utf8');

test('product page renders the photo gallery with alt text and a fallback', () => {
  const html = read('product.html');
  assert.ok(html.includes('pd-photo'), 'the gallery block is missing');
  assert.ok(html.includes('imageAlts'), 'gallery must use the per-photo alt text');
  assert.ok(html.includes('-thumb.webp'), 'the thumb strip is missing');
  assert.ok(html.includes('AV.art('), 'the gradient fallback for photo-less products is gone');
  assert.ok(html.includes('object-fit: cover'), 'photos must not be stretched');
});

test('shop cards render catalogue photography', () => {
  const store = read('assets/store.js');
  assert.ok(store.includes('p.images?.[0]'), 'cards must read the first catalogue image');
  assert.ok(store.includes('has-photo'), 'cards must use the photo variant of the art block');
});

test('no page hotlinks Google Photos or other temporary image hosts', () => {
  const offenders = [];
  for (const file of fs.readdirSync(PUBLIC_DIR)) {
    if (!file.endsWith('.html')) continue;
    const text = read(file);
    if (/googleusercontent|photos\.google|lh3\./i.test(text)) offenders.push(file);
  }
  assert.deepStrictEqual(offenders, [], `hotlinked album imagery in: ${offenders.join(', ')}`);
});
