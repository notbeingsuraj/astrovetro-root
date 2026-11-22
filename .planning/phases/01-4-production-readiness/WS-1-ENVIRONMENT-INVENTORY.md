# WS-1 Environment Variable Inventory — Phase 1.4 Production Readiness

**Canonical Repository:** `notbeingsuraj/astrovetro-root`  
**Branch:** `recovery/phase-1.4-canonical`  
**Last Updated:** 2026-11-22

---

## Variable Inventory

| Variable | Purpose | Environment | Secret | Verification | Required | Notes |
|----------|---------|-------------|--------|--------------|----------|-------|
| `VERCEL_TOKEN` | Vercel CLI authentication token | CI/CD | Yes | `vercel whoami` | ✅ Required | Generate at https://vercel.com/account/tokens |
| `VERCEL_ORG_ID` | Vercel organization identifier | CI/CD | Yes | Dashboard → Settings → General | ✅ Required | Format: `team_xxxxx` |
| `VERCEL_PROJECT_ID` | **Actual** staging project ID | CI/CD | Yes | Dashboard → Settings → General | ✅ Required | **Must capture after project creation** — format: `prj_abc123` |
| `MONGODB_URI_STAGING` | Atlas staging connection string | Vercel/Server | Yes | `mongosh` ping | ✅ Required | Atlas → Connect → Drivers → Node.js |
| `MONGODB_URI` | Atlas connection string | Server | Yes | `dbReady()` | ✅ Required | Same as staging for prod; separate for staging |
| `UPSTASH_REDIS_REST_URL` | Upstash REST endpoint | Vercel/Server | Yes | `curl /ping` | ✅ Required | Upstash Console → Details |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash authentication token | Vercel/Server | Yes | `curl /ping` | ✅ Required | Upstash Console → Details |
| `FRONTEND_URL` | `https://staging.astrovetro.com` | Vercel/Server | No | `curl -I` | ✅ Required | Must match staging domain exactly |
| `JWT_SECRET` | JWT signing secret | Vercel/Server | Yes | `assertProductionSecrets()` | ✅ Required | Min 32 chars in production |
| `CSRF_SECRET` | CSRF token signing secret | Vercel/Server | Yes | CSRF validation | ✅ Required | Generate with `openssl rand -hex 32` |
| `RAZORPAY_KEY_ID` | Razorpay test key ID | Vercel/Server | Yes | Razorpay dashboard | ⚠️ Conditional | Required for Phase 2 (Razorpay) |
| `RAZORPAY_KEY_SECRET` | Razorpay test secret | Vercel/Server | Yes | Razorpay dashboard | ⚠️ Conditional | Required for Phase 2 |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay webhook verification | Vercel/Server | Yes | Webhook test | ⚠️ Conditional | Required for Phase 2 |
| `STORAGE_ADAPTER` | `local` \| `b2` \| `s3` | Vercel/Server | No | `getAvailableAdapters()` | ✅ Required | Default: `local` |
| `B2_BUCKET_NAME` | Backblaze B2 bucket name | Vercel/Server | Yes | B2 dashboard | ⚠️ Conditional | Required if `STORAGE_ADAPTER=b2` |
| `B2_KEY_ID` | B2 application key ID | Vercel/Server | Yes | B2 dashboard | ⚠️ Conditional | Required if `STORAGE_ADAPTER=b2` |
| `B2_APPLICATION_KEY` | B2 application key | Vercel/Server | Yes | B2 dashboard | ⚠️ Conditional | Required if `STORAGE_ADAPTER=b2` |
| `B2_ENDPOINT` | `https://s3.us-west-004.backblazeb2.com` | Vercel/Server | No | B2 docs | ⚠️ Conditional | Required if `STORAGE_ADAPTER=b2` |
| `B2_REGION` | `us-west-004` | Vercel/Server | No | B2 docs | ⚠️ Conditional | Required if `STORAGE_ADAPTER=b2` |
| `S3_BUCKET` | S3 bucket name | Vercel/Server | Yes | S3 console | ⚠️ Conditional | Required if `STORAGE_ADAPTER=s3` |
| `S3_ACCESS_KEY_ID` | S3 access key | Vercel/Server | Yes | S3 console | ⚠️ Conditional | Required if `STORAGE_ADAPTER=s3` |
| `S3_SECRET_ACCESS_KEY` | S3 secret access key | Vercel/Server | Yes | S3 console | ⚠️ Conditional | Required if `STORAGE_ADAPTER=s3` |
| `S3_ENDPOINT` | S3 endpoint (for R2/MinIO) | Vercel/Server | No | S3 console | ⚠️ Conditional | Required if `STORAGE_ADAPTER=s3` with custom endpoint |
| `S3_REGION` | S3 region | Vercel/Server | No | S3 console | ⚠️ Conditional | Required if `STORAGE_ADAPTER=s3` |
| `DRAIN_TIMEOUT_MS` | `8000` (8s for 10s Vercel timeout) | Server | No | Health endpoint | ✅ Required | Adjust if Vercel Pro (60s) |
| `TRUST_PROXY` | `1` (Vercel single hop) | Server | No | `req.ip` correct | ✅ Required | `1` for Vercel, `2` for Cloudflare→Vercel |
| `DISABLE_RATE_LIMIT` | `true` for test mode | CI/Test | No | Test behavior | ⚠️ Conditional | Set `true` only in test/CI |
| `AV_DISABLE_API` | `1` to disable API | Test | No | Test behavior | ⚠️ Conditional | For resilience testing only |
| `NODE_ENV` | `staging` / `production` | All | No | Code behavior | ✅ Required | Vercel sets automatically |
| `DATABASE_URL` | Alias for `MONGODB_URI` | Server | Yes | `env.databaseConfigured` | ⚠️ Optional | Alias for `MONGODB_URI` |
| `VERCEL` | Set by Vercel (`1`) | Vercel | No | `process.env.VERCEL` | ✅ Auto-set | Do not set manually |
| `VERCEL_INVOCATION_ID` | Unique invocation ID | Vercel | No | `process.env.VERCEL_INVOCATION_ID` | ✅ Auto-set | Used for logging |
| `AWS_LAMBDA_FUNCTION_NAME` | Set by AWS Lambda | Vercel | No | `process.env.AWS_LAMBDA_FUNCTION_NAME` | ✅ Auto-set | Alternative serverless detection |

---

## Verification Commands

| Variable | Verification Command |
|----------|---------------------|
| `VERCEL_TOKEN` | `vercel whoami` |
| `VERCEL_ORG_ID` | `vercel inspect <deployment> --token=$VERCEL_TOKEN` |
| `VERCEL_PROJECT_ID` | Dashboard → Settings → General |
| `MONGODB_URI_STAGING` | `mongosh "$MONGODB_URI_STAGING" --eval "db.runCommand({ connectionStatus: 1 })"` |
| `UPSTASH_REDIS_REST_URL` | `curl -H "Authorization: Bearer $UPSTASH_REDIS_REST_TOKEN" $UPSTASH_REDIS_REST_URL/ping` |
| `FRONTEND_URL` | `curl -I https://staging.astrovetro.com` |
| `JWT_SECRET` | `node -e "console.log(process.env.JWT_SECRET?.length)"` |
| `DRAIN_TIMEOUT_MS` | `curl https://staging.astrovetro.com/api/health \| jq .drain.timeoutMs` |
| `TRUST_PROXY` | `curl -H "X-Forwarded-For: 1.2.3.4" https://staging.astrovetro.com/api/health \| jq .headers` |

---

## Secret Storage Locations

| Secret | GitHub Secrets | Vercel Dashboard | 1Password/Local |
|--------|----------------|------------------|-----------------|
| `VERCEL_TOKEN` | ✅ | ❌ | Backup |
| `VERCEL_ORG_ID` | ✅ | ✅ | Backup |
| `VERCEL_PROJECT_ID` | ✅ | ✅ | Backup |
| `MONGODB_URI_STAGING` | ✅ | ✅ | Backup |
| `UPSTASH_REDIS_REST_URL` | ✅ | ✅ | Backup |
| `UPSTASH_REDIS_REST_TOKEN` | ✅ | ✅ | Backup |
| `JWT_SECRET` | ✅ | ✅ | Backup |
| `CSRF_SECRET` | ✅ | ✅ | Backup |
| `RAZORPAY_KEY_ID` | ✅ | ✅ | Backup |
| `RAZORPAY_KEY_SECRET` | ✅ | ✅ | Backup |
| `RAZORPAY_WEBHOOK_SECRET` | ✅ | ✅ | Backup |
| `MONGODB_URI` (prod) | ✅ | ✅ | Backup |
| `B2_*` / `S3_*` | ✅ | ✅ | Backup |

**Rule:** Never commit secrets to repository. All secrets in GitHub Secrets (CI/CD) and Vercel Dashboard (runtime). Backup in 1Password.

---

## Variable Categories

### Required (Must be set for environment to function)
- `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`
- `MONGODB_URI` / `MONGODB_URI_STAGING`
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- `FRONTEND_URL`, `JWT_SECRET`, `CSRF_SECRET`
- `DRAIN_TIMEOUT_MS`, `TRUST_PROXY`, `NODE_ENV`

### Optional (Has sensible default, can be overridden)
- `STORAGE_ADAPTER` (default: `local`)
- `DRAIN_TIMEOUT_MS` (default: `8000`)
- `TRUST_PROXY` (default: `1` for Vercel)
- `DISABLE_RATE_LIMIT` (default: `false`)
- `AV_DISABLE_API` (default: `false`)

### Conditional (Required only if using specific adapter/feature)
- `STORAGE_ADAPTER=b2` → `B2_BUCKET_NAME`, `B2_KEY_ID`, `B2_APPLICATION_KEY`, `B2_ENDPOINT`, `B2_REGION`
- `STORAGE_ADAPTER=s3` → `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION` (+ optional `S3_ENDPOINT`)
- Phase 2 (Razorpay) → `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`
- `DISABLE_RATE_LIMIT` (test mode only)

### Not Yet Verified (Need Verification)
- `VERCEL_PROJECT_ID` — Must capture from Vercel Dashboard after project creation
- Vercel actual function timeout (Hobby 10s / Pro 60s)
- Vercel Fluid Compute status
- Vercel static outbound IPs for Atlas allowlist

---

## Variable Usage in Codebase

| Variable | Files Referencing |
|----------|-------------------|
| `MONGODB_URI` | `src/db/connect.js`, `src/config/env.js` |
| `FRONTEND_URL` | `src/config/env.js`, `src/middleware/csrf.js` (planned) |
| `JWT_SECRET` | `src/config/env.js`, `src/utils/tokenService.js` |
| `CSRF_SECRET` | `src/config/env.js`, `src/middleware/csrf.js` (planned) |
| `UPSTASH_REDIS_REST_URL/TOKEN` | `src/middleware/rateLimitStore.js` |
| `STORAGE_ADAPTER` | `src/utils/storage.js`, `server.js` |
| `B2_*` / `S3_*` | `src/utils/storage.js` |
| `DRAIN_TIMEOUT_MS` | `src/middleware/requestDrain.js` (planned), `server.js` (planned) |
| `TRUST_PROXY` | `server.js` |
| `RAZORPAY_*` | `src/payments/razorpay.js`, `src/config/env.js` |
| `DISABLE_RATE_LIMIT` | `src/middleware/rateLimitStore.js` |
| `AV_DISABLE_API` | `server.js` |

---

## Change Management

| Change | Process |
|--------|---------|
| Add new variable | 1. Update this document 2. Add to `.env.example` 3. Add to GitHub Secrets 4. Add to Vercel Dashboard 5. Update verification commands |
| Rotate secret | 1. Generate new value 2. Update in GitHub Secrets 3. Update in Vercel Dashboard 4. Deploy 5. Verify 6. Remove old backup from 1Password |
| Remove variable | 1. Confirm no code references 2. Remove from GitHub Secrets 3. Remove from Vercel Dashboard 4. Update this document |

---

*Last Updated: 2026-11-22*  
*Source: Canonical codebase audit (`astrovetro-root`)*