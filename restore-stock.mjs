/* One-off: the E2E run placed real COD orders against the seeded catalogue and
   decremented stock, so several demo pieces are now sold out. The seed
   deliberately preserves existing stock, so it will not bring them back. */
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from './src/db/connect.js';
import { seedCatalogue } from './src/db/seed.js';

await connectDB();
const out = await mongoose.connection.db.collection('products').find({}).toArray();
const drained = out.filter((p) => (p.stock ?? 0) < 5);
console.log('drained:', drained.map((p) => `${p.slug}=${p.stock}`).join(' ') || '(none)');
for (const p of drained) {
  await mongoose.connection.db
    .collection('products')
    .updateOne({ slug: p.slug }, { $set: { stock: 12, trackStock: true } });
}
console.log('restored', drained.length, 'products to stock 12');
await seedCatalogue({ quiet: true });
await disconnectDB();
