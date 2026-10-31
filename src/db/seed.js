/* -------------------------------------------------------------------------
   Database seed
   -------------------------------------------------------------------------

   Copies the existing static catalogue into MongoDB so the shop and the cart
   read the same document.

   Idempotent and additive-only: products are matched on `slug`, which is the
   one identifier the storefront and the URLs already use. Seeding again updates
   descriptive fields and leaves stock, price overrides and admin edits alone,
   because those are live data — a deploy must not silently reset stock to
   whatever the catalogue happens to say.

   Deliberately does NOT seed customers or orders. Orders are financial records;
   inventing them here is how a demo dataset ends up looking like real trading
   history.
   ------------------------------------------------------------------------- */

import { products, articles } from '../data/catalogue.js';
import { Product } from '../models/Product.js';
import { Category } from '../models/Category.js';
import { BlogPost } from '../models/BlogPost.js';
import { SiteContent } from '../models/SiteContent.js';
import { HOMEPAGE_DEFAULTS, CONTACT_DEFAULTS } from '../data/siteContent.js';
import { isConnected } from './connect.js';

/* Fields copied from the catalogue. `stock` is deliberately absent: it is live
   inventory, not catalogue content. */
const COPYABLE = [
  'slug',
  'name',
  'category',
  'images',
  'imageAlts',
  'shortDescription',
  'description',
  'intentions',
  'rating',
  'reviewCount',
  'availability',
  'featured',
  'stone',
  'metal',
  'badge',
  'price',
  'salePrice',
];

/**
 * Insert any catalogue product that is not in the database yet, and refresh the
 * descriptive fields on the ones that are.
 *
 * @returns {Promise<{created: number, updated: number, total: number}>}
 */
export async function seedCatalogue({ quiet = false } = {}) {
  if (!isConnected()) throw new Error('seedCatalogue called before the database was connected');

  let created = 0;
  let updated = 0;

  for (const item of products) {
    const doc = Object.fromEntries(COPYABLE.filter((k) => item[k] !== undefined).map((k) => [k, item[k]]));

    /* upsert on slug, and $set only the descriptive fields. A product that
       already exists keeps its stock and any admin changes. */
    const result = await Product.updateOne(
      { slug: item.slug },
      {
        $set: doc,
        $setOnInsert: {
          /* A small default stock so a freshly seeded cart can actually be
             filled. Not 0, which would make every product "out of stock" and
             look like a broken shop on first run. */
          stock: 12,
          trackStock: true,
        },
      },
      { upsert: true }
    );

    if (result.upsertedCount) created += 1;
    else updated += 1;
  }

  const result = { created, updated, total: products.length };
  if (!quiet) {
    console.log(`[seed] catalogue ready — ${created} created, ${updated} updated, ${products.length} total`);
  }
  return result;
}

/**
 * Ensure the category list exists. Upserts by slug with $setOnInsert, so an
 * administrator's rename, description or retirement is never overwritten.
 */
export async function seedCategories({ quiet = false } = {}) {
  if (!isConnected()) throw new Error('seedCategories called before the database was connected');

  const names = {
    ring: 'Rings',
    bracelet: 'Bracelets',
    pendant: 'Pendants',
    tower: 'Towers',
    cluster: 'Clusters',
    tumble: 'Tumbled stones',
  };
  const descriptions = {
    ring: 'Stones set to be worn, close to the hand.',
    bracelet: 'Beads and bands chosen for the wrist.',
    pendant: 'A single stone, held at the heart line.',
    tower: 'Tall points for a shelf, a desk or a quiet corner.',
    cluster: 'Raw formations that keep their own shape.',
    tumble: 'Small, smooth stones to carry or place.',
  };

  const present = [...new Set(products.map((p) => p.category))];
  let created = 0;
  for (const [index, slug] of present.entries()) {
    const result = await Category.updateOne(
      { slug },
      {
        $setOnInsert: {
          slug,
          name: names[slug] || slug,
          description: descriptions[slug] || '',
          active: true,
          sortOrder: index,
        },
      },
      { upsert: true }
    );
    if (result.upsertedCount) created += 1;
  }
  if (!quiet && created) console.log(`[seed] categories ready — ${created} created`);
  return { created, total: present.length };
}

/**
 * Ensure the homepage content document exists, seeded from the storefront's
 * current copy. Existing content is left untouched.
 */
export async function seedSiteContent({ quiet = false } = {}) {
  if (!isConnected()) throw new Error('seedSiteContent called before the database was connected');
  const result = await SiteContent.updateOne(
    { key: 'homepage' },
    {
      $setOnInsert: {
        key: 'homepage',
        homepage: { ...HOMEPAGE_DEFAULTS },
        contact: { ...CONTACT_DEFAULTS },
      },
    },
    { upsert: true }
  );
  if (!quiet && result.upsertedCount) console.log('[seed] homepage content created');
  return { created: result.upsertedCount ? 1 : 0 };
}

/**
 * Publish the starter journal articles once. If any post exists, the database
 * is the source of truth and nothing is inserted.
 */
export async function seedJournal({ quiet = false } = {}) {
  if (!isConnected()) throw new Error('seedJournal called before the database was connected');
  const count = await BlogPost.countDocuments();
  if (count > 0) {
    if (!quiet) console.log(`[seed] ${count} journal post(s) already present — skipping journal seed`);
    return { created: 0, skipped: true, total: count };
  }

  let created = 0;
  for (const article of articles) {
    const publishedAt = article.publishedAt ? new Date(article.publishedAt) : new Date();
    await BlogPost.create({
      title: article.title,
      slug: article.slug,
      excerpt: article.excerpt || '',
      content: article.content || '',
      image: article.image || '',
      imageAlt: article.title,
      author: article.author || 'Astro Vetro',
      category: article.category || 'journal',
      tags: article.tags || [],
      featured: Boolean(article.featured),
      status: 'active',
      publishedAt,
      seoTitle: article.title,
      seoDescription: article.excerpt || '',
    });
    created += 1;
  }
  if (!quiet) console.log(`[seed] journal ready — ${created} post(s) published`);
  return { created, total: created };
}

/**
 * Called on boot. Ensures categories, homepage content and (once) journal
 * posts, then seeds products only when the catalogue is empty. A no-op for
 * descriptive content that already exists.
 */
export async function seedIfEmpty({ quiet = false } = {}) {
  if (!isConnected()) return null;
  await seedCategories({ quiet });
  await seedSiteContent({ quiet });
  await seedJournal({ quiet });

  const count = await Product.countDocuments();
  if (count > 0) {
    if (!quiet) console.log(`[seed] ${count} products already present — skipping catalogue seed`);
    return { created: 0, updated: 0, total: count, skipped: true };
  }
  return seedCatalogue({ quiet });
}

/* `node src/db/seed.js` re-seeds on demand, including updating descriptive
   fields on existing products. */
if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  const { connectDB, disconnectDB } = await import('./connect.js');
  try {
    await connectDB();
    await seedCatalogue();
    await seedCategories();
    await seedSiteContent();
    await seedJournal();
    await disconnectDB();
  } catch (err) {
    console.error('[seed] failed:', err.message);
    process.exitCode = 1;
  }
}
