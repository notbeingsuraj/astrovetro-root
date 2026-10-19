/* -------------------------------------------------------------------------
   Create or reset an administrator account
   -------------------------------------------------------------------------

   There is no seeded admin password anywhere in this repository, on purpose:
   a hardcoded credential in a seed file ships to production with the code.
   This script is the documented way to get the first administrator:

     node scripts/create-admin.mjs you@example.com
     node scripts/create-admin.mjs you@example.com --reset   (new password)

   Without --reset it creates the account if missing and leaves an existing
   one's password untouched. With --reset it sets a fresh password (read
   silently from the terminal, or from the AV_ADMIN_PASSWORD environment
   variable for scripted use). Passwords are hashed by the User model's own
   pre-save hook, so plaintext never leaves this process's memory. */

import 'dotenv/config';
import mongoose from 'mongoose';
import { User } from '../src/models/User.js';

const [emailArg, ...flags] = process.argv.slice(2);
const reset = flags.includes('--reset');

if (!emailArg || !emailArg.includes('@')) {
  console.error('Usage: node scripts/create-admin.mjs <email> [--reset]');
  process.exit(1);
}
const email = emailArg.trim().toLowerCase();

const uri = process.env.DATABASE_URL || process.env.MONGODB_URI;
if (!uri) {
  console.error('No DATABASE_URL / MONGODB_URI in the environment. Aborting.');
  process.exit(1);
}

async function promptPassword() {
  if (process.env.AV_ADMIN_PASSWORD) return process.env.AV_ADMIN_PASSWORD;
  /* Node TTYs echo by default; silence it for the secret. */
  const muteprompt = (q) =>
    new Promise((resolve) => {
      const stdin = process.stdin;
      stdin.resume();
      stdin.setRawMode?.(true);
      stdin.resume();
      let secret = '';
      process.stdout.write(q);
      const onData = (chunk) => {
        const s = chunk.toString('utf8');
        if (s === '\u0003') process.exit(1);
        if (s === '\r' || s === '\n') {
          stdin.setRawMode?.(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve(secret);
          return;
        }
        if (s === '\u007f' || s === '\b') secret = secret.slice(0, -1);
        else secret += s;
      };
      stdin.on('data', onData);
    });

  const a = await muteprompt('New password: ');
  const b = await muteprompt('Repeat password: ');
  if (!a || a !== b) {
    console.error('Passwords did not match. Aborting.');
    process.exit(1);
  }
  if (a.length < 8) {
    console.error('Password must be at least 8 characters. Aborting.');
    process.exit(1);
  }
  return a;
}

async function main() {
  await mongoose.connect(uri);
  const existing = await User.findOne({ email }).select('+passwordHash');

  if (existing && !reset) {
    console.log(`Admin already exists: ${email} (role: ${existing.role}).`);
    console.log('Pass --reset to set a new password.');
    if (existing.role !== 'admin') {
      existing.role = 'admin';
      await existing.save();
      console.log('Role was not admin — promoted to admin.');
    }
    await mongoose.disconnect();
    return;
  }

  const password = await promptPassword();

  if (existing && reset) {
    existing.passwordHash = password; // hashed by the model's pre-save hook
    existing.role = 'admin';
    await existing.save();
    console.log(`Reset the password for admin ${email}.`);
  } else {
    await User.create({ name: email.split('@')[0], email, passwordHash: password, role: 'admin', emailVerified: true });
    console.log(`Created admin ${email}. Sign in at /admin.html.`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
