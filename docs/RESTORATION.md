# Astrovetro Studio — Restoration Runbook

This document describes how to restore the database and media from backups.

---

## Prerequisites

- Access to the production server or a clean staging VM.
- `mongorestore` (MongoDB tools) installed and in PATH.
- `rsync` and `aws` CLI installed for media restore.
- Backup directory containing:
  - `backups/db/latest/` – latest MongoDB dump (created by `scripts/backup-db.mjs`)
  - `backups/media/latest/` – latest media sync (created by `scripts/backup-media.mjs`)
- Environment variables set for the target environment (`.env` with `DATABASE_URL`, `STORAGE_ADAPTER`, S3 vars if applicable).

---

## 1. Restore the Database

```bash
# Ensure mongorestore is available
which mongorestore

# Restore from latest dump
mongorestore --uri="$DATABASE_URL" --drop backups/db/latest
```

- `--drop` ensures collections are recreated cleanly.
- Run on a fresh or existing DB; `--drop` removes existing data.

Verify:

```bash
mongo "$DATABASE_URL" --eval 'db.stats()'
```

Check collections count matches expected.

---

## 2. Restore Media

### Local storage (default)

```bash
# Source is the latest media backup
rsync -a --delete backups/media/latest/ public/assets/img/
```

Verify a few files exist under `public/assets/img/library/`.

### S3-compatible storage

```bash
# Sync from S3 bucket to local public/assets/img (if you also serve locally)
aws s3 sync s3://$S3_BUCKET/library/ public/assets/img/library/ --delete
```

If the application serves media directly from S3 (via `STORAGE_PUBLIC_URL`), no local copy is needed; just ensure the bucket contents are intact.

Verify a few objects via AWS console or `aws s3 ls s3://$S3_BUCKET/library/`.

---

## 3. Verify Product‑Image Relationships

Run a quick integrity check (Node REPL or small script):

```js
import { Product } from './src/models/Product.js';
import { Ritual } from './src/models/Ritual.js';
import { BlogPost } from './src/models/BlogPost.js';
import { getStorageAdapter } from './src/utils/storage.js';

const adapter = getStorageAdapter();

async function check() {
  const products = await Product.find({ images: { $ne: [] } }).select('images').lean();
  let missing = 0;
  for (const p of products) {
    for (const img of p.images) {
      if (!(await adapter.exists(img))) {
        console.warn('Missing image for product', p._id, img);
        missing++;
      }
    }
  }
  console.log(`Missing images: ${missing}`);
}
check();
```

Run with `node --input-type=module -e "$(cat script.js)"`.

---

## 3. Run Post‑Restoration Health Checks

```bash
# Start the application
npm start &
sleep 5
curl -s http://localhost:5173/health
# Expect JSON with status ok, database connected
curl -s http://localhost:5173/api/status
# Should return provider info
```

Run the test suite to ensure nothing is broken:

```bash
npm test
```

All 62 tests should pass.

---

## 4. Return to Service

- Point DNS / load balancer to the restored instance.
- Monitor logs for errors (`npm start` output).
- Verify admin login, product pages, image rendering.

---

## 5. Post‑Restoration Checklist

- [ ] Database restored and `mongorestore` reported success.
- [ ] Media files present and served correctly.
- [ ] Product images render on storefront.
- [ ] Admin panel loads, can upload new images.
- [ ] Health endpoint returns `status: ok`.
- [ ] Test suite passes (62/62).
- [ ] Monitoring alerts cleared.

---

## 5. Rollback Procedure (if restoration fails)

1. Keep the previous production instance running until new one verified.
2. If new instance fails health checks, revert DNS to old instance.
3. Investigate logs, re‑run restoration with corrected backup.

---

## Contact

For questions, contact the platform team or refer to `docs/STUDIO.md` for architecture details.