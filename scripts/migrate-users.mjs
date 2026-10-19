/* -------------------------------------------------------------------------
   Migrate legacy user rows to the current User schema
   -------------------------------------------------------------------------

   The database still holds accounts written by the previous backend, whose
   shape was firstName/lastName/password/isActive. The current model expects
   name/email/passwordHash/phone/tokenVersion, so those rows fail validation
   on save (most visibly the admin account, which cannot log in or be edited).

   This migration rewrites each legacy row in place — same _id, same email, so
   every existing reference (orders, addresses) keeps pointing at the same
   account. Nothing is deleted. Where a legacy `password` hash exists it is
   carried across verbatim: it is already a bcrypt hash, so it keeps working
   without ever handling a plaintext. Run: npm run migrate:users
   ------------------------------------------------------------------------- */

import 'dotenv/config';
import mongoose from 'mongoose';
import { User } from '../src/models/User.js';

const uri = process.env.DATABASE_URL || process.env.MONGODB_URI;
if (!uri) {
  console.error('No DATABASE_URL / MONGODB_URI in the environment. Aborting.');
  process.exit(1);
}

async function main() {
  await mongoose.connect(uri);
  const users = await mongoose.connection.db.collection('users').find({}).toArray();

  let migrated = 0;
  let skipped = 0;

  for (const row of users) {
    const hasLegacyShape = row.firstName !== undefined || row.lastName !== undefined;
    const missingCore = !row.name || !row.passwordHash;
    if (!hasLegacyShape && !missingCore) {
      skipped++;
      continue;
    }

    const name =
      [row.firstName, row.lastName].filter(Boolean).join(' ').trim() ||
      row.name ||
      String(row.email || '').split('@')[0] ||
      'Unnamed';

    const update = {
      $set: {
        name,
        email: String(row.email || '').toLowerCase(),
        role: row.role === 'admin' ? 'admin' : 'customer',
        phone: row.phone || '',
        pendingEmail: '',
        emailVerified: Boolean(row.emailVerified),
        lastLoginAt: row.lastLoginAt || null,
        tokenVersion: row.tokenVersion || 0,
      },
      $unset: {},
    };

    /* Carry the existing bcrypt hash across so the account keeps whatever
       password it already had. Only if there is none yet does the caller set
       one with scripts/create-admin.mjs --reset. */
    if (row.passwordHash) update.$set.passwordHash = row.passwordHash;
    else if (row.password) update.$set.passwordHash = row.password;

    if (row.firstName !== undefined) update.$unset.firstName = '';
    if (row.lastName !== undefined) update.$unset.lastName = '';
    if (row.password !== undefined) update.$unset.password = '';
    if (row.isActive !== undefined) update.$unset.isActive = '';
    if (row.city !== undefined) update.$unset.city = '';

    const res = await mongoose.connection.db
      .collection('users')
      .updateOne({ _id: row._id }, update);

    /* A row with no hash at all cannot log in; flag it for a --reset. */
    if (!row.passwordHash && !row.password) {
      console.log(`  ${row.email}: no password hash found — run create-admin.mjs --reset to set one.`);
    }
    migrated += res.modifiedCount ? 1 : 0;
    console.log(`  migrated ${row.email} (${row.role})`);
  }

  console.log({ migrated, skipped, total: users.length });
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
