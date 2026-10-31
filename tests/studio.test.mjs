/* -------------------------------------------------------------------------
   Studio CMS integration tests
   -------------------------------------------------------------------------

   Exercises the editorial layer through the same HTTP surface the Studio uses:
   collections, rituals, journal posts and homepage content.

   The assertions that matter most here are the boundary ones:

     - drafts never appear on public reads;
     - markup is refused before it is stored, so a public page cannot execute
       editor-supplied HTML;
     - a collection that still holds products cannot be deleted without an
       explicit reassignment;
     - editing site content cannot introduce a javascript: link.

   The database is disposable and dropped in teardown.
   ------------------------------------------------------------------------- */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import {
  startServer,
  api,
  login,
  createAdmin,
  dropDatabase,
  tcpUp,
} from './helpers/server.mjs';

const PORT = 5314;
const TEST_DB = 'mongodb://127.0.0.1:27017/astrovetro_studio_test';
const ADMIN_EMAIL = 'studio@astrovetro.test';
const ADMIN_PASSWORD = 'studio-pass-12345';

const mongoUp = await tcpUp('127.0.0.1', 27017);

describe('Studio CMS', { skip: mongoUp ? false : 'mongod is not reachable on 127.0.0.1:27017' }, () => {
  let server;
  let base;
  let cookie;
  const ids = { product: null, collection: null, collection2: null, ritual: null, post: null };

  const call = (path, opts = {}) => api(base, path, { cookie, ...opts });

  before(async () => {
    await createAdmin({ databaseUrl: TEST_DB, email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    server = await startServer({ port: PORT, databaseUrl: TEST_DB });
    base = server.base;
    cookie = await login(base, ADMIN_EMAIL, ADMIN_PASSWORD);
    assert.ok(cookie, 'admin login failed');
  });

  after(async () => {
    await server?.stop();
    await dropDatabase(TEST_DB);
  });

  it('requires an admin session for every studio collection', async () => {
    for (const path of ['/api/admin/collections', '/api/admin/rituals', '/api/admin/blog', '/api/admin/content']) {
      const out = await api(base, path);
      assert.strictEqual(out.status, 401, `${path} should require a session`);
    }
  });

  it('creates a product with SEO fields and gates it by status', async () => {
    const created = await call('/api/admin/products', {
      method: 'POST',
      body: {
        name: 'Studio Test Pendant',
        slug: 'studio-test-pendant',
        category: 'pendant',
        price: 2400,
        status: 'draft',
        productType: 'jewellery',
        seoTitle: 'Studio test pendant',
        seoDescription: 'A pendant created by the studio integration test.',
        shortDescription: 'Test piece.',
      },
    });
    assert.strictEqual(created.status, 201, JSON.stringify(created.json));
    ids.product = created.json.data.product.id;
    assert.strictEqual(created.json.data.product.publishedAt, null);

    const hidden = await api(base, '/api/products/studio-test-pendant');
    assert.strictEqual(hidden.status, 200);
    assert.strictEqual(hidden.json.data, null, 'a draft must not resolve publicly');

    const published = await call(`/api/admin/products/${ids.product}`, {
      method: 'PATCH',
      body: { status: 'active' },
    });
    assert.strictEqual(published.status, 200);
    assert.ok(published.json.data.product.publishedAt, 'publishing sets publishedAt');

    const publicProduct = await api(base, '/api/products/studio-test-pendant');
    assert.strictEqual(publicProduct.json.data.seoTitle, 'Studio test pendant');
    assert.strictEqual(publicProduct.json.data.productType, 'jewellery');

    /* A PATCH must change only what it names: publishing above must not have
       blanked the SEO copy, and editing prose must not unpublish. */
    const edited = await call(`/api/admin/products/${ids.product}`, {
      method: 'PATCH',
      body: { shortDescription: 'Edited copy.' },
    });
    assert.strictEqual(edited.status, 200);
    assert.strictEqual(edited.json.data.product.seoTitle, 'Studio test pendant');
    assert.strictEqual(edited.json.data.product.status, 'active');
    assert.strictEqual(edited.json.data.product.publishedAt, published.json.data.product.publishedAt);
  });

  it('keeps category copy when only the name is edited', async () => {
    const created = await call('/api/admin/categories', {
      method: 'POST',
      body: {
        name: 'Studio category',
        slug: 'studio-category',
        description: 'Copy that must survive a rename.',
        seoTitle: 'Studio category',
        seoDescription: 'A category created by the test suite.',
      },
    });
    assert.strictEqual(created.status, 201, JSON.stringify(created.json));

    const patched = await call('/api/admin/categories/studio-category', {
      method: 'PATCH',
      body: { name: 'Studio category renamed' },
    });
    assert.strictEqual(patched.status, 200);
    assert.strictEqual(patched.json.data.category.name, 'Studio category renamed');
    assert.strictEqual(patched.json.data.category.description, 'Copy that must survive a rename.');
    assert.strictEqual(patched.json.data.category.seoDescription, 'A category created by the test suite.');
  });

  it('creates a collection, rejects a bogus cover image, and filters products by it', async () => {
    const bad = await call('/api/admin/collections', {
      method: 'POST',
      body: { name: 'Bad image shelf', image: 'https://example.com/x.jpg' },
    });
    assert.strictEqual(bad.status, 400, 'external image paths are refused');

    const created = await call('/api/admin/collections', {
      method: 'POST',
      body: { name: 'Studio shelf', slug: 'studio-shelf', description: 'A test collection.', featured: true },
    });
    assert.strictEqual(created.status, 201, JSON.stringify(created.json));
    ids.collection = created.json.data.collection.id;

    const member = await call(`/api/admin/collections/${ids.collection}/products`, {
      method: 'PUT',
      body: { products: [ids.product] },
    });
    assert.strictEqual(member.status, 200);
    assert.strictEqual(member.json.data.collection.productCount, 1);

    const pub = await api(base, '/api/collections/studio-shelf');
    assert.strictEqual(pub.status, 200);
    assert.strictEqual(pub.json.data.slug, 'studio-shelf');
    assert.deepStrictEqual(pub.json.data.products.map((p) => p.slug), ['studio-test-pendant']);

    const filtered = await api(base, '/api/products?collection=studio-shelf&limit=50');
    assert.deepStrictEqual(filtered.json.data.map((p) => p.slug), ['studio-test-pendant']);
  });

  it('refuses to delete a collection in use, then reassigns on request', async () => {
    const second = await call('/api/admin/collections', {
      method: 'POST',
      body: { name: 'Studio shelf two', slug: 'studio-shelf-two' },
    });
    ids.collection2 = second.json.data.collection.id;

    const refused = await call(`/api/admin/collections/${ids.collection}`, { method: 'DELETE' });
    assert.strictEqual(refused.status, 409, 'a collection holding products cannot be deleted silently');

    const moved = await call(
      `/api/admin/collections/${ids.collection}?reassignTo=${ids.collection2}`,
      { method: 'DELETE' }
    );
    assert.strictEqual(moved.status, 200, JSON.stringify(moved.json));

    const target = await call(`/api/admin/collections/${ids.collection2}`);
    assert.deepStrictEqual(target.json.data.collection.products, [ids.product]);
    ids.collection = ids.collection2;
  });

  it('stores rituals as structure and refuses HTML', async () => {
    const bad = await call('/api/admin/rituals', {
      method: 'POST',
      body: { title: 'Bad ritual', description: '<script>alert(1)</script>' },
    });
    assert.strictEqual(bad.status, 422, 'markup must be refused before storage');

    const claim = await call('/api/admin/rituals', {
      method: 'POST',
      body: { title: 'A guaranteed cure', description: 'This ritual cures anxiety for good.' },
    });
    assert.strictEqual(claim.status, 422, 'medical and guaranteed-outcome claims must be refused');

    const created = await call('/api/admin/rituals', {
      method: 'POST',
      body: {
        title: 'A grounding minute',
        slug: 'a-grounding-minute',
        intro: 'One minute, one stone, one breath.',
        purpose: 'Grounding',
        duration: '2 minutes',
        materials: ['A stone', 'A quiet place'],
        steps: [
          { title: 'Begin', body: 'Hold the stone and breathe out once.' },
          { title: 'Notice', body: 'Name three things you can hear.' },
        ],
        relatedProducts: [ids.product],
        linkedProduct: ids.product,
        status: 'draft',
      },
    });
    assert.strictEqual(created.status, 201, JSON.stringify(created.json));
    ids.ritual = created.json.data.ritual.id;
    assert.strictEqual(created.json.data.ritual.steps.length, 2);

    const hidden = await api(base, '/api/rituals/a-grounding-minute');
    assert.strictEqual(hidden.json.data, null, 'a draft ritual must not resolve publicly');

    const published = await call(`/api/admin/rituals/${ids.ritual}`, {
      method: 'PATCH',
      body: { status: 'active' },
    });
    assert.strictEqual(published.status, 200);

    const pub = await api(base, '/api/rituals/a-grounding-minute');
    assert.strictEqual(pub.json.data.title, 'A grounding minute');
    assert.deepStrictEqual(pub.json.data.materials, ['A stone', 'A quiet place']);
    assert.strictEqual(pub.json.data.relatedProducts[0].slug, 'studio-test-pendant');

    const list = await api(base, '/api/rituals?limit=50');
    assert.ok(list.json.data.some((r) => r.slug === 'a-grounding-minute'));
  });

  it('publishes journal posts only when active', async () => {
    const bad = await call('/api/admin/blog', {
      method: 'POST',
      body: { title: 'Bad post', content: '<img src=x onerror=alert(1)>' },
    });
    assert.strictEqual(bad.status, 422);

    const created = await call('/api/admin/blog', {
      method: 'POST',
      body: {
        title: 'A studio note',
        slug: 'a-studio-note',
        excerpt: 'A short note from the test suite.',
        content: 'First paragraph.\n\nSecond paragraph.',
        category: 'journal',
        status: 'draft',
      },
    });
    assert.strictEqual(created.status, 201, JSON.stringify(created.json));
    ids.post = created.json.data.post.id;

    const hidden = await api(base, '/api/articles/a-studio-note');
    assert.strictEqual(hidden.json.data, null, 'a draft post is private');

    const published = await call(`/api/admin/blog/${ids.post}`, {
      method: 'PATCH',
      body: { status: 'active' },
    });
    assert.strictEqual(published.status, 200);
    assert.ok(published.json.data.post.publishedAt);

    const pub = await api(base, '/api/articles/a-studio-note');
    assert.strictEqual(pub.json.data.title, 'A studio note');
    assert.strictEqual(pub.json.data.readingTime, 1);
    assert.strictEqual(pub.json.data.content, 'First paragraph.\n\nSecond paragraph.');

    const archived = await call(`/api/admin/blog/${ids.post}/archive`, { method: 'POST' });
    assert.strictEqual(archived.status, 200);
    const gone = await api(base, '/api/articles/a-studio-note');
    assert.strictEqual(gone.json.data, null, 'an archived post must stop resolving publicly');
  });

  it('edits homepage content, rejects unsafe links, and serves it publicly', async () => {
    const unsafe = await call('/api/admin/content/homepage', {
      method: 'PUT',
      body: { homepage: { ritualsCtaHref: 'javascript:alert(1)' } },
    });
    assert.strictEqual(unsafe.status, 422, 'a javascript: CTA link must be refused');

    const saved = await call('/api/admin/content/homepage', {
      method: 'PUT',
      body: {
        homepage: {
          heroEyebrow: 'Our approach',
          heroTitle: 'Come back to\nyourself.',
          heroIntro: 'Edited by the studio test.',
          ritualsCtaLabel: 'Enter rituals',
          ritualsCtaHref: '/rituals',
          seoTitle: 'Astro Vetro',
          seoDescription: 'Objects with intention.',
        },
        contact: { email: 'studio@astrovetro.test' },
      },
    });
    assert.strictEqual(saved.status, 200, JSON.stringify(saved.json));

    const pub = await api(base, '/api/content/homepage');
    assert.strictEqual(pub.status, 200);
    assert.strictEqual(pub.json.data.homepage.heroIntro, 'Edited by the studio test.');
    assert.strictEqual(pub.json.data.homepage.ritualsCtaHref, '/rituals');
    assert.strictEqual(pub.json.data.contact.email, 'studio@astrovetro.test');

    /* A partial save writes only the named field; everything else survives. */
    const partial = await call('/api/admin/content/homepage', {
      method: 'PUT',
      body: { contact: { phone: '+91 90000 00000' } },
    });
    assert.strictEqual(partial.status, 200);
    assert.strictEqual(partial.json.data.content.contact.phone, '+91 90000 00000');
    assert.strictEqual(partial.json.data.content.contact.email, 'studio@astrovetro.test');
    assert.strictEqual(partial.json.data.content.homepage.heroIntro, 'Edited by the studio test.');
  });
});
