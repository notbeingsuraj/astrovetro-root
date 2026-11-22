# WS-1 Pre-Provisioning Audit — Phase 1.4 Production Readiness

## Executive Summary

This audit validates the Phase 1.4 infrastructure provisioning plan against the **actual canonical architecture** (`astrovetro-root`). Critical findings require plan corrections before any infrastructure provisioning.

**Key Finding**: The canonical application is a **Vercel serverless application** — not a persistent HTTP server. The current plan assumes persistent-server shutdown semantics that do not apply in serverless environments.

---

## 1. Vercel Project Identity & Deployment Guard

### Current Configuration
```json
// vercel.json
{
  "builds": [{ "src": "server.js", "use": "@vercel/node" }],
  "routes": [{ "src": "/(.*)", "dest": "server.js" }]
}
```

### Project Identity Resolution

| Attribute | Source | How to Obtain |
|-----------|--------|---------------|
| **Project Name** | Vercel Dashboard | User-defined (e.g., "astrovetro-staging") |
| **Project ID** | Vercel Dashboard → Settings → General | Auto-generated (e.g., `prj_abc123`) |
| **Organization ID** | Vercel Dashboard → Settings → General | Auto-generated (e.g., `team_abc123`) |
| **Deployment Target** | Git branch + Vercel Project Settings | `main` branch → Production/Preview |

### Critical Finding: `astrovetro-staging` is NOT a Project ID

The plan assumes `VERCEL_PROJECT_ID == "astrovetro-staging"`. **This is incorrect.** Vercel Project IDs are auto-generated strings like `prj_abc123def456`, not human-readable names.

**Correct approach:**
1. Create Vercel project via CLI/Dashboard
2. Obtain actual Project ID from Vercel Dashboard → Settings → General
3. Store actual Project ID in GitHub Secret `VERCEL_PROJECT_ID`
4. Pre-deploy guard compares against actual ID

### Deployment Guard Design (Fail-Closed)

```yaml
# .github/workflows/ci-cd.yml
- name: Verify Staging Project Identity
  run: |
    EXPECTED="${{ secrets.VERCEL_PROJECT_ID }}"
    if [ -z "$EXPECTED" ]; then
      echo "ERROR: VERCEL_PROJECT_ID secret not set"
      exit 1
    fi
    # Additional safety: reject known production project IDs
    FORBIDDEN_IDS=("prj_prod123" "prj_production456")
    for forbidden in "${FORBIDDEN_IDS[@]}"; do
      if [ "$EXPECTED" = "$forbidden" ]; then
        echo "ERROR: Deployment target is a production project"
        exit 1
      fi
    done
    echo "Deployment target verified: $EXPECTED"
```

### Negative Test Cases (Must Pass Before Deployment)

| Test Case | Expected Result |
|-----------|-----------------|
| `VERCEL_PROJECT_ID` unset | Workflow fails with clear error |
| `VERCEL_PROJECT_ID` = production project ID | Workflow fails |
| `VERCEL_PROJECT_ID` = staging project ID | Deployment proceeds |
| `VERCEL_PROJECT_ID` = invalid format | Workflow fails |

### Vercel CLI Deployment Command

```bash
# Correct deployment with explicit project ID and commit SHA
vercel --prod \
  --config vercel-staging.json \
  --token=${VERCEL_TOKEN} \
  --scope=${VERCEL_ORG_ID} \
  --commit=${GITHUB_SHA}
```

---

## 2. Deployment Architecture Validation

### Finding: Application is Serverless (Vercel)

**Evidence from `server.js`:**
```javascript
const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

if (!isServerless) {
  const server = app.listen(PORT, ...);
  // Graceful shutdown ONLY runs locally
}

export default app;  // Exported for Vercel serverless invocation
```

**Architectural Implications:**

| Aspect | Persistent Server (Reference) | Serverless (Canonical) |
|--------|------------------------------|------------------------|
| Process lifecycle | Persistent, managed by app | Managed by Vercel (10s max) |
| In-flight request drain | `server.close()` + wait | Not applicable - Vercel manages |
| Connection pooling | Long-lived connections | New connection per invocation |
| Graceful shutdown | `server.close()` + drain wait | Function timeout (10s) |
| Socket management | Manual `closeAllConnections()` | N/A (no persistent sockets) |

### Critical Finding: Persistent-Server Shutdown Code is Irrelevant in Production

The current plan's WS-5 (Graceful Shutdown Drain) assumes:
- `server.close()` stops accepting connections
- `waitForDrain()` waits for in-flight requests
- `closeAllConnections()` forces socket closure
- MongoDB closes within deadline

**In Vercel serverless, NONE of this applies.** Vercel:
- Manages function lifecycle (max 10s execution)
- Terminates function after response or timeout
- Does not expose socket management APIs
- Each invocation is stateless (no persistent connections)

### What IS Needed for Serverless

| Requirement | Implementation |
|-------------|----------------|
| **Cold start DB connection** | Shared connection promise with `dbReady()` |
| **Per-invocation timeout** | Function timeout (10s) - design operations to complete |
| **Rate limiting** | Upstash Redis (distributed) with in-memory fallback |
| **Connection cleanup** | `disconnectDB()` not needed per-invocation; connection pooling handles |
| **Graceful degradation** | Fallback to static catalogue if DB unavailable |

### WS-5 Correction Required

**Current WS-5 plan** implements persistent-server shutdown patterns. **Must be rewritten for serverless:**

1. **Remove** `server.close()`, `closeAllConnections()`, socket tracking
2. **Add** Per-invocation timeout awareness (10s limit)
3. **Ensure** DB operations complete within function timeout
4. **Implement** Request drain at application level (reject new requests during shutdown - but Vercel doesn't support graceful shutdown)
5. **Focus** on: Cold start optimization, connection pooling, timeout budgeting

**Serverless "Graceful Shutdown" = Design for 10s function timeout.**

---

## 3. MongoDB Staging Requirements

### Current Plan Assumption
- Atlas M10+ replica set required
- Transactions needed for SV-003 (100 parallel orders)
- 3-node cluster ($57/mo)

### Canonical Implementation Analysis

**Canonical `inventoryService.js` uses guarded `$inc` with compensating reversal:**
```javascript
// Atomic race gate: update only matches while balance can absorb delta
const beforeDoc = await Product.findOneAndUpdate(
  { _id: product._id, stock: { $ne: null }, $expr: { $gte: [{ $add: ['$stock', delta] }, 0] } },
  { $inc: { stock: delta } },
  { new: false }
);
```

**No MongoDB transactions used.** Concurrency safety via:
- Guarded `$inc` with `$expr` guard
- Compensating reversal if ledger write fails
- Idempotent `idempotencyKey` for receipts

### Staging Requirements for Canonical Architecture

| Requirement | Standalone | Replica Set |
|-------------|------------|-------------|
| SV-003 (100 parallel orders) | ✅ Works with guarded `$inc` | ✅ Works |
| Connection pooling | ✅ Works | ✅ Works |
| Failover testing | ❌ Not needed | ✅ Available |
| Cost | **Free (Atlas M0)** | **$57/mo (M10)** |

### Recommendation: **Atlas M0 (Free Tier) Sufficient for Staging**

| Configuration | Justification |
|---------------|---------------|
| **M0 (Free)** | Sufficient for SV-003 concurrency testing; 512MB storage adequate |
| **No replica set needed** | Canonical code doesn't use transactions |
| **IP allowlist** | Vercel outbound IPs or `0.0.0.0/0` with credentials (staging only) |
| **Destroy after verification** | Zero ongoing cost |

**Cost Savings**: $57/mo → $0/mo for staging

### Production Isolation

| Environment | Cluster | Database | Credentials |
|-------------|---------|----------|-------------|
| Staging | Atlas M0 (or M10 if replica set desired) | `astrovetro_staging` | Separate credentials |
| Production | Atlas M10+ (replica set) | `astrovetro_production` | Separate credentials |

**Never share credentials or clusters between environments.**

---

## 4. Upstash Redis Validation

### Current Implementation (`src/middleware/rateLimitStore.js`)

**Architecture:**
- Module-level initialization (top-level await)
- `createRateLimitStoreInternal()` creates store at import time
- Upstash Redis store with in-memory fallback
- Pre-configured limiters: auth, signup, checkout, write

**Serverless Behavior:**
- Each function invocation loads module → creates new Redis client
- Upstash Redis uses HTTP/REST (serverless-compatible)
- Connection pooling handled by Upstash

### Critical Gaps Identified

| Gap | Risk | Mitigation |
|-----|------|------------|
| **No explicit failure mode per endpoint** | Auth rate limit failure = blocked login | Define per-endpoint fallback behavior |
| **In-memory fallback not distributed** | Rate limits bypassed in multi-instance | Document limitation; require Redis in prod |
| **No circuit breaker** | Redis outage = rate limit bypass | Add circuit breaker pattern |
| **Key generation uses `req.ip`** | Behind proxy = same IP for all | `trust proxy` configured; verify header |

### Required Failure Modes per Endpoint Category

| Endpoint Category | Rate Limit Failure Mode | Rationale |
|-------------------|------------------------|-----------|
| **Authentication** (`/api/auth/*`) | **Fail closed** (block) | Security critical; block brute force |
| **Checkout** (`/api/orders`) | **Fail closed** (block) | Prevent abuse; inventory integrity |
| **Write API** (`/api/*` POST/PUT/PATCH) | **Fail open with logging** | Availability > strict limiting |
| **Read API** (`/api/*` GET) | **Fail open** | No write risk; graceful degradation |
| **Admin** (`/api/admin/*`) | **Fail closed** | High-value targets |

### Upstash Redis Staging Requirements

| Requirement | Specification |
|-------------|---------------|
| **Plan** | Free tier (10k requests/day) sufficient for staging |
| **Region** | Same as Vercel (auto-detected) |
| **Credentials** | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` in Vercel env |
| **Failure Mode** | Documented per endpoint category above |

---

## 5. B2 Storage Health Check Validation

### Current Implementation (`src/utils/storage.js:762`)

**Current Check:**
```javascript
// Lightweight check: try to list with a minimal prefix (max 1 object)
await client.send(new ListObjectsV2Command({
  Bucket: process.env.B2_BUCKET_NAME,
  Prefix: 'library/',
  MaxKeys: 1,
}));
```

### Gaps in Current Implementation

| Gap | Impact | Fix |
|-----|--------|-----|
| **Reports healthy if credentials exist** | False positive if bucket missing | Validate bucket exists |
| **Reports healthy if auth works but bucket wrong** | False positive | Verify bucket name matches |
| **No distinction between auth vs connectivity failure** | Opaque failure | Classify error types |
| **No write verification** | Read-only buckets pass | Add write+delete test (optional) |
| **Credentials exposed in error logs** | Security risk | Already sanitized (good) |

### Required Bounded B2 Health Check

```javascript
async function checkStorageHealth() {
  const adapter = getStorageAdapter();
  const health = { provider: adapter.name, configured: false, available: false, details: {} };
  
  try {
    // 1. Configuration validity (credentials exist)
    if (adapter.name === 'b2') {
      const required = ['B2_BUCKET_NAME', 'B2_KEY_ID', 'B2_APPLICATION_KEY'];
      const missing = required.filter(v => !process.env[v]);
      if (missing.length) {
        health.configured = false;
        health.details.error = `Missing: ${missing.join(', ')}`;
        return health;
      }
      health.configured = true;
      
      // 2. Authentication validity (credentials accepted)
      const client = new S3Client({ ... });
      try {
        await client.send(new ListBucketsCommand({}));
      } catch (e) {
        if (e.name === 'InvalidAccessKeyId' || e.name === 'SignatureDoesNotMatch') {
          health.available = false;
          health.details.error = 'Invalid credentials';
          return health;
        }
      }
      
      // 3. Bucket existence & accessibility
      try {
        await client.send(new HeadBucketCommand({ Bucket: process.env.B2_BUCKET_NAME }));
      } catch (e) {
        if (e.name === 'NoSuchBucket' || e.$metadata?.httpStatusCode === 404) {
          health.available = false;
          health.details.error = 'Bucket not found';
          return health;
        }
        throw e;
      }
      
      // 4. Actual service connectivity (list 1 object)
      await client.send(new ListObjectsV2Command({
        Bucket: process.env.B2_BUCKET_NAME,
        Prefix: 'library/',
        MaxKeys: 1,
      }));
      health.available = true;
      health.details.bucket = process.env.B2_BUCKET_NAME;
    }
  } catch (e) {
    health.details.error = classifyError(e);
  }
  
  return health;
}
```

**Key Improvements:**
1. Explicit credential validation at startup (fail fast)
2. Distinguish: config → auth → bucket → connectivity
3. Never expose credentials in health response
4. Actionable error hints for each failure mode

---

## 6. Staging Deployment & DNS Validation

### Required Vercel Project Settings

| Setting | Staging Value | Production Value |
|---------|---------------|------------------|
| **Project Name** | `astrovetro-staging` | `astrovetro-production` |
| **Framework Preset** | Other | Other |
| **Build Command** | `echo "No build step"` | `echo "No build step"` |
| **Output Directory** | `public` | `public` |
| **Install Command** | `npm ci` | `npm ci` |
| **Root Directory** | `.` (repo root) | `.` (repo root) |

### Required Environment Variables (Staging)

| Variable | Source | Required |
|----------|--------|----------|
| `NODE_ENV` | `staging` | ✅ |
| `FRONTEND_URL` | `https://staging.astrovetro.com` | ✅ |
| `DATABASE_URL` | Atlas staging connection string | ✅ |
| `JWT_SECRET` | Vercel-generated | ✅ |
| `RAZORPAY_KEY_ID` | Razorpay test key | ✅ |
| `RAZORPAY_KEY_SECRET` | Razorpay test secret | ✅ |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay test webhook | ⚠️ Optional |
| `UPSTASH_REDIS_REST_URL` | Upstash staging URL | ✅ |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash staging token | ✅ |
| `STORAGE_ADAPTER` | `b2` or `local` | ✅ |
| `B2_BUCKET_NAME` | Staging bucket | ⚠️ If B2 |
| `B2_KEY_ID` | Staging key | ⚠️ If B2 |
| `B2_APPLICATION_KEY` | Staging key | ⚠️ If B2 |
| `B2_ENDPOINT` | `https://s3.us-west-004.backblazeb2.com` | ⚠️ If B2 |
| `B2_REGION` | `us-west-004` | ⚠️ If B2 |
| `TRUST_PROXY` | `1` | ✅ |
| `DISABLE_RATE_LIMIT` | `false` | ✅ |

### DNS Records

| Record | Type | Value | TTL |
|--------|------|-------|-----|
| `staging.astrovetro.com` | CNAME | `cname.vercel-dns.com` | 300 |
| `staging.astrovetro.com` | TXT (verification) | Vercel-provided | 300 |

### TLS Requirements

- Vercel provisions automatic TLS (Let's Encrypt)
- Custom domain verified before TLS issuance
- HSTS enabled at edge (Vercel default)
- Certificate transparency logging enabled

### Rollback Strategy

| Scenario | Rollback Method | Time |
|----------|-----------------|------|
| Bad deployment | `vercel rollback` (previous deployment) | < 1 min |
| Bad DNS | Revert CNAME | < 5 min (TTL) |
| Bad env vars | Vercel dashboard revert | < 1 min |
| Database corruption | Atlas point-in-time restore | < 30 min |

### Production Isolation Checklist

- [ ] Separate Vercel project (`astrovetro-production`)
- [ ] Separate Atlas cluster (`astrovetro-production`)
- [ ] Separate Upstash Redis instance
- [ ] Separate B2 bucket (`astrovetro-production`)
- [ ] Separate GitHub secrets (no overlap)
- [ ] Separate Razorpay account (live vs test)
- [ ] Separate DNS zone (`astrovetro.com` vs `staging.astrovetro.com`)

---

## 7. Schedule Recalculation

### Workstream Duration Analysis

| WS | Tasks | Dependencies | Duration (Days) | Parallel |
|----|-------|--------------|-----------------|----------|
| **WS-1: Infra** | Vercel, Atlas M0, DNS | — | 3 | No |
| **WS-2: Deploy** | Vercel deploy, health verify | WS-1 | 2 | No |
| **WS-3: CI/CD** | GitHub Actions, secrets, test | WS-2 | 3 | No |
| **WS-4: E2E** | Playwright install, selectors, test | WS-2 | 4 | Yes (with WS-5) |
| **WS-5: Shutdown** | Serverless timeout design, tests | WS-1 | 4 | Yes (with WS-4) |
| **WS-6: Verify** | 8 SVs execution | WS-2,4,5 | 3 | No |
| **WS-7: Docs** | RUNBOOK, sign-off | WS-6 | 2 | No |

### Critical Path
```
WS-1 (3) → WS-2 (2) → WS-3 (3) → WS-6 (3) → WS-7 (2) = 13 days minimum
                    ↓
              WS-4 (4) || WS-5 (4) [parallel, overlap WS-3 tail]
```

### Working Day Schedule (Starting Nov 23, 2026)

| Day | Date | Workstream | Notes |
|-----|------|------------|-------|
| 1-3 | Nov 23-25 | WS-1: Infra | Atlas M0 (free), Vercel project, DNS |
| 4-5 | Nov 26-27 | WS-2: Deploy | Staging deploy, health verify |
| 6-8 | Nov 30-Dec 2 | WS-3: CI/CD | Pipeline + guard + test |
| 9-12 | Dec 3-6 | WS-4: E2E | Inspection → selectors → test |
| 9-12 | Dec 3-6 | WS-5: Timeout | Serverless timeout design + tests |
| 13-15 | Dec 7-9 | WS-6: Verify | All 8 SVs |
| 16-17 | Dec 10-11 | WS-7: Docs | RUNBOOK, sign-off |

**Total: 17 working days → Completion Dec 11, 2026**

**Dec 11 achievable** with 3-day buffer for Dec 20 target.

### Risk Adjustments

| Risk | Impact | Buffer |
|------|--------|--------|
| Vercel project creation delays | +1 day | Included |
| Atlas cluster provisioning | +1 day | Included |
| DNS propagation | +0.5 day | Included |
| CI/CD pipeline debugging | +1 day | Included |
| Playwright selector flakiness | +1 day | Included |

---

## 8. Corrected Architecture Decisions

### Summary of Plan Corrections

| Area | Original Plan | Corrected Plan | Rationale |
|------|---------------|----------------|-----------|
| **Vercel Project ID** | `astrovetro-staging` | Actual Project ID from Vercel | Auto-generated IDs |
| **Deployment Guard** | Name comparison | Actual Project ID + forbidden list | Fail-closed |
| **Server Architecture** | Persistent + shutdown | Serverless (10s timeout) | Vercel serverless |
| **Graceful Shutdown** | `server.close()` + drain + force-close | Design for 10s timeout | Serverless model |
| **MongoDB Staging** | Atlas M10 replica set | Atlas M0 (free) standalone | No transactions used |
| **Rate Limiting** | Generic fail-open | Per-endpoint fail modes | Security requirements |
| **B2 Health Check** | Single list check | Multi-stage: config→auth→bucket→connectivity | Actionable diagnostics |
| **Atlas Tier** | M10 ($57/mo) | M0 (free) | No transactions needed |
| **Schedule** | 20 days | 17 days (Dec 11) | Realistic critical path |

---

## 9. WS-1 Provisioning Prerequisites Checklist

### Before Provisioning Anything

| Prerequisite | Status | Action |
|--------------|--------|--------|
| Vercel account access | ⬜ | Obtain from team |
| Vercel organization ID | ⬜ | Dashboard → Settings |
| DNS provider access (staging.astrovetro.com) | ⬜ | Cloudflare/Route53 |
| GitHub repository with Actions enabled | ✅ | Already configured |
| MongoDB Atlas account | ⬜ | Create org/project |
| Upstash Redis account | ⬜ | Create staging instance |
| Backblaze B2 account (optional) | ⬜ | If using B2 |
| Razorpay test account | ⬜ | Apply NOW (3-7 day approval) |
| GitHub Secrets permissions | ✅ | Admin access |

### Exact Credentials Needed for GitHub Secrets

| Secret | Source | Value Format |
|--------|--------|--------------|
| `VERCEL_TOKEN` | Vercel Account → Tokens | `vercel_xxxxx` |
| `VERCEL_ORG_ID` | Vercel Dashboard → Settings | `team_xxxxx` |
| `VERCEL_PROJECT_ID` | **After creating staging project** | `prj_xxxxx` |
| `MONGODB_URI_STAGING` | Atlas → Connect → Drivers | `mongodb+srv://...` |
| `UPSTASH_REDIS_REST_URL` | Upstash Console → Details | `https://xxx.upstash.io` |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Console → Details | `xxxxxxxx` |
| `B2_BUCKET_NAME` | B2 Dashboard → Buckets | `astrovetro-staging` |
| `B2_KEY_ID` | B2 Dashboard → App Keys | `xxxxxxxx` |
| `B2_APPLICATION_KEY` | B2 Dashboard → App Keys | `xxxxxxxx` |
| `RAZORPAY_KEY_ID` | Razorpay Dashboard → Settings | `rzp_test_xxxxx` |
| `RAZORPAY_KEY_SECRET` | Razorpay Dashboard → Settings | `xxxxxxxx` |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay Dashboard → Webhooks | `whsec_xxxxx` |

---

## 10. Estimated Recurring Costs (Staging)

| Component | Tier | Monthly Cost | Annual |
|-----------|------|--------------|--------|
| **Vercel** | Hobby (free) | $0 | $0 |
| **MongoDB Atlas** | M0 (free) | $0 | $0 |
| **Upstash Redis** | Free (10k/day) | $0 | $0 |
| **Backblaze B2** | Pay-as-you-go | ~$1-5 | ~$12-60 |
| **DNS** | Existing domain | $0 | $0 |
| **Total (Staging)** | | **~$1-5/mo** | **~$12-60/yr** |

**Production (separate, not provisioned now):**
- Vercel Pro: $20/mo
- Atlas M10: $57/mo
- Upstash Pro: $25/mo
- B2: ~$5-20/mo
- **Total: ~$100-120/mo**

---

## 11. Revised Timeline

| Milestone | Target Date | Confidence |
|-----------|-------------|------------|
| WS-1 Infra Complete | Nov 25 | High |
| WS-2 Deploy Complete | Nov 27 | High |
| WS-3 CI/CD Green | Dec 2 | Medium |
| WS-4/5 Parallel Complete | Dec 6 | Medium |
| WS-6 All SVs PASS | Dec 9 | Medium |
| WS-7 RUNBOOK + Sign-off | Dec 11 | High |
| **M2 Complete** | **Dec 11** | **High** |
| Phase 2 Unblocked | Dec 12+ | — |

**Dec 20 target achievable with 9-day buffer.**

---

## 12. Remaining Blockers

| Blocker | Category | Resolution | Owner |
|---------|----------|------------|-------|
| Vercel account/org access | Credentials | Request from team | User |
| DNS provider access | Credentials | Request from team | User |
| MongoDB Atlas account | Credentials | Create org/project | User |
| Upstash Redis account | Credentials | Create staging instance | User |
| B2 account (optional) | Credentials | Create if needed | User |
| Razorpay test account | External | **Apply NOW** (3-7 days) | User |
| GitHub Actions secrets | Permissions | Admin access confirmed | User |
| **WS-5 Architecture Decision** | **Design** | **Approve serverless timeout model** | **Architect** |

---

## 13. Exact Next Executable Task

### WS-1 Task 1: Provision Vercel Staging Project (Documentation Only)

**Do not execute — document the exact steps:**

```markdown
## WS-1 Task 1: Provision Vercel Staging Project (Manual)

### Prerequisites
- [ ] Vercel account with org access
- [ ] DNS access for staging.astrovetro.com

### Steps
1. Login to Vercel Dashboard: `vercel login`
2. Create project: `vercel init astrovetro-staging --scope=<org>`
3. Configure:
   - Project name: `astrovetro-staging`
   - Framework: Other
   - Build: `echo "No build step"`
   - Output: `public`
   - Install: `npm ci`
4. Add domain: `staging.astrovetro.com` (CNAME → cname.vercel-dns.com)
5. **Record Project ID** from Settings → General (e.g., `prj_abc123`)
6. Create `vercel-staging.json`:
   ```json
   {
     "rewrites": [{ "source": "/api/(.*)", "destination": "/api/$1" }],
     "headers": [{ "source": "/(.*)", "headers": [{ "key": "X-Environment", "value": "staging" }] }]
   }
   ```
7. Test deploy: `vercel --prod --config vercel-staging.json --token=$VERCEL_TOKEN --scope=astrovetro-staging`
8. Verify: `curl -I https://staging.astrovetro.com/api/health` → 200 + `X-Environment: staging`

### Deliverable
- Vercel Project ID recorded in GitHub Secret `VERCEL_PROJECT_ID`
- `vercel-staging.json` committed to repo
- DNS CNAME configured
- Deployment verified with health check
```

---

## 14. Files to Update

### Updated Files (This Audit)

1. ✅ `.planning/recovery/WS-1-PREPROVISIONING-AUDIT.md` (this document)
2. ⬜ `.planning/phases/01-4-production-readiness/01-04-PLAN.md` — WS-1, WS-5 corrections
3. ⬜ `.planning/phases/01-4-production-readiness/1.4-UAT.md` — Update test expectations
4. ⬜ `.planning/STATE.md` — Update active work status

### Key Plan Corrections to Apply

**WS-1 (Infrastructure):**
- Atlas M0 (free) instead of M10
- Vercel Project ID from dashboard (not assumed name)
- DNS configuration documented

**WS-5 (Graceful Shutdown → Serverless Timeout Design):**
- Remove persistent-server shutdown code
- Add serverless timeout budgeting (10s)
- Per-invocation DB connection management
- Cold start optimization

**WS-3 (CI/CD):**
- Pre-deploy guard uses actual Project ID
- Forbidden production project ID list

**WS-4 (E2E):**
- Selectors documented from actual staging HTML
- Test cleanup for serverless (no persistent state)

**WS-6 (SVs):**
- SV-006: "Serverless timeout budget" not "SIGTERM drain"
- SV-003: Works on standalone MongoDB (guarded `$inc`)

---

## Approval Required

**This audit must be reviewed and approved before any infrastructure provisioning.**

### Approval Checklist

- [ ] Vercel Project ID resolution method approved
- [ ] Serverless timeout model (10s) accepted for graceful degradation
- [ ] Atlas M0 (free) approved for staging
- [ ] Per-endpoint rate limit failure modes approved
- [ ] B2 health check multi-stage design approved
- [ ] Schedule (17 days, Dec 11) accepted
- [ ] WS-1 provisioning steps documented (not executed)

**Once approved:** Proceed to WS-1 Task 1 documentation (no execution until explicit go-ahead).

---

*Audit completed: 2026-11-22*  
*Canonical repository: `astrovetro-root` (branch `recovery/phase-1.4-canonical`)*  
*Next: Await approval → Update plan files → Begin WS-1 documentation*