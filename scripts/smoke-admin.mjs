/* -------------------------------------------------------------------------
   Live admin smoke — the click-through, at the API level
   -------------------------------------------------------------------------

   The admin desk is a thin shell: every button it renders calls one of these
   endpoints. This script signs in as the dev admin against the RUNNING dev
   server (http://localhost:5173 by default) and exercises every route the
   desk's 13 modules touch, checking status codes and that responses carry
   real data rather than an error envelope.

   It complements tests/admin-ui.test.mjs (which proves the wiring statically,
   against an isolated test database) by proving the same paths answer on the
   developer's own machine, with the developer's own data.

   Usage:  node scripts/smoke-admin.mjs [baseUrl]
   Env:    AV_ADMIN_EMAIL / AV_ADMIN_PASSWORD (defaults to the dev admin)
   ------------------------------------------------------------------------- */

import 'dotenv/config';

const BASE = (process.argv[2] || process.env.AV_SMOKE_BASE || 'http://127.0.0.1:5173').replace(/\/$/, '');
const EMAIL = process.env.AV_ADMIN_EMAIL || 'admin@astrovetro.com';
const PASSWORD = process.env.AV_ADMIN_PASSWORD || 'astrovetro-dev-2026';

let cookie = null;
const failures = [];

async function call(method, path, body) {
  const headers = { Origin: BASE };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* CSV or plain-text responses */
  }
  return { status: res.status, json, res, setCookies };
}

function check(label, out, { expect = 200, dataPath = null, min = 1 } = {}) {
  const problems = [];
  if (out.status !== expect) problems.push(`status ${out.status}, expected ${expect}`);
  if (out.json && out.json.success === false) {
    problems.push(`error envelope: ${out.json.error?.code || out.json.message || 'unknown'}`);
  }
  if (dataPath && out.json) {
    const value = dataPath.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), out.json);
    if (value == null) problems.push(`missing ${dataPath}`);
    else if (Array.isArray(value) && value.length < min) problems.push(`${dataPath} has ${value.length}, expected >= ${min}`);
  }
  if (problems.length) {
    failures.push(`${label}: ${problems.join('; ')}`);
    console.log(`  ✖ ${label} — ${problems.join('; ')}`);
  } else {
    console.log(`  ✔ ${label}`);
  }
}

async function main() {
  /* 1. Status and authentication ------------------------------------------ */
  console.log(`smoking ${BASE} as ${EMAIL}`);
  const status = await call('GET', '/api/status');
  check('GET /api/status', status);
  if (status.json?.data?.provider !== 'mongo') {
    failures.push(`server is not on the mongo provider (got ${status.json?.data?.provider}) — the desk cannot work`);
  }

  const login = await call('POST', '/api/auth/login', { email: EMAIL, password: PASSWORD });
  check('POST /api/auth/login', login);
  const hit = login.setCookies.find((c) => c.startsWith('av_token='));
  if (!hit) {
    console.log('\nCould not sign in — create the admin first: node scripts/create-admin.mjs ' + EMAIL);
    process.exit(1);
  }
  cookie = hit.split(';')[0];

  /* Authz sanity: the same routes must refuse the anonymous caller. */
  const anon = await fetch(BASE + '/api/admin/dashboard');
  if (anon.status !== 401) failures.push(`anonymous /api/admin/dashboard returned ${anon.status}, expected 401`);
  else console.log('  ✔ anonymous caller refused with 401');

  /* 2. Overview + Orders --------------------------------------------------- */
  const dash = await call('GET', '/api/admin/dashboard');
  check('GET /api/admin/dashboard', dash, { dataPath: 'data.total' });

  const orders = await call('GET', '/api/admin/orders');
  check('GET /api/admin/orders', orders, { dataPath: 'data' });

  /* 3. Products ------------------------------------------------------------ */
  const products = await call('GET', '/api/admin/products');
  check('GET /api/admin/products', products, { dataPath: 'data.items', min: 12 });

  /* One fixed slug, reused on every run: the smoke restores it if a previous
     run archived it, so repeated smokes never pile up residue in the dev
     catalogue. Archive is the product's designed terminal state — there is no
     hard delete — so accumulating one throwaway document per run would be a
     slow, silent leak of the developer's own data. */
  const SLUG = 'smoke-test-item';
  const found = await call('GET', `/api/admin/products?search=${SLUG}`);
  const existing = (found.json?.data?.items || []).find((p) => p.slug === SLUG);
  let createdId;
  if (existing) {
    createdId = existing._id || existing.id;
    const restored = await call('POST', `/api/admin/products/${createdId}/restore`);
    check('POST /api/admin/products/:id/restore (reuse from a previous run)', restored);
  } else {
    const created = await call('POST', '/api/admin/products', {
      name: 'Smoke Test Item',
      slug: SLUG,
      category: 'other',
      price: 111,
      description: 'Temporary product created by scripts/smoke-admin.mjs.',
    });
    check('POST /api/admin/products (create)', created, { expect: 201 });
    createdId = created.json?.data?.product?._id || created.json?.data?.product?.id;
  }
  if (!createdId) {
    failures.push('created product has no id — cannot continue the write-path smoke');
  } else try {
    const updated = await call('PATCH', `/api/admin/products/${createdId}`, { price: 222 });
    check('PATCH /api/admin/products/:id (update)', updated);
    check('PATCH /api/admin/products/:id (update)', updated);

    /* 4. Inventory — the ledger, not a direct stock write ------------------ */
    const table = await call('GET', '/api/admin/inventory/table');
    check('GET /api/admin/inventory/table', table, { dataPath: 'data', min: 1 });

    /* A brand-new product is untracked (stock: null). The ledger refuses a
       delta against an untracked balance by design — 409, "record an opening
       balance first" — so on a fresh run the smoke proves BOTH the refusal
       and the correct opening-then-delta sequence the desk's own form
       produces. On a reused (already tracked) run it proves the delta path
       against a live balance, which is the racing-withdrawal case the
       concurrency tests cover. */
    const before = (await call('GET', `/api/admin/products?search=${SLUG}`)).json?.data?.items?.find(
      (p) => (p._id || p.id) === createdId
    );
    const alreadyTracked = before && before.stock != null;

    if (!alreadyTracked) {
      const premature = await call('POST', `/api/admin/inventory/adjust/${createdId}`, {
        mode: 'delta',
        quantity: 25,
        reason: 'smoke: should be refused — product is untracked',
      });
      if (premature.status !== 409) {
        failures.push(`delta against an untracked product returned ${premature.status}, expected the 409 the ledger promises`);
      } else console.log('  ✔ delta against an untracked product correctly refused with 409');

      const opening = await call('POST', `/api/admin/inventory/adjust/${createdId}`, {
        mode: 'set',
        type: 'opening',
        quantity: 10,
        reason: 'smoke: opening balance',
      });
      check('POST /api/admin/inventory/adjust/:id (opening)', opening);
    }

    const adjust = await call('POST', `/api/admin/inventory/adjust/${createdId}`, {
      mode: 'delta',
      type: 'adjustment',
      quantity: 15,
      reason: 'smoke: stocktake top-up',
    });
    check('POST /api/admin/inventory/adjust/:id (delta)', adjust);

    const movements = await call('GET', '/api/admin/inventory/movements');
    check('GET /api/admin/inventory/movements (ledger)', movements, { dataPath: 'data', min: 1 });

    const expectedStock = (alreadyTracked ? before.stock : 10) + 15;
    const afterAdjust = await call('GET', '/api/admin/products');
    const row = (afterAdjust.json?.data?.items || []).find((p) => (p._id || p.id) === createdId);
    if (!row || row.stock !== expectedStock) {
      failures.push(`inventory adjust did not stick (stock is ${row?.stock}, expected ${expectedStock})`);
    } else console.log(`  ✔ ledger adjustment reflected in product stock (${expectedStock})`);

    /* CSV export of the ledger */
    const csv = await fetch(`${BASE}/api/admin/reports/movements.csv`, { headers: { Cookie: cookie } });
    const csvText = await csv.text();
    if (csv.status !== 200 || !/product|quantity/i.test(csvText)) {
      failures.push(`reports/movements.csv returned ${csv.status} or is not CSV-shaped`);
    } else console.log('  ✔ GET /api/admin/reports/movements.csv downloads real CSV');
  } finally {
    /* Archive the smoke product so the dev catalogue stays clean. Runs even
       when a check above threw — a smoke run must never leave residue. */
    const archived = await call('POST', `/api/admin/products/${createdId}/archive`);
    check('POST /api/admin/products/:id/archive (cleanup)', archived);
  }

  /* 5. Categories, Suppliers, Purchase Orders ------------------------------ */
  const categories = await call('GET', '/api/admin/categories');
  check('GET /api/admin/categories', categories, { dataPath: 'data', min: 1 });

  const suppliers = await call('GET', '/api/admin/suppliers');
  check('GET /api/admin/suppliers', suppliers, { dataPath: 'data' });

  const pos = await call('GET', '/api/admin/purchase-orders');
  check('GET /api/admin/purchase-orders', pos, { dataPath: 'data' });

  /* 6. Image Library + Reports + Users + Audit + Settings ------------------ */
  const library = await call('GET', '/api/admin/images/library');
  check('GET /api/admin/images/library', library, { dataPath: 'data' });

  const reports = await call('GET', '/api/admin/reports/products.csv');
  if (reports.status !== 200) failures.push(`reports/products.csv returned ${reports.status}`);
  else console.log('  ✔ GET /api/admin/reports/products.csv');

  const users = await call('GET', '/api/admin/users');
  check('GET /api/admin/users', users, { dataPath: 'data' });

  const audit = await call('GET', '/api/admin/audit');
  check('GET /api/admin/audit', audit, { dataPath: 'data' });

  const settings = await call('GET', '/api/admin/settings');
  check('GET /api/admin/settings', settings);

  /* 7. Storefront still serves the pages the desk links to ---------------- */
  for (const page of ['/', '/shop.html', '/product.html', '/cart.html', '/account.html', '/orders.html']) {
    const res = await fetch(BASE + page);
    if (!res.ok) failures.push(`page ${page} returned ${res.status}`);
  }
  console.log('  ✔ storefront pages answer 200');

  console.log('');
  if (failures.length) {
    console.log(`SMOKE FAILED — ${failures.length} problem(s):`);
    for (const f of failures) console.log('  - ' + f);
    process.exit(1);
  }
  console.log('SMOKE PASSED — every admin endpoint the desk calls answered with real data.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
