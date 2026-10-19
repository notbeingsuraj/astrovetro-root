/* -------------------------------------------------------------------------
   Non-destructive catalogue migration
   -------------------------------------------------------------------------

   Brings existing database products in line with the corrected catalogue:
     - replaces the dead /product-*.png image paths with the real, locally
       stored photography from src/data/catalogue.js (images + imageAlts)
     - assigns an SKU where a product has none (derived from its slug, which
       is unique, so this cannot collide)
     - flags products whose photo mapping was not confidently matched
     - ensures every category referenced by a product exists as a document
     - records an opening StockMovement for every product that already carries
       a numeric stock balance, so the ledger starts from a stated truth
       instead of an invisible one

   It never drops, resets or deletes anything. Every write is guarded so the
   script is safe to run twice: re-running it changes nothing that is already
   in place. Run with:  npm run migrate:catalogue
   ------------------------------------------------------------------------- */

import 'dotenv/config';
import mongoose from 'mongoose';
import { Product, defaultSku } from '../src/models/Product.js';
import { Category } from '../src/models/Category.js';
import { StockMovement } from '../src/models/StockMovement.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { products as catalogue } from '../src/data/catalogue.js';
import manifest from '../docs/image-manifest.json' with { type: 'json' };

const uri = process.env.DATABASE_URL || process.env.MONGODB_URI;
if (!uri) {
  console.error('No DATABASE_URL / MONGODB_URI in the environment. Aborting.');
  process.exit(1);
}

/* Every category the catalogue references, in the order the shop lists them. */
const CATEGORY_SEEDS = [
  { slug: 'ring', name: 'Rings' },
  { slug: 'bracelet', name: 'Bracelets' },
  { slug: 'pendant', name: 'Pendants' },
  { slug: 'tower', name: 'Towers' },
  { slug: 'cluster', name: 'Clusters' },
  { slug: 'tumble', name: 'Tumbles' },
  { slug: 'raw', name: 'Raw' },
  { slug: 'other', name: 'Other' },
];

async function main() {
  await mongoose.connect(uri);
  console.log('connected:', mongoose.connection.name);

  const bySlug = new Map(catalogue.map((p) => [p.slug, p]));
  let imagesSynced = 0;
  let skusAssigned = 0;
  let flagged = 0;
  let openings = 0;

  const products = await Product.find({});
  for (const product of products) {
    const source = bySlug.get(product.slug);
    if (!source) {
      /* A product that is no longer in the catalogue is left exactly as it is
         — archiving is an administrator's decision, not a script's. */
      console.log('  (no catalogue entry, left untouched):', product.slug);
      continue;
    }

    const nextImages = source.images || [];
    const nextAlts = source.imageAlts || [];
    const changed = {};

    /* Only rewrite the images when they differ, so repeated runs do not touch
       updatedAt or produce audit noise. imageAlts is checked on its own
       because the two arrays are parallel: a database migrated before the alt
       texts existed can carry the right images with empty alts, and the image
       comparison alone would never correct it. */
    const imagesDiffer = JSON.stringify(product.images || []) !== JSON.stringify(nextImages);
    const altsDiffer = JSON.stringify(product.imageAlts || []) !== JSON.stringify(nextAlts);
    if (imagesDiffer || altsDiffer) {
      changed.images = nextImages;
      changed.imageAlts = nextAlts;
      imagesSynced++;
    }

    if (!product.sku) {
      changed.sku = defaultSku(product.slug);
      skusAssigned++;
    }

    /* Surface the mapping's own honesty flag on the record the dashboard
       reads, so nobody has to consult a document to know what is unverified. */
    const entry = manifest[product.slug];
    if (entry && entry.needsReview) {
      changed.needsReview = true;
      changed.reviewNote = String(entry.note || 'Photo mapping needs human review.').slice(0, 500);
      flagged++;
    }

    if (Object.keys(changed).length) {
      await Product.updateOne({ _id: product._id }, { $set: changed });
    }

    /* Opening movement: only for a tracked numeric balance that has no ledger
       history at all. An existing ledger is never rewritten. */
    if (product.stock != null) {
      const alreadyLogged = await StockMovement.exists({ product: product._id });
      if (!alreadyLogged) {
        await StockMovement.create({
          product: product._id,
          sku: product.sku || defaultSku(product.slug),
          productName: product.name,
          type: 'opening',
          quantity: product.stock,
          balanceBefore: 0,
          balanceAfter: product.stock,
          reason: 'Opening balance recorded during the catalogue migration.',
          reference: 'migration:catalogue',
          actor: { userId: null, email: 'migration:catalogue', role: 'system' },
        });
        openings++;
      }
    }
  }

  /* Lifecycle backfill: products created before the status field existed have
     no value at all, which would hide them from the public catalogue. They
     were all publicly listed, so 'active' is the truthful backfill. */
  const statusBackfill = await Product.updateMany(
    { $or: [{ status: { $exists: false } }, { status: null }] },
    { $set: { status: 'active' } }
  );

  /* Categories: insert the seeds that are missing; never delete or rename. */
  let categoriesCreated = 0;
  for (const seed of CATEGORY_SEEDS) {
    const exists = await Category.exists({ slug: seed.slug });
    if (!exists) {
      await Category.create({ ...seed, active: true });
      categoriesCreated++;
    }
  }

  await AuditLog.create({
    actor: { userId: null, email: 'migration:catalogue', role: 'system' },
    action: 'migration.catalogue',
    entity: { type: 'migration', id: 'catalogue-images', label: 'Catalogue image + SKU migration' },
    summary: `images synced: ${imagesSynced}, skus assigned: ${skusAssigned}, flagged for review: ${flagged}, openings logged: ${openings}, categories created: ${categoriesCreated}, statuses backfilled: ${statusBackfill.modifiedCount}`,
  });

  console.log({
    imagesSynced,
    skusAssigned,
    flagged,
    openings,
    categoriesCreated,
    statusBackfilled: statusBackfill.modifiedCount,
  });
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
