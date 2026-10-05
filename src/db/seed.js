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

import { products } from '../data/catalogue.js';
import { Product } from '../models/Product.js';
import { isConnected } from './connect.js';

/* Fields copied from the catalogue. `stock` is deliberately absent: it is live
   inventory, not catalogue content. */
const COPYABLE = [
  'slug',
  'name',
  'category',
  'images',
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
 * Called on boot. A no-op once products exist, so it costs one count on every
 * start and nothing after that.
 */
export async function seedIfEmpty({ quiet = false } = {}) {
  if (!isConnected()) return null;
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
    await disconnectDB();
  } catch (err) {
    console.error('[seed] failed:', err.message);
    process.exitCode = 1;
  }
}
