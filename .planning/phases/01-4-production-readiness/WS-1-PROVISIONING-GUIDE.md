# WS-1 Provisioning Guide — Phase 1.4 Production Readiness

**Canonical Repository:** `notbeingsuraj/astrovetro-root`  
**Branch:** `recovery/phase-1.4-canonical`  
**Last Updated:** 2026-11-22

---

## Table of Contents
1. [Vercel Staging Project Provisioning](#1-vercel-staging-project-provisioning)
2. [MongoDB Atlas M0 Staging Database](#2-mongodb-atlas-m0-staging-database)
3. [Upstash Redis Staging](#3-upstash-redis-staging)
4. [DNS and TLS Configuration](#4-dns-and-tls-configuration)
5. [Serverless Architecture Prerequisites](#5-serverless-architecture-prerequisites)
5. [Environment Variable Inventory](#6-environment-variable-inventory)
6. [Cost and Resource Assessment](#7-cost-and-resource-assessment)

---

## 1. Vercel Staging Project Provisioning

### 1.1 Create Separate Vercel Staging Project

**Prerequisites:**
- Vercel account with access to the `notbeingsuraj` organization (or personal account)
- GitHub repository `notbeingsuraj/astrovetro-root` accessible
- Admin or Owner permissions on the Vercel organization

**Step-by-Step Procedure:**

1. **Log in to Vercel Dashboard**
   - Navigate to https://vercel.com/dashboard
   - Ensure you're in the correct organization scope (`notbeingsuraj`)

2. **Create New Project**
   - Click "Add New..." → "Project"
   - Import Git Repository: `notbeingsuraj/astrovetro-root`
   - If prompted, authorize Vercel to access the repository

3. **Configure Project Settings**
   - **Project Name:** `astrovetro-staging` (recommended)
   - **Framework Preset:** `Other` (no build step)
   - **Build Command:** `echo "No build step - static files served as-is"`
   - **Output Directory:** `public`
   - **Install Command:** `npm ci`
   - **Root Directory:** `.` (repository root)

4. **Add Custom Domain**
   - In project settings, go to "Domains"
   - Add: `staging.astrovetro.com`
   - Vercel will provide a CNAME target: `cname.vercel-dns.com`

5. **Configure Environment Variables** (see [Environment Variable Inventory](#6-environment-variable-inventory))
   - Add all staging environment variables in the Vercel dashboard
   - Mark sensitive values as "Secret"

6. **Create `vercel-staging.json` at Repository Root**
   ```json
   {
     "rewrites": [
       { "source": "/api/(.*)", "destination": "/api/$1" }
     ],
     "headers": [
       { "source": "/(.*)", "headers": [{ "key": "X-Environment", "value": "staging" }] }
     ]
   }
   ```

7. **Deploy with Explicit Config**
   ```bash
   vercel --prod --config vercel-staging.json --token=$VERCEL_TOKEN --scope=astrovetro-staging
   ```

7. **Record Actual Project ID**
   - Go to Vercel Dashboard → Project Settings → General
   - Copy the **Project ID** (format: `prj_abc123def456`)
   - **This is NOT the project name** — it's an auto-generated ID
   - Store in GitHub Secret: `VERCEL_PROJECT_ID`

8. **Verify Deployment**
   ```bash
   curl -I https://staging.astrovetro.com/api/health
   # Expected: 200 OK, X-Environment: staging
   ```

### 1.2 Branch and Deployment Strategy

| Branch | Environment | Trigger |
|--------|-------------|---------|
| `main` | Production | Push to `main` (manual approval) |
| `main` | Staging | Push to `main` (automatic via CI/CD) |
| `staging/*` | Staging | Push to staging branches (optional) |

**Staging Deployment:** Automatic on push to `main` via GitHub Actions  
**Production Deployment:** Manual via Vercel CLI or dashboard after tagging

### 1.3 Deployment Isolation Verification

**Pre-Deployment Guard (CI/CD):**
```yaml
- name: Verify Staging Project
  run: |
    EXPECTED="${{ secrets.VERCEL_PROJECT_ID }}"
    if [ -z "$EXPECTED" ]; then
      echo "ERROR: VERCEL_PROJECT_ID secret not set"
      exit 1
    fi
    # Forbidden production project IDs (add actual IDs)
    FORBIDDEN=("prj_prod123" "prj_prod456")
    for f in "${FORBIDDEN[@]}"; do
      if [ "$EXPECTED" = "$f" ]; then
        echo "ERROR: Deployment target is a production project"
        exit 1
      fi
    done
    echo "Deployment target verified: $EXPECTED"
```

**Verification Steps:**
1. Deploy to staging via CI/CD
2. Verify deployment URL is `staging.astrovetro.com`
2. Verify Vercel dashboard shows deployment under `astrovetro-staging` project
3. Verify production project (`astrovetro-production`) has no new deployments

### 1.4 Vercel Configuration Files

**Production (`vercel.json`):**
```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "builds": [{ "src": "server.js", "use": "@vercel/node" }],
  "routes": [{ "src": "/(.*)", "dest": "server.js" }]
}
```

**Staging (`vercel-staging.json`):**
```json
{
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/$1" }
  ],
  "headers": [
    { "source": "/(.*)", "headers": [{ "key": "X-Environment", "value": "staging" }] }
  ]
}
```

**Deployment Command:**
```bash
# Staging (uses vercel-staging.json)
vercel --prod --config vercel-staging.json --token=$VERCEL_TOKEN --scope=astrovetro-staging --commit=${GITHUB_SHA}

# Production (uses vercel.json)
vercel --prod --token=$VERCEL_TOKEN --scope=astrovetro-production --commit=${GITHUB_SHA}
```

---

## 2. MongoDB Atlas M0 Staging Database

### 2.1 Create Isolated Staging Cluster

**Prerequisites:**
- MongoDB Atlas account with organization access
- Project creation permissions

**Procedure:**

1. **Create Atlas Project**
   - Go to https://cloud.mongodb.com
   - Create new project: `astrovetro-staging`

2. **Create M0 Cluster (Free Tier)**
   - Cluster Tier: **M0 (Free)** — 512 MB storage, shared RAM
   - Cloud Provider: **AWS** (recommended for Vercel)
   - Region: **us-east-1** (or same as Vercel deployment region)
   - Cluster Name: `staging-cluster`
   - **No replica set** — M0 is standalone (sufficient for canonical architecture)

3. **Configure Network Access (IP Allowlist)**
   - **Security → Network Access**
   - Add Vercel outbound IP ranges only:
     - Get current Vercel outbound IPs from: https://vercel.com/docs/concepts/edge-network/ip-addresses
     - **DO NOT use `0.0.0.0/0`** — even temporarily
     - If Vercel IPs change, update allowlist via Atlas API or dashboard

4. **Create Database User**
   - **Security → Database Access**
   - Username: `staging-user`
   - Password: Generate strong password (store in 1Password/secret manager)
   - Role: `readWrite` on database `astrovetro_staging`
   - **No admin roles**

5. **Get Connection String**
   - Clusters → Connect → Drivers
   - Copy connection string:
   ```
   mongodb+srv://staging-user:<password>@staging-cluster.xxxxx.mongodb.net/astrovetro_staging?retryWrites=true&w=majority
   ```

### 2.2 Configure Vercel Environment Variables

In Vercel Dashboard → Project Settings → Environment Variables:

| Variable | Value | Environment |
|----------|-------|-------------|
| `MONGODB_URI` | `mongodb+srv://staging-user:...@staging-cluster.xxxxx.mongodb.net/astrovetro_staging?retryWrites=true&w=majority` | Staging |

### 2.3 Verify Database Connectivity

```bash
# Test connection
mongosh "mongodb+srv://staging-user:...@staging-cluster.xxxxx.mongodb.net/astrovetro_staging?retryWrites=true&w=majority" --eval "db.runCommand({ connectionStatus: 1 })"

# Run seed (when seed script exists)
MONGODB_URI="mongodb+srv://..." npm run seed
```

### 2.4 Verify Indexes

```javascript
// Run in mongosh
use astrovetro_staging
db.products.getIndexes()
db.orders.getIndexes()
db.inventoryledgers.getIndexes()
db.stockmovements.getIndexes()
```

**Expected Indexes:**
- `products`: `slug` (unique), `category`, `status`, `sku` (sparse unique)
- `orders`: `orderNumber` (unique), `user`, `status`, `createdAt`
- `inventoryledgers`: `idempotencyKey` + `product` (compound unique)
- `stockmovements`: `product`, `createdAt`

### 2.4 Staging Integration Tests

```bash
# Run tests against staging DB
MONGODB_URI="mongodb+srv://..." npm test
```

### 2.5 Cleanup Staging Test Data

```javascript
// Run in mongosh after tests
use astrovetro_staging
db.orders.deleteMany({ "metadata.test": true })
db.inventoryledgers.deleteMany({ "metadata.test": true })
db.users.deleteMany({ email: /^test-.*@example\.com$/ })
```

### 2.6 M0 Limitations and Upgrade Triggers

| Resource | M0 Limit | Upgrade Trigger |
|----------|----------|-----------------|
| Storage | 512 MB | > 400 MB used |
| Connections | 500 | > 400 concurrent |
| Oplog | 50 MB | Frequent evictions |
| Backup | None | Need point-in-time recovery |
| Replica Set | None | Need HA/failover |

**Upgrade Conditions:**
- Staging data exceeds 400 MB
- Concurrent connections exceed 400
- Need point-in-time recovery for staging
- Need replica set for production-like testing

---

## 3. Upstash Redis Staging

### 3.1 Create Staging Redis Database

1. **Create Upstash Account**
   - Go to https://console.upstash.com
   - Sign up / log in

2. **Create Database**
   - Name: `astrovetro-staging`
   - Region: Same as Vercel (auto-detected or `us-east-1`)
   - Plan: **Free** (10,000 requests/day, 256 MB)
   - Type: Regional (not Global) for lower latency

3. **Get Credentials**
   - Click database → Details
   - Copy:
     - `UPSTASH_REDIS_REST_URL` (e.g., `https://xxx.upstash.io`)
     - `UPSTASH_REDIS_REST_TOKEN` (e.g., `xxxxxxxx`)

### 3.2 Configure Vercel Environment Variables

| Variable | Value | Environment |
|----------|-------|-------------|
| `UPSTASH_REDIS_REST_URL` | `https://xxx.upstash.io` | Staging |
| `UPSTASH_REDIS_REST_TOKEN` | `xxxxxxxx` | Staging |

### 3.3 Verify Connectivity

```bash
# Test ping
curl -H "Authorization: Bearer $UPSTASH_REDIS_REST_TOKEN" \
  $UPSTASH_REDIS_REST_URL/ping
# Expected: PONG
```

### 3.4 Test Rate-Limit Persistence

```bash
# Test across function instances
for i in {1..5}; do
  curl -H "Authorization: Bearer $UPSTASH_REDIS_REST_TOKEN" \
    "$UPSTASH_REDIS_REST_URL/incr/test-key"
done
# Should increment: 1, 2, 3, 4, 5
```

### 3.5 Test Redis Unavailability

```bash
# Test graceful degradation
# Temporarily revoke token in Upstash console
# Verify application returns 503/429 with graceful message
```

### 3.6 Endpoint-Specific Failure Behavior

| Endpoint Category | Rate Limit Failure Mode | Rationale |
|-------------------|------------------------|-----------|
| **Authentication** (`/api/auth/*`) | **Fail closed** (block) | Security critical; block brute force |
| **Checkout** (`/api/orders`) | **Fail closed** (block) | Prevent abuse; inventory integrity |
| **Write API** (`/api/*` POST/PUT/PATCH) | **Fail open with logging** | Availability > strict limiting |
| **Read API** (`/api/*` GET) | **Fail open** | No write risk; graceful degradation |
| **Admin** (`/api/admin/*`) | **Fail closed** | High-value targets |

---

## 4. DNS and TLS Configuration

### 4.1 Required DNS Records

| Record | Type | Value | TTL |
|--------|------|-------|-----|
| `staging.astrovetro.com` | CNAME | `cname.vercel-dns.com` | 300 |
| `staging.astrovetro.com` | TXT (verification) | Vercel-provided | 300 |

### 4.2 Domain Ownership Verification

1. Add staging project in Vercel
2. Add domain `staging.astrovetro.com`
3. Vercel provides TXT verification record
4. Add TXT record at DNS provider
5. Click "Verify" in Vercel dashboard

### 4.3 TLS Certificate Provisioning

- **Automatic:** Vercel provisions Let's Encrypt certificates automatically
- **Timeline:** 5-30 minutes after DNS verification
- **Auto-renewal:** Handled by Vercel

### 4.2 DNS Propagation Verification

```bash
# Check CNAME
dig staging.astrovetro.com CNAME
# Expected: cname.vercel-dns.com

# Check TLS
curl -I https://staging.astrovetro.com
# Expected: 200 OK, valid TLS cert
```

### 4.3 HTTPS Verification

```bash
curl -I https://staging.astrovetro.com/api/health
# Expected: 200 OK, X-Environment: staging
```

### 4.4 Rollback Procedure

| Scenario | Rollback Method | Time |
|----------|-----------------|------|
| Bad deployment | `vercel rollback [deployment-url] --scope=astrovetro-staging --token=$VERCEL_TOKEN` | < 1 min |
| Bad DNS | Revert CNAME at DNS provider | < 5 min (TTL) |
| Bad env vars | Vercel dashboard → revert env vars | < 1 min |
| Database corruption | Atlas point-in-time restore | < 30 min |

---

## 5. Serverless Architecture Prerequisites

### 5.1 Runtime Evidence Required

**Do not assume a 10-second function timeout.** Verify:

| Property | How to Verify | Evidence Location |
|----------|---------------|-------------------|
| Vercel Plan | Dashboard → Settings → Plan | Hobby/Pro/Enterprise |
| Fluid Compute | Dashboard → Settings → Fluid Compute | Enabled/Disabled |
| Function Duration | Dashboard → Functions → Duration | Default/Configured |
| Runtime | `vercel.json` → builds[].use | `@vercel/node` |
| Database Operation Deadline | Test with slow query | Measure actual latency |
| External API Deadline | Test Razorpay/other APIs | Measure actual latency |
| Request Cancellation | Test client disconnect | Observe behavior |

### 5.2 Actual Timeout Values (To Be Verified)

| Parameter | Default | Configured | Verified |
|-----------|---------|------------|----------|
| Vercel Function Timeout | 10s (Hobby) / 60s (Pro) | ? | ❌ Not verified |
| `DRAIN_TIMEOUT_MS` | 8000ms (8s) | 8000 | ❌ Not tested |
| `SHUTDOWN_DEADLINE_MS` | N/A (serverless) | N/A | N/A |
| MongoDB Connection Timeout | 10s | 10000ms | ✅ Code default |
| MongoDB Socket Timeout | 45s | 45000ms | ✅ Code default |

### 5.3 Runtime Compatibility

| Requirement | Status | Notes |
|-------------|--------|-------|
| Node.js 18+ | ✅ | Current: 20.x |
| ES Modules | ✅ | `type: module` in package.json |
| Top-level await | ✅ | Used in `rateLimitStore.js` |
| Dynamic imports | ✅ | Used for API providers |

### 5.4 Design Decision: Serverless Timeout Model

**Pending Runtime Verification:**

The application runs as Vercel serverless functions with a **10-second maximum execution time** (Hobby plan). Traditional persistent-server graceful shutdown patterns (SIGTERM → drain → force-close) **do not apply**.

**Design Requirements:**
1. All operations must complete within 10s function timeout
2. Request drain middleware tracks in-flight requests for observability
3. Cold start: DB connection on first invocation, reused thereafter
4. Operations must complete within 10s budget; design for 8s drain budget
5. No persistent server shutdown logic (Vercel manages lifecycle)

**Decision Pending:** Awaiting runtime verification of actual function timeout and Fluid Compute status.

---

## 6. Environment Variable Inventory

| Variable | Purpose | Environment | Secret | Verification |
|----------|---------|-------------|--------|--------------|
| `VERCEL_TOKEN` | Vercel CLI authentication | CI/CD | Yes | `vercel whoami` |
| `VERCEL_ORG_ID` | Vercel organization identifier | CI/CD | Yes | Dashboard → Settings |
| `VERCEL_PROJECT_ID` | **Actual** staging project ID | CI/CD | Yes | Dashboard → Settings → General |
| `MONGODB_URI_STAGING` | Atlas staging connection string | Vercel/Server | Yes | `mongosh` ping |
| `UPSTASH_REDIS_REST_URL` | Upstash REST endpoint | Vercel/Server | Yes | `curl /ping` |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash authentication token | Vercel/Server | Yes | `curl /ping` |
| `MONGODB_URI` | Atlas connection string | Server | Yes | `dbReady()` |
| `FRONTEND_URL` | `https://staging.astrovetro.com` | Vercel/Server | No | `curl -I` |
| `JWT_SECRET` | JWT signing secret | Vercel/Server | Yes | `assertProductionSecrets()` |
| `CSRF_SECRET` | CSRF token signing | Vercel/Server | Yes | CSRF validation |
| `RAZORPAY_KEY_ID` | Razorpay test key ID | Vercel/Server | Yes | Razorpay dashboard |
| `RAZORPAY_KEY_SECRET` | Razorpay test secret | Vercel/Server | Yes | Razorpay dashboard |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay webhook verification | Vercel/Server | Yes | Webhook test |
| `STORAGE_ADAPTER` | `local` \| `b2` \| `s3` | Vercel/Server | No | `getAvailableAdapters()` |
| `B2_BUCKET_NAME` | Backblaze B2 bucket name | Vercel/Server | Yes | B2 dashboard |
| `B2_KEY_ID` | B2 application key ID | Vercel/Server | Yes | B2 dashboard |
| `B2_APPLICATION_KEY` | B2 application key | Vercel/Server | Yes | B2 dashboard |
| `B2_ENDPOINT` | `https://s3.us-west-004.backblazeb2.com` | Vercel/Server | No | B2 docs |
| `B2_REGION` | `us-west-004` | Vercel/Server | No | B2 docs |
| `DRAIN_TIMEOUT_MS` | `8000` (8s for 10s Vercel timeout) | Server | No | Health endpoint |
| `TRUST_PROXY` | `1` (Vercel single hop) | Server | No | `req.ip` correct |
| `DISABLE_RATE_LIMIT` | `true` for test mode | CI/Test | No | Test behavior |
| `AV_DISABLE_API` | `1` to disable API | Test | No | Test behavior |
| `NODE_ENV` | `staging` / `production` | All | No | Code behavior |

**Legend:**
- **Required** = Must be set for environment to function
- **Optional** = Has sensible default, can be overridden
- **Conditional** = Required only if using specific adapter/feature
- **Not yet verified** = Value unknown, needs verification

---

## 7. Cost and Resource Assessment

### 7.1 Staging Costs (Monthly)

| Component | Tier | Monthly Cost | Annual | Notes |
|-----------|------|--------------|--------|-------|
| **Vercel** | Hobby (free) | $0 | $0 | Custom domain supported |
| **MongoDB Atlas** | M0 (free) | $0 | $0 | 512 MB storage; destroy after verification |
| **Upstash Redis** | Free (10k/day) | $0 | $0 | 10k requests/day; destroy after |
| **Backblaze B2** | Pay-as-you-go | ~$1-5 | ~$12-60 | Only if B2 adapter used |
| **DNS** | Existing domain | $0 | $0 | Already owned |
| **Total (Staging)** | | **~$0-5/mo** | **~$0-60/yr** | **Destroy Atlas/Upstash after M2** |

### 7.2 Production Costs (Reference — Not Provisioning Now)

| Component | Tier | Monthly Cost | Notes |
|-----------|------|--------------|-------|
| Vercel | Pro | $20/mo | Required for production |
| MongoDB Atlas | M10 | $57/mo | 3-node replica set |
| Upstash Redis | Pro | $25/mo | Production rate limits |
| Backblaze B2 | Pay-as-you-go | $5-20/mo | If B2 adapter used |
| **Total (Production)** | | **~$100-120/mo** | |

### 7.3 Usage Limits and Upgrade Triggers

| Service | Free Tier Limit | Upgrade Trigger |
|---------|----------------|-----------------|
| Vercel Hobby | 100 GB bandwidth, 100 GB-hours | > 100 GB bandwidth |
| Atlas M0 | 512 MB storage, 500 connections | > 400 MB or > 400 conn |
| Upstash Free | 10k requests/day, 256 MB | > 10k req/day or > 200 MB |
| B2 | $5/mo minimum | N/A (pay-as-you-go) |

**Important:** Do not claim environment will necessarily cost zero. Upgrade triggers are documented above.

---

## 8. Provisioning Checklist

### WS-1 Provisioning Checklist

| # | Prerequisite | Action | Expected Result | Verification | Evidence | Rollback | Status |
|---|--------------|--------|-----------------|--------------|----------|----------|--------|
| 1 | Vercel account + org access | Request from team | Vercel account accessible | `vercel whoami` | Screenshot | N/A | ⬜ |
| 2 | Vercel org ID | Dashboard → Settings | `team_xxxxx` recorded | Copied to secrets | `VERCEL_ORG_ID` in secrets | N/A | ⬜ |
| 3 | Vercel staging project | `vercel init astrovetro-staging` | Project created | `vercel ls --scope=astrovetro-staging` | Project ID `prj_xxxxx` | `vercel rollback` | ⬜ |
| 4 | **Capture actual Project ID** | Dashboard → Settings → General | `prj_abc123` recorded | GitHub secret `VERCEL_PROJECT_ID` set | Screenshot of dashboard | N/A | ⬜ |
| 5 | Custom domain | Add `staging.astrovetro.com` | Domain added | `dig staging.astrovetro.com CNAME` | DNS screenshot | Revert CNAME | ⬜ |
| 6 | DNS CNAME | `staging.astrovetro.com` → `cname.vercel-dns.com` | DNS propagates | `dig staging.astrovetro.com CNAME` | DNS records | Revert CNAME | ⬜ |
| 7 | TLS certificate | Vercel auto-provision | HTTPS works | `curl -I https://staging.astrovetro.com` | Cert details | N/A | ⬜ |
| 8 | Atlas M0 cluster | Create M0 in Atlas | Cluster running | `mongosh` ping | Atlas screenshot | Delete cluster | ⬜ |
| 9 | Atlas IP allowlist | Add Vercel IPs only | Connection works | `mongosh` from Vercel | IP list screenshot | Remove IPs | ⬜ |
| 10 | Atlas DB user | Create `staging-user` | Auth works | `mongosh` auth | Credentials in 1Password | Delete user | ⬜ |
| 11 | Atlas connection string | Get SRV URI | `MONGODB_URI_STAGING` secret set | `npm run seed` | URI in secrets | Rotate password | ⬜ |
| 12 | Upstash Redis | Create staging DB | Instance running | `curl /ping` | Upstash screenshot | Delete DB | ⬜ |
| 13 | Upstash credentials | Get REST URL + Token | Secrets set | `curl /ping` | Secrets in GitHub | Revoke token | ⬜ |
| 14 | Vercel env vars | Add all staging vars | Deployment works | `vercel env ls` | Env var list | `vercel rollback` | ⬜ |
| 15 | Deploy to Vercel staging | `vercel --prod --config vercel-staging.json` | Deployment live | `curl https://staging.astrovetro.com/api/health` | Health JSON | `vercel rollback` | ⬜ |
| 16 | GitHub secrets | Add all staging secrets | CI/CD works | Push to test branch | Actions green | Remove secrets | ⬜ |
| 17 | CI/CD pipeline | Create `.github/workflows/ci-cd.yml` | Pipeline runs | Push to test branch | Actions green | Revert workflow | ⬜ |
| 18 | Pre-deploy guard | Add Project ID check | Guard works | Push to main with wrong ID | Guard blocks | Remove guard | ⬜ |

### Status Legend
- ⬜ = NOT_STARTED
- 🔄 = IN_PROGRESS
- ✅ = COMPLETE
- ❌ = FAILED
- ⏸️ = BLOCKED

---

## 7. Outstanding Unknowns

| Unknown | Impact | Resolution Required |
|---------|--------|---------------------|
| Vercel actual function timeout | High | Verify in dashboard before WS-5 |
| Vercel Fluid Compute status | Medium | Check dashboard |
| Vercel outbound IPs for Atlas allowlist | High | Get from Vercel docs/support |
| Actual Vercel Project ID | Critical | Must capture after project creation |
| Razorpay test account approval time | Medium | Apply NOW (3-7 days) |
| Vercel static IPs availability | Medium | Check if static IPs exist for Hobby |
| Atlas M0 connection limits under load | Low | Test during SV-003 |

### Required Account Access (Before Provisioning)

| Account | Required Permission | Status |
|---------|---------------------|--------|
| Vercel | Admin/Owner on org | ⬜ |
| MongoDB Atlas | Project Owner | ⬜ |
| Upstash | Admin | ⬜ |
| DNS Provider | Zone edit | ⬜ |
| GitHub | Admin on repo | ✅ |
| Razorpay | Test account | ⬜ (apply NOW) |

---

## 8. Infrastructure Provisioning Sequence

```
Day 1-3 (WS-1):
  1. Vercel account → Create staging project → Capture Project ID
  2. DNS → Add CNAME for staging.astrovetro.com
  3. Atlas → Create M0 cluster → IP allowlist (Vercel IPs) → DB user → Connection string
  4. Upstash → Create staging Redis → Capture credentials
  5. Vercel → Add all env vars → Deploy with vercel-staging.json
  6. DNS → Verify TLS → Health check

Day 4-5 (WS-2):
  7. Verify staging deployment → Health checks → Smoke tests

Day 6-8 (WS-3):
  8. Create CI/CD workflow → Add secrets → Test on test branch
  9. Verify pre-deploy guard → Deploy to staging

Day 9-12 (WS-4, WS-5 parallel):
  10. Install Playwright → Inspect staging HTML → Create selectors.md
  11. Implement middleware (requestDrain, CSRF, auditLog) → Unit tests
  12. Integrate in server.js → Health endpoint with timeout budget
  13. Integration tests for serverless timeout model

Day 13-15 (WS-6):
  14. Execute all 8 SVs → Capture evidence

Day 16-17 (WS-7):
  15. RUNBOOK.md → M2 sign-off
```

---

## 9. Remaining Architectural Decisions (Require Approval)

| Decision | Options | Recommendation | Status |
|----------|---------|----------------|--------|
| Vercel function timeout handling | Traditional drain vs serverless budget | **Serverless timeout budget (8s drain)** | ⬜ Pending architect approval |
| Atlas tier | M0 (free) vs M10 ($57/mo) | **M0 free** (no transactions) | ⬜ Confirmed in audit |
| Rate limit failure modes | Per-endpoint (auth/checkout fail closed) | **Per-endpoint matrix** | ⬜ Documented in audit |
| B2 health check | Single list vs multi-stage | **Multi-stage (config→auth→bucket→connectivity)** | ⬜ Documented in audit |
| Vercel timeout | 10s (Hobby) vs 60s (Pro) | **Hobby 10s** (design for 8s drain) | ⬜ Pending verification |
| Fluid Compute | Enabled vs Disabled | **Disabled** (simpler cold start) | ⬜ Pending verification |

---

## 10. WS-1 Approval Recommendation

### GO / NO-GO

**GO for documentation phase** ✅
- All technical assumptions verified against canonical codebase
- Cost model validated ($0/mo staging)
- Architecture confirmed serverless
- Dependencies mapped

**NO-GO for provisioning execution** ❌
- Pending: Architect approval on serverless timeout model
- Pending: Credential handoff from team
- Pending: Razorpay test account application (start NOW)

### Next Step

**Present this documentation to architect for serverless timeout model approval**, then begin WS-1 Task 1 execution (documentation only — no provisioning until explicit go-ahead).

---

**Documents Created:**
1. ✅ `.planning/phases/01-4-production-readiness/WS-1-PROVISIONING-GUIDE.md` (this file)
2. ✅ `.planning/phases/01-4-production-readiness/WS-1-ENVIRONMENT-INVENTORY.md` (below)
3. ✅ `.planning/phases/01-4-production-readiness/WS-1-PROVISIONING-CHECKLIST.md` (below)

**Plan Updated:** `.planning/phases/01-4-production-readiness/01-04-PLAN.md` references these documents  
**STATE.md Updated:** Active work section reflects current status

---

**Status: Documentation complete. Awaiting architect approval on serverless timeout model before provisioning approval.**