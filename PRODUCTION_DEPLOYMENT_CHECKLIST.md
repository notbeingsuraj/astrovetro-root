# Astrovetro Production Deployment Checklist

**Version:** 1.0  
**Date:** 2026-11-04  
**Status:** ✅ Code Ready | ⚠️ Infrastructure Required

---

## 1. Atlas Configuration

### 1.1 Database
- [ ] **Target Database:** `astrovetro_production` (NOT `astrovetro_staging`)
- [ ] **Cluster:** `astrovetro-cluster` (or your production cluster)
- [ ] **Connection String Format:**
  ```
  mongodb+srv://<username>:<password>@astrovetro-cluster.mongodb.net/astrovetro_production?retryWrites=true&w=majority
  ```

### 1.2 Database User
- [ ] **Username:** `astrovetro_prod_user` (dedicated production user)
- [ ] **Password:** Strong, unique password (≥32 chars, generated via password manager)
- [ ] **Role:** `readWrite` on `astrovetro_production` database ONLY
- [ ] **No `atlasAdmin` role** — remove any excessive privileges
- [ ] **Authentication:** SCRAM-SHA-256

### 1.3 Network Access
- [ ] **Vercel Egress IPs:** Add all Vercel outbound IP ranges to Atlas IP Access List
  - Get current ranges from: https://vercel.com/docs/concepts/projects/environment-variables#system-environment-variables
  - Or use Vercel's Static IP add-on (Enterprise) for fixed egress IPs
- [ ] **No `0.0.0.0/0`** in production — restrict to Vercel IPs only
- [ ] **Verify:** Test connection from a Vercel deployment (check logs for `db_connected`)

### 1.4 TLS/SSL
- [ ] **Enforce TLS:** Atlas requires TLS by default for `mongodb+srv://` — verify
- [ ] **Certificate:** Atlas manages certificates — no action needed

---

## 2. Vercel Production Environment Variables

Set in **Vercel Dashboard → Project → Settings → Environment Variables → Production**:

| Variable | Required | Value | Notes |
|----------|:--------:|-------|-------|
| `DATABASE_URL` | ✅ | `mongodb+srv://.../astrovetro_production` | Must use production DB |
| `JWT_SECRET` | ✅ | ≥32 char random | `openssl rand -base64 32` |
| `FRONTEND_URL` | ✅ | `https://astrovetro.com` | Exact production origin |
| `TRUST_PROXY` | ✅ | `1` | Vercel single proxy hop |
| `STORAGE_ADAPTER` | ✅ | `b2` (or `local`/`s3`) | |
| `B2_BUCKET_NAME` | ✅* | `astrovetro-prod` | *If using B2 |
| `B2_KEY_ID` | ✅* | `xxx` | Application Key ID |
| `B2_APPLICATION_KEY` | ✅* | `xxx` | Application Key (secret) |
| `B2_ENDPOINT` | ✅* | `https://s3.us-west-004.backblazeb2.com` | Region-specific |
| `B2_REGION` | ✅* | `us-west-004` | |
| `RAZORPAY_KEY_ID` | ⚠️ | `rzp_live_xxx` | Only when payments verified |
| `RAZORPAY_KEY_SECRET` | ⚠️ | `xxx` | Keep secret! |
| `RAZORPAY_WEBHOOK_SECRET` | ⚠️ | `xxx` | For webhook verification |
| `NODE_ENV` | Auto | `production` | Set by Vercel |
| `PORT` | Auto | `5173` | Set by Vercel |

**Validation Rules (enforced at boot):**
- `JWT_SECRET` ≥ 32 chars in production
- `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` must be set together
- `FRONTEND_URL` cannot be `*` when credentials enabled
- `STORAGE_ADAPTER` must be one of: `local`, `s3`, `b2`

---

## 3. Backblaze B2 Credential Rotation

**⚠️ CRITICAL: Previous B2 credentials must be treated as compromised.**

- [ ] **Generate new Application Key** in B2 Console:
  - Name: `astrovetro-production-<date>`
  - Capabilities: `readFiles`, `writeFiles`, `deleteFiles`, `listFiles`, `listBuckets`
  - Bucket: `astrovetro-prod` (or your bucket)
  - File name prefix: `products/` (restrict to product images only)
- [ ] **Update Vercel** with new `B2_KEY_ID` and `B2_APPLICATION_KEY`
- [ ] **Revoke old keys** in B2 Console
- [ ] **Test upload** via admin panel after deployment

---

## 4. Deployment Steps

### 4.1 Pre-Deploy Verification
```bash
# 1. Run full test suite locally
npm test

# 2. Verify build (no-op for this project)
npm run build

# 3. Run local smoke test
node server.js &
sleep 5
BASE_URL=http://localhost:5173 node scripts/smoke-production.mjs
# Should show: 🟢 RESULT: ALL CHECKS PASSED
```

### 4.2 Deploy
```bash
# Option A: Push to main (triggers Vercel auto-deploy)
git add -A
git commit -m "Production readiness: connection recovery, tests, smoke script"
git push origin main

# Option B: Manual Vercel deploy
vercel --prod
```

### 4.3 Post-Deploy Verification
```bash
# Wait for Vercel to show "Ready" then run smoke test
BASE_URL=https://astrovetro-root-dntu-azure.vercel.app \
node scripts/smoke-production.mjs

# With admin credentials (for full auth check)
BASE_URL=https://astrovetro-root-dntu-azure.vercel.app \
ADMIN_EMAIL=admin@astrovetro.com \
ADMIN_PASSWORD=<secure> \
node scripts/smoke-production.mjs
```

**Expected Results:**
- 🟢 RESULT: ALL CHECKS PASSED
- `/health` → `database: "connected"`, `mongooseReadyState: 1`
- `/api/status` → `database: true`, `writable: true`

---

## 5. Smoke Test Commands

### Basic Health Check
```bash
curl https://astrovetro-root-dntu-azure.vercel.app/health
curl https://astrovetro-root-dntu-azure.vercel.app/api/status
```

### Full Automated Smoke Test
```bash
# Without admin (basic checks)
BASE_URL=https://astrovetro-root-dntu-azure.vercel.app \
node scripts/smoke-production.mjs

# With admin (includes admin login + dashboard)
BASE_URL=https://astrovetro-root-dntu-azure.vercel.app \
ADMIN_EMAIL=admin@astrovetro.com \
ADMIN_PASSWORD=<from-password-manager> \
node scripts/smoke-production.mjs
```

### Exit Codes
- `0` = All required checks passed
- `1` = Required check failed
- `2` = Only optional checks failed/warnings

---

## 6. Browser Verification (Manual)

After automated smoke tests pass:

- [ ] **Homepage:** Loads at `https://astrovetro.com/home.html`
- [ ] **Shop:** Products display with images at `/shop.html`
- [ ] **Sign Up:** Create test account at `/signup.html`
- [ ] **Sign In:** Login at `/signin.html`
- [ ] **Cart:** Add product → verify persists after reload
- [ ] **Wishlist:** Save product → verify persists after logout/login
- [ ] **Checkout (COD):** Place test order → verify order appears in `/orders.html`
- [ ] **Admin Login:** Access `/admin.html` with admin credentials
- [ ] **Admin Dashboard:** Loads with metrics
- [ ] **Create Product:** Add test product in Studio → verify on shop
- [ ] **Upload Image:** Test product image upload in admin
- [ ] **Sign Out:** Verify session invalidated (cookie cleared, tokenVersion bumped)

---

## 7. Rollback Procedure

If critical issues found post-deploy:

```bash
# 1. Revert to previous Vercel deployment
vercel rollback <deployment-url> --prod

# OR in Vercel Dashboard:
# Deployments → Previous deployment → "Promote to Production"

# 2. Verify rollback
BASE_URL=https://astrovetro-root-dntu-azure.vercel.app \
node scripts/smoke-production.mjs

# 3. Investigate and fix before re-deploying
```

---

## 8. Payment Activation Criteria

**DO NOT ENABLE LIVE PAYMENTS** until ALL verified:

- [ ] Razorpay webhook endpoint registered in dashboard: `https://astrovetro.com/api/webhooks/razorpay`
- [ ] Webhook secret configured in Vercel (`RAZORPAY_WEBHOOK_SECRET`)
- [ ] Test payment succeeds in Razorpay **test mode** (not live)
- [ ] Webhook signature verification tested
- [ ] Idempotency keys work (duplicate webhook calls handled)
- [ ] Order state transitions: `pending → paid → confirmed`
- [ ] Refund flow tested
- [ ] Payment failure handling tested (insufficient funds, card declined)
- [ ] **Business approval** obtained for live payments

To enable: Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` in Vercel Production.

---

## 9. Known Limitations

| Limitation | Impact | Mitigation |
|------------|--------|------------|
| Vercel serverless = new connection per cold start | Connection latency on first request | `serverSelectionTimeoutMS: 5000`; consider Atlas Data API for zero-connection |
| `maxPoolSize: 5` per instance | Multiple instances share Atlas limit | Monitor Atlas connections; increase tier if needed |
| No persistent connection across invocations | Cannot use MongoDB change streams | Use polling or scheduled jobs for real-time needs |
| Rate limiting uses in-memory store | Resets on each cold start | Acceptable for serverless; consider Upstash Redis for distributed rate limiting |
| B2 credentials in env vars | Secret rotation requires redeploy | Use Vercel's secret management; rotate quarterly |

---

## 10. Status Summary

| Category | Status | Notes |
|----------|--------|-------|
| **Code Changes** | ✅ Complete | All fixes implemented and tested |
| **Unit/Integration Tests** | ✅ 81/81 Passing | Including 9 new connection recovery tests |
| **Build** | ✅ Passes | No compilation step |
| **Smoke Test Script** | ✅ Created | `scripts/smoke-production.mjs` |
| **Local Smoke Test** | ✅ Passes | 40/40 checks |
| **Atlas DB User** | ⚠️ Manual | Create `readWrite` user on `astrovetro_production` |
| **Atlas Network Access** | ⚠️ Manual | Add Vercel egress IPs |
| **Vercel Env Vars** | ⚠️ Manual | Set all Production variables |
| **B2 Credential Rotation** | ⚠️ Manual | Generate new restricted key |
| **Payment Verification** | ⚠️ Pending | Keep disabled until criteria met |
| **Production Deploy** | ⏳ Blocked | Requires infrastructure steps above |

---

## 11. Final Readiness Verdict

**CONDITIONALLY READY**

- ✅ All code-level fixes complete and tested
- ✅ All automated tests pass (81/81)
- ✅ Smoke test script validates all critical endpoints
- ✅ Local verification successful
- ⚠️ **Infrastructure configuration required** (Atlas, Vercel, B2)
- ⚠️ **Production deployment not yet verified**

**Next Action:** Complete infrastructure configuration (Section 1-3), then deploy and run production smoke tests.

---

*Generated: 2026-11-04*  
*Repository: ~/Desktop/Astrovetro-production*