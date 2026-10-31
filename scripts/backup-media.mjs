#!/usr/bin/env node
/* -------------------------------------------------------------------------
   Media backup script (local or S3)
   -------------------------------------------------------------------------

   For local storage: uses rsync to copy public/assets/img to backup directory.
   For S3 storage: uses aws s3 sync (requires AWS CLI) to sync bucket to local dir.

   Usage:
     node scripts/backup-media.mjs [output-dir]

   Environment variables (S3):
     STORAGE_ADAPTER=s3
     S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_ENDPOINT

   For local storage, set MEDIA_DIR (default: public/assets/img) and BACKUP_DIR.
   ------------------------------------------------------------------------- */

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getStorageAdapter } from '../src/utils/storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const adapterName = process.env.STORAGE_ADAPTER || 'local';
const adapter = getStorageAdapter();

const baseDir = process.env.BACKUP_DIR || path.join(ROOT, 'backups', 'media');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(baseDir, `media-${timestamp}`);

await fs.mkdir(outDir, { recursive: true });

console.log(`📦 Starting media backup (adapter: ${adapterName}) to ${outDir}`);

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { env: { ...process.env } }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${cmd} failed: ${stderr || err.message}`));
      else resolve(stdout);
    });
    child.stdout?.on('data', d => process.stdout.write(d));
    child.stderr?.on('data', d => process.stderr.write(d));
  });
}

async function backupLocal() {
  const src = process.env.MEDIA_DIR || path.join(ROOT, 'public', 'assets', 'img');
  console.log(`🔄 rsync ${src} -> ${outDir}`);
  await run('rsync', ['-a', '--delete', `${src}/`, `${outDir}/`]);
  console.log('✅ Local media backup completed');
}

async function backupS3() {
  // Uses AWS CLI (must be installed and configured with credentials)
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error('S3_BUCKET required for S3 media backup');
  const prefix = process.env.S3_PREFIX || 'library/';
  console.log(`🔄 aws s3 sync s3://${bucket}/${prefix} ${outDir}`);
  await run('aws', ['s3', 'sync', `s3://${bucket}/${prefix}`, outDir, '--delete']);
  console.log('✅ S3 media backup completed');
}

async function main() {
  try {
    if (adapterName === 'local') {
      await backupLocal();
    } else if (adapterName === 's3') {
      await backupS3();
    } else {
      throw new Error(`Unsupported storage adapter for backup: ${adapterName}`);
    }
    // Update latest symlink
    const latest = path.join(baseDir, 'latest');
    await fs.rm(latest, { force: true });
    await fs.symlink(outDir, latest, 'dir');
    console.log(`🔗 Updated latest symlink -> ${latest}`);
    console.log(`✅ Media backup completed: ${outDir}`);
  } catch (err) {
    console.error('❌ Media backup failed:', err.message);
    process.exit(1);
  }
}

main();