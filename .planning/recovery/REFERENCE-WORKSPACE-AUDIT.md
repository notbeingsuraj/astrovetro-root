# Reference Workspace Audit — AstroVetro.com (React/Vite + Express)

## 1. Repository Overview

**Repository**: `notbeingsuraj/AstroVetro.com`  
**Local Path**: `~/Desktop/Important-backups/astrovetro`  
**Branch**: `phase-1.4-production-readiness` (at `2bcc139`)  
**Architecture**: React 19 + Vite 8 (client) + Express 4 + Mongoose 8 (server)  
**Deployment**: Vercel (frontend) + Render (API) + MongoDB Atlas

---

## 2. Architecture Comparison

| Aspect | Canonical (`astrovetro-root`) | Reference (`AstroVetro.com`) | Compatibility |
|--------|------------------------------|------------------------------|---------------|
| **Frontend** | Vanilla JS (public/) | React 19 + Vite 8 | ❌ INCOMPATIBLE |
| **Build Step** | None (served as-is) | Vite build required | ❌ INCOMPATIBLE |
| **API Architecture** | In-process (static/db/proxy) | Separate Express server | ❌ INCOMPATIBLE |
| **Deployment** | Single Vercel deployment | Vercel (client) + Render (API) | ❌ INCOMPATIBLE |
| **Database** | Mongoose 9, guarded `$inc` | Mongoose 8, transactions | ⚠️ REQUIRES_ADAPTATION |
| **Storage** | local/S3/B2 adapters | B2 (Backblaze) | ✅ REUSABLE |
| **Auth** | JWT cookies, httpOnly | JWT cookies, httpOnly | ✅ REUSABLE |
| **Payments** | Razorpay (same) | Razorpay (same) | ✅ REUSABLE |
| **Rate Limiting** | Upstash Redis | Express rate-limit | ⚠️ REQUIRES_ADAPTATION |
| **Testing** | Node.js test runner | Node.js + Playwright | ⚠️ REQUIRES_ADAPTATION |
| **CI/CD** | None | GitHub Actions (planned) | ⚠️ REQUIRES_ADAPTATION |

---

## 3. Key File-by-File Classification

| Reference File/Change | Original Purpose | Canonical Compatibility | Required Adaptation | Decision |
|----------------------|------------------|-------------------------|---------------------|----------|
| `client/` (React/Vite) | SPA frontend | ❌ INCOMPATIBLE | Cannot use | REJECT |
| `server/server.js` (Express) | API server | ⚠️ REQUIRES_ADAPTATION | Extract middleware, routes, graceful shutdown logic | ADAPT |
| `server/middleware/requestDrain.js` | In-flight request tracking | ✅ REUSABLE | Adapt to canonical server.js shutdown | ADAPT |
| `server/middleware/csrf.js` | CSRF protection | ✅ REUSABLE | Port to canonical middleware | ADAPT |
| `server/middleware/auditLog.js` | Audit logging | ✅ REUSABLE | Port to canonical | ADAPT |
| `server/middleware/rateLimiter.js` | Rate limiting | ⚠️ REQUIRES_ADAPTATION | Replace with Upstash | ADAPT |
| `server/services/inventoryService.js` | Inventory logic | ✅ REUSABLE | Already similar in canonical | VERIFY |
| `server/services/auditService.js` | Audit service | ✅ REUSABLE | Port to canonical | ADAPT |
| `server/controllers/` | Route handlers | ⚠️ REQUIRES_ADAPTATION | Adapt routes to canonical structure | ADAPT |
| `server/routes/` | Express routers | ⚠️ REQUIRES_ADAPTATION | Map to canonical route structure | ADAPT |
| `server/models/` | Mongoose models | ✅ REUSABLE | Already similar | VERIFY |
| `server/tests/` | Unit/integration tests | ✅ REUSABLE | Already exists in canonical | VERIFY |
| `server/tests/integration/graceful-shutdown.test.js` | Shutdown tests | ✅ REUSABLE | Adapt to canonical server.js | ADAPT |
| `client/playwright.config.ts` | Playwright config | ✅ REUSABLE | Adapt for canonical | ADAPT |
| `client/tests/e2e/cart.spec.ts` | SV-007 E2E test | ✅ REUSABLE | Adapt selectors for canonical HTML | ADAPT |
| `client/tests/e2e/selectors.md` | Documented selectors | ✅ REUSABLE | Create for canonical HTML | ADAPT |
| `.github/workflows/ci-cd.yml` | CI/CD pipeline | ✅ REUSABLE | Adapt for canonical (no Render) | ADAPT |
| `vercel-staging.json` | Staging Vercel config | ✅ REUSABLE | Adapt for canonical | ADAPT |
| `vercel.json` | Production Vercel | ⚠️ REQUIRES_ADAPTATION | Already exists in canonical | VERIFY |
| `server/config/render.yaml` | Render Blueprint | ❌ INCOMPATIBLE | Canonical uses Vercel only | REJECT |
| `RUNBOOK.md` | Operational procedures | ✅ REUSABLE | Adapt for canonical | ADAPT |
| `.planning/PROJECT.md` | Project definition | ✅ REUSABLE | Adapt for canonical | ADAPT |
| `.planning/REQUIREMENTS.md` | Requirements | ✅ REUSABLE | Adapt for canonical | ADAPT |
| `.planning/ROADMAP.md` | Roadmap | ✅ REUSABLE | Adapt for canonical | ADAPT |
| `.planning/STATE.md` | State tracking | ✅ REUSABLE | Reconstruct for canonical | ADAPT |
| `.planning/phases/01-4-production-readiness/01-04-PLAN.md` | Phase 1.4 plan | ✅ REUSABLE | Rewrite for canonical | REWRITE |
| `.planning/phases/01-4-production-readiness/1.4-UAT.md` | UAT tracking | ✅ REUSABLE | Create for canonical | CREATE |
| `PRODUCTION_REMEDIATION/` | Remediation docs | ✅ REUSABLE | Reference for audit | REFERENCE |
| `PRODUCTION_VALIDATION/` | Validation docs | ✅ REUSABLE | Reference for audit | REFERENCE |

---

## 4. Specific Technical Mismatches

### 4.1 Frontend Architecture
- **Reference**: React 19 + Vite 8, client-side routing, Framer Motion, CSS Modules
- **Canonical**: Vanilla ES modules in `public/assets/js/`, server-side rendering of HTML pages, no build step
- **Impact**: Cannot reuse any React components, hooks, context, or Vite config

### 4.2 API Architecture
- **Reference**: Separate Express server on Render, proxied via Vercel rewrites
- **Canonical**: Single `server.js` with in-process API (static/db/proxy modes)
- **Impact**: Reference middleware, controllers, routes must be adapted to canonical's single-server model

### 4.3 Database Transactions
- **Reference**: MongoDB transactions (requires replica set), `reserveStock`/`releaseStock`
- **Canonical**: Guarded `$inc` with compensating reversal (standalone MongoDB compatible)
- **Impact**: Reference transaction logic not directly portable; canonical approach is more portable

### 4.4 Rate Limiting
- **Reference**: `express-rate-limit` with in-memory store
- **Canonical**: Upstash Redis (`@upstash/ratelimit` + `@upstash/redis`)
- **Impact**: Cannot reuse reference rate limiter; must adapt to Upstash

### 4.5 Deployment Targets
- **Reference**: Vercel (client) + Render (API) + MongoDB Atlas
- **Canonical**: Vercel only (serverless), MongoDB Atlas
- **Impact**: Render-specific config (`render.yaml`) not usable; CI/CD must target Vercel only

### 4.6 Testing
- **Reference**: Node.js test runner + Playwright E2E
- **Canonical**: Node.js test runner only (no Playwright yet)
- **Impact**: Playwright tests need to be created for canonical HTML structure

---

## 5. Reusable Assets (High Value)

| Asset | Value | Adaptation Effort |
|-------|-------|-------------------|
| `server/middleware/requestDrain.js` | Complete in-flight tracking | Low (port to canonical shutdown) |
| `server/tests/integration/graceful-shutdown.test.js` | Comprehensive shutdown tests | Low (adapt to canonical server.js) |
| `server/services/inventoryService.js` | Atomic inventory logic | Low (verify parity) |
| `client/tests/e2e/cart.spec.ts` | SV-007 E2E test pattern | Medium (new selectors) |
| `client/tests/e2e/selectors.md` | Selector documentation pattern | Low (inspect canonical HTML) |
| `.github/workflows/ci-cd.yml` | CI/CD with staging guard | Medium (remove Render, add Vercel-only) |
| `vercel-staging.json` | Staging Vercel config | Low (adapt domain) |
| `RUNBOOK.md` | Operational procedures | Medium (adapt architecture) |
| `PRODUCTION_REMEDIATION/` | Deep audit evidence | Reference only |

---

## 6. Assets Requiring Significant Adaptation

| Asset | Adaptation Needed |
|-------|-------------------|
| `server/server.js` | Extract graceful shutdown, middleware order; integrate into canonical server.js |
| `server/middleware/csrf.js` | Port to canonical middleware system |
| `server/middleware/auditLog.js` | Port to canonical |
| `server/middleware/rateLimiter.js` | Replace with Upstash Redis implementation |
| `server/controllers/*` | Map to canonical route structure |
| `server/routes/*` | Map to canonical route structure |
| `client/playwright.config.ts` | Update baseURL, testDir for canonical |
| `client/tests/e2e/cart.spec.ts` | Rewrite selectors for canonical HTML |
| `vercel.json` | Verify canonical config matches reference patterns |

---

## 7. Assets to Reject

| Asset | Reason |
|-------|--------|
| `client/` (entire directory) | React/Vite architecture incompatible |
| `server/config/render.yaml` | Render not used in canonical |
| `vite.config.js` | Vite not used in canonical |
| `client/vite.config.js` | Vite not used in canonical |
| `package.json` (root) | Different scripts, dependencies |
| `client/package.json` | Different dependencies (React, Vite, etc.) |

---

## 8. Migration Recommendations

### Phase 1: Core Infrastructure (Week 1)
1. Port `requestDrain.js` → `src/middleware/requestDrain.js`
2. Integrate into `server.js` graceful shutdown
3. Port `graceful-shutdown.test.js` → `tests/graceful-shutdown.test.mjs`
4. Add CSRF middleware (adapt reference)
5. Add audit log middleware

### Phase 2: CI/CD & Staging (Week 2)
1. Create `.github/workflows/ci-cd.yml` from reference (Vercel-only)
2. Create `vercel-staging.json` from reference
3. Add staging environment variables

### Phase 3: Playwright E2E (Week 3)
1. Add Playwright to canonical
2. Create `playwright.config.ts` from reference
3. Inspect canonical HTML → create `selectors.md`
4. Write `cart.spec.ts` with canonical selectors

### Phase 4: Documentation (Week 4)
1. Adapt `RUNBOOK.md` for canonical architecture
2. Reconstruct `PROJECT.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md`
3. Rewrite Phase 1.4 plan for canonical architecture

---

*Report generated: 2026-11-22*  
*Audit scope: Reference repository (`AstroVetro.com`) vs Canonical (`astrovetro-root`)*