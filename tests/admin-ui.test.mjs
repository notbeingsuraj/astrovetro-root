/* The admin desk must have no dead links and no calls to endpoints that do not
   exist. These are static checks that pair with the live API tests: the flows
   test proves the endpoints behave, this file proves every tab the desk
   offers actually has a renderer and that every path the UI builds maps to a
   route the server defines. */

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const adminJs = fs.readFileSync(path.join(ROOT, 'public/assets/admin.js'), 'utf8');
const adminHtml = fs.readFileSync(path.join(ROOT, 'public/admin.html'), 'utf8');
const routesJs = fs.readFileSync(path.join(ROOT, 'src/routes/admin.js'), 'utf8');

test('admin.html is a shell that loads the shared libraries and admin.js', () => {
  /* Only the script tags count — a comment mentioning a file is not a load. */
  const loaded = [...adminHtml.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  const order = ['/assets/api.js', '/assets/store.js', '/assets/customer.js', '/assets/admin.js'];
  const positions = order.map((lib) => loaded.indexOf(lib));
  positions.forEach((at, i) => assert.ok(at > -1, `${order[i]} is not loaded by admin.html`));
  assert.ok(
    positions.every((at, i) => i === 0 || at > positions[i - 1]),
    `scripts load out of order: ${loaded.join(', ')}`
  );
  assert.ok(adminHtml.includes('<style>'), 'admin-scoped styles are missing');
  assert.ok(!/AV\.api\./.test(adminHtml), 'admin.html must not carry view logic inline');
});

test('every navigation tab has a renderer', () => {
  const tabsBlock = adminJs.match(/const TABS = \[([\s\S]*?)\];/);
  assert.ok(tabsBlock, 'TABS is missing');
  const keys = [...tabsBlock[1].matchAll(/\['([a-z-]+)',/g)].map((m) => m[1]);
  assert.ok(keys.length >= 13, `expected the full module list, found ${keys.length} tabs`);

  const viewsBlock = adminJs.match(/const VIEWS = \{([\s\S]*?)\};/);
  assert.ok(viewsBlock, 'VIEWS is missing');
  /* The renderer for a tab may be referenced by key, by the function's own
     name, or through an explicit `key: fn` mapping — all three count. */
  const fnNames = {
    'purchase-orders': 'purchaseOrders',
    images: 'imageLibrary',
  };
  for (const key of keys) {
    const fn = fnNames[key] || key;
    const mapped =
      viewsBlock[1].includes(`${key}:`) ||
      viewsBlock[1].includes(`${fn},`) ||
      viewsBlock[1].includes(`${fn}\n`);
    assert.ok(mapped, `tab "${key}" has no entry in VIEWS`);
    assert.ok(
      new RegExp(`(async )?function ${fn}\\(`).test(adminJs),
      `renderer ${fn} for tab "${key}" is not defined`
    );
  }
});

test('every admin API path the UI calls exists as a server route', () => {
  /* Server routes, with :param segments normalised to a wildcard. */
  const serverPaths = new Set();
  for (const m of routesJs.matchAll(/router\.(get|post|patch|put|delete)\(\s*'([^']+)'/g)) {
    serverPaths.add(m[2].replace(/:[A-Za-z]+/g, '*'));
  }
  assert.ok(serverPaths.size >= 30, `route table looks too small: ${serverPaths.size}`);

  /* Where the UI names an admin path: API helper calls (backtick templates and
     plain single-quoted strings), raw fetches, and download hrefs. */
  const sources = [
    ...[...adminJs.matchAll(/AV\.api\.(?:get|post|patch|put|del)\(\s*`(\/api\/admin\/[^`]*)`/g)].map((m) => m[1]),
    ...[...adminJs.matchAll(/AV\.api\.(?:get|post|patch|put|del)\(\s*'(\/api\/admin\/[^']*)'/g)].map((m) => m[1]),
    ...[...adminJs.matchAll(/fetch\(\s*`(\/api\/admin\/[^`]*)`/g)].map((m) => m[1]),
    ...[...adminJs.matchAll(/href="(\/api\/admin\/[^"]*)"/g)].map((m) => m[1]),
  ];
  assert.ok(sources.length >= 20, `expected the desk to reference many endpoints, found ${sources.length}`);

  const expand = (template) => {
    /* Groups that build a query string (they contain a nested template) do not
       change the path — drop them before splitting. */
    let t = template.replace(/\$\{[^}`]*`[^`]*`[^}]*\}/g, '');
    const parts = t.split(/\$\{[^}]*\}/);
    const groups = [...t.matchAll(/\$\{([^}]*)\}/g)].map((m) => {
      const lits = [...m[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map((x) => x[1] || x[2]).filter((x) => x !== '');
      return lits.length ? lits : ['*'];
    });
    let out = [''];
    parts.forEach((seg, i) => {
      const next = [];
      for (const base of out) for (const g of groups[i] || ['']) next.push(base + seg + g);
      out = next;
    });
    /* A `?` may live inside a group (`${x ? 'a' : 'b'}`) — only cut the query
       string once every group has been resolved into a literal. */
    return out.map((p) => p.split('?')[0]);
  };

  const missing = [];
  for (const source of sources) {
    for (const p of expand(source)) {
      if (!p.startsWith('/api/admin/')) continue;
      /* Server routes are declared relative to the /api/admin mount. */
      const rel = p.slice('/api/admin'.length);
      const rx = new RegExp(
        `^${rel.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]+')}$`
      );
      const found = [...serverPaths].some((sp) => rx.test(sp));
      if (!found) missing.push(p);
    }
  }
  assert.deepStrictEqual(missing, [], `UI calls routes the server does not define:\n${missing.join('\n')}`);
});

test('the desk does not call the endpoints the old stub invented', () => {
  for (const dead of ['/api/bookings', '/api/newsletter', '/api/contact']) {
    assert.ok(!adminJs.includes(dead), `the old dead endpoint ${dead} is back`);
  }
});

test('no debug leftovers in the admin bundle', () => {
  assert.ok(!adminJs.includes('debugger'), 'debugger statement');
  assert.ok(!/console\.log/.test(adminJs), 'console.log left in');
});
