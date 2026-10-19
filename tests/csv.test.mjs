/* CSV exports open in spreadsheets, so two properties of the escaping matter:
   a comma or quote in a product name must not shift columns, and a leading
   = + - @ must not become a live formula. */

import test from 'node:test';
import assert from 'node:assert';
import { csvCell, buildCsv } from '../src/utils/csv.js';

test('neutralises formula triggers before quoting', () => {
  assert.strictEqual(csvCell('=EVIL()'), "'=EVIL()");
  assert.strictEqual(csvCell('+1+1'), "'+1+1");
  assert.strictEqual(csvCell('-cmd'), "'-cmd");
  assert.strictEqual(csvCell('@import'), "'@import");
});

test('quotes commas, quotes and newlines', () => {
  assert.strictEqual(csvCell('Plain'), 'Plain');
  assert.strictEqual(csvCell('a,b'), '"a,b"');
  assert.strictEqual(csvCell('say "hi"'), '"say ""hi"""');
  assert.strictEqual(csvCell('line1\nline2'), '"line1\nline2"');
  assert.strictEqual(csvCell(null), '');
  assert.strictEqual(csvCell(undefined), '');
});

test('buildCsv keeps columns aligned for hostile content', () => {
  const csv = buildCsv(
    [
      { key: 'name', label: 'Name' },
      { key: 'price', label: 'Price' },
    ],
    [
      { name: '=HYPERLINK("http://evil")', price: 10 },
      { name: 'Rose, "Quartz"', price: 20 },
    ]
  );
  const lines = csv.split('\r\n');
  assert.strictEqual(lines[0], 'Name,Price');
  assert.ok(lines[1].includes("'=HYPERLINK"), 'formula cell must be prefixed before quoting');
  assert.ok(lines[2].includes('"Rose, ""Quartz"""'), 'commas and quotes must be escaped');
});
