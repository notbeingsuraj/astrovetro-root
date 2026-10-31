#!/usr/bin/env node
/* -------------------------------------------------------------------------
   MongoDB backup script (uses mongodump)
   -------------------------------------------------------------------------

   Usage:
     DATABASE_URL=mongodb://... node scripts/backup-db.mjs [output-dir]

   Environment variables:
     DATABASE_URL / MONGODB_URI   MongoDB connection string (required)
     BACKUP_DIR                    Base directory for backups (default: ./backups/db)

   The script creates a timestamped subdirectory and runs mongodump.
   Ensure mongodump is installed and in PATH.
   ------------------------------------------------------------------------- */

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const dbUrl = process.env.DATABASE_URL || process.env.MONGODB_URI;
if (!dbUrl) {
  console.error('❌ DATABASE_URL or MONGODB_URI must be set');
  process.exit(1);
}

const baseDir = process.env.BACKUP_DIR || path.join(ROOT, 'backups', 'db');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(baseDir, `dump-${timestamp}`);

await fs.mkdir(outDir, { recursive: true });

console.log(`📦 Starting MongoDB backup to ${outDir}`);

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { env: { ...process.env } }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`${cmd} failed: ${stderr || err.message}`));
      } else {
        resolve(stdout);
      }
    });
    child.stdout?.on('data', d => process.stdout.write(d));
    child.stderr?.on('data', d => process.stderr.write(d));
  });
}

try {
  // mongodump --uri="mongodb://..." --out=DIR
  await run('mongodump', ['--uri', dbUrl, '--out', outDir]);
  console.log(`✅ Backup completed: ${outDir}`);
  // Optionally create a latest symlink
  const latest = path.join(baseDir, 'latest');
  await fs.rm(latest, { force: true });
  await fs.symlink(outDir, latest, 'dir');
  console.log(`🔗 Updated latest symlink -> ${latest}`);
} catch (err) {
  console.error('❌ Backup failed:', err.message);
  process.exit(1);
}