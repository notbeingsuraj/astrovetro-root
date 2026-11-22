# Migration Matrix — Reference to Canonical

| Reference Change | Original Purpose | Canonical Compatibility | Required Adaptation | Decision |
|------------------|------------------|-------------------------|---------------------|----------|
| **client/ (React 19 + Vite 8)** | SPA frontend with client-side routing | ❌ INCOMPATIBLE | Cannot use - fundamentally different architecture | **REJECT** |
| **server/server.js (Express API)** | Standalone API server on Render | ⚠️ REQUIRES_ADAPTATION | Extract graceful shutdown, middleware, route structure; integrate into canonical server.js | **ADAPT** |
| **server/middleware/requestDrain.js** | In-flight request tracking + drain | ✅ REUSABLE | Port to `src/middleware/requestDrain.js`; integrate into canonical shutdown | **ADAPT** |
| **server/middleware/csrf.js** | CSRF double-submit cookie protection | ✅ REUSABLE | Port to `src/middleware/csrf.js`; adapt to canonical middleware chain | **ADAPT** |
| **server/middleware/auditLog.js** | Admin action audit logging | ✅ REUSABLE | Port to `src/middleware/auditLog.js` | **ADAPT** |
| **server/middleware/rateLimiter.js** | Express-rate-limit with memory store | ⚠️ REQUIRES_ADAPTATION | Replace with Upstash Redis (`@upstash/ratelimit`) | **ADAPT** |
| **server/services/inventoryService.js** | Atomic inventory with ledger | ✅ REUSABLE | Verify parity with canonical `src/services/inventoryService.js` | **VERIFY** |
| **server/services/auditService.js** | Audit trail service | ✅ REUSABLE | Port to `src/services/auditService.js` | **ADAPT** |
| **server/controllers/*** | Route handlers | ⚠️ REQUIRES_ADAPTATION | Map to canonical `src/controllers/*` structure | **ADAPT** |
| **server/routes/*** | Express routers | ⚠️ REQUIRES_ADAPTATION | Map to canonical `src/routes/*` structure | **ADAPT** |
| **server/models/*** | Mongoose models | ✅ REUSABLE | Verify parity with canonical `src/models/*` | **VERIFY** |
| **server/tests/unit/*** | Unit tests (43 tests) | ✅ REUSABLE | Verify parity with canonical `tests/unit/` | **VERIFY** |
| **server/tests/integration/*** | Integration tests (4 tests) | ✅ REUSABLE | Verify parity with canonical `tests/integration/` | **VERIFY** |
| **server/tests/integration/graceful-shutdown.test.js** | Shutdown behavior tests | ✅ REUSABLE | Adapt to canonical `server.js` shutdown lifecycle | **ADAPT** |
| **client/playwright.config.ts** | Playwright configuration | ✅ REUSABLE | Adapt for canonical HTML structure | **ADAPT** |
| **client/tests/e2e/cart.spec.ts** | SV-007 E2E test | ✅ REUSABLE | Rewrite selectors for canonical HTML | **ADAPT** |
| **client/tests/e2e/selectors.md** | Selector documentation | ✅ REUSABLE | Create for canonical HTML | **CREATE** |
| **.github/workflows/ci-cd.yml** | CI/CD pipeline | ✅ REUSABLE | Remove Render steps; Vercel-only deploy; add staging guard | **ADAPT** |
| **vercel-staging.json** | Staging Vercel config | ✅ REUSABLE | Adapt domain for canonical | **ADAPT** |
| **vercel.json** | Production Vercel config | ⚠️ REQUIRES_ADAPTATION | Already exists; verify matches reference patterns | **VERIFY** |
| **server/config/render.yaml** | Render Blueprint | ❌ INCOMPATIBLE | Canonical uses Vercel only | **REJECT** |
| **RUNBOOK.md** | Operational procedures | ✅ REUSABLE | Adapt for canonical architecture | **ADAPT** |
| **.planning/PROJECT.md** | Project definition | ✅ REUSABLE | Adapt for canonical architecture | **ADAPT** |
| **.planning/REQUIREMENTS.md** | Requirements | ✅ REUSABLE | Adapt for canonical | **ADAPT** |
| **.planning/ROADMAP.md** | Roadmap | ✅ REUSABLE | Adapt for canonical | **ADAPT** |
| **.planning/STATE.md** | State tracking | ✅ REUSABLE | Reconstruct for canonical | **RECONSTRUCT** |
| **.planning/phases/01-4-production-readiness/01-04-PLAN.md** | Phase 1.4 plan | ✅ REUSABLE | Rewrite for canonical architecture | **REWRITE** |
| **.planning/phases/01-4-production-readiness/1.4-UAT.md** | UAT tracking | ✅ REUSABLE | Create for canonical | **CREATE** |
| **PRODUCTION_REMEDIATION/** | Remediation documentation | ✅ REUSABLE | Reference for audit evidence | **REFERENCE** |
| **PRODUCTION_VALIDATION/** | Validation reports | ✅ REUSABLE | Reference for audit evidence | **REFERENCE** |
| **client/ (React/Vite app)** | Entire React frontend | ❌ INCOMPATIBLE | Fundamentally different architecture | **REJECT** |
| **vite.config.js / client/vite.config.js** | Vite build config | ❌ INCOMPATIBLE | Canonical has no build step | **REJECT** |
| **client/package.json** | React dependencies | ❌ INCOMPATIBLE | Different dependencies | **REJECT** |
| **package.json (root)** | Root scripts & deps | ⚠️ REQUIRES_ADAPTATION | Different scripts, deps; adapt needed | **ADAPT** |

---

## Decision Legend

| Decision | Meaning |
|----------|---------|
| **REUSABLE** | Can be used with minimal/no changes |
| **ADAPT** | Core logic reusable but needs structural adaptation |
| **VERIFY** | Exists in canonical; verify parity before assuming |
| **RECONSTRUCT** | Must be rebuilt from scratch for canonical |
| **REWRITE** | Core concept reusable but implementation must be rewritten |
| **CREATE** | Does not exist in reference; must be created for canonical |
| **REFERENCE** | For audit/evidence only; not for implementation |
| **REJECT** | Fundamentally incompatible; do not use |

---

## Migration Priority

### Phase 1 (Critical - Infrastructure)
1. `requestDrain.js` → `src/middleware/requestDrain.js` (ADAPT)
2. Integrate into `server.js` shutdown lifecycle (ADAPT)
3. `graceful-shutdown.test.js` → `tests/graceful-shutdown.test.mjs` (ADAPT)
4. CSRF middleware (ADAPT)
6. Audit log middleware (ADAPT)

### Phase 2 (CI/CD & Staging)
1. `.github/workflows/ci-cd.yml` (ADAPT - remove Render)
2. `vercel-staging.json` (ADAPT)
3. Staging environment variables

### Phase 3 (Playwright E2E)
1. Add Playwright to canonical
2. `playwright.config.ts` (ADAPT)
3. `selectors.md` (CREATE - inspect canonical HTML)
4. `cart.spec.ts` (ADAPT - new selectors)

### Phase 4 (Documentation & Planning)
1. `RUNBOOK.md` (ADAPT)
2. `PROJECT.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md` (ADAPT/RECONSTRUCT)
4. Phase 1.4 plan (REWRITE)
5. UAT file (CREATE)

---

*Generated: 2026-11-22*  
*Based on: Reference `AstroVetro.com` (branch `phase-1.4-production-readiness`) vs Canonical `astrovetro-root` (branch `recovery/phase-1.4-canonical`)*