# Astrovetro Phase 1.4 Recovery — Complete Summary

## Overview
Successfully recovered and adapted the GSD planning system from the reference repository (`AstroVetro.com` — React/Vite + Express on Render) to the canonical repository (`astrovetro-root` — single Vercel deployment with vanilla JS frontend).

## Phases Completed

### ✅ Phase 0: Environment Discovery & Safety Baseline
- **Canonical workspace confirmed**: `~/desktop/astrovetro-production` (branch `recovery/phase-1.4-canonical` at `aad286d`)
- **Reference workspace inspected**: `~/Desktop/Important-backups/astrovetro` (branch `phase-1.4-production-readiness` at `2bcc139`)
- **Recovery backup created**: `~/Desktop/astrovetro-recovery/astrovetro-backup.tar.gz` (4.6MB)
- **Recovery branch created**: `recovery/phase-1.4-canonical` from clean `main`
- **Baseline report**: `RECOVERY_BASELINE.md`

### ✅ Phase 1: Canonical Architecture Audit
**Output**: `.planning/recovery/CANONICAL-ARCHITECTURE-AUDIT.md`

**Key Findings**:
- **Architecture**: Single `server.js` (dual-mode: local server + Vercel serverless) with in-process API (static/db/proxy modes)
- **Frontend**: Vanilla ES modules in `public/` — no build step, no React/Vite
- **Database**: Mongoose 9, guarded `$inc` for inventory (no transactions)
- **Storage**: local/S3/B2 adapters with health checks
- **Deployment**: Vercel serverless only (no Render)
- **Testing**: Node.js test runner, 44 pass / 9 skipped (no MongoDB)
- **Critical Gap**: No request drain, no CSRF, no audit log, no Playwright, no CI/CD, no staging

### ✅ Phase 2: Reference Implementation Audit
**Outputs**: 
- `.planning/recovery/REFERENCE-WORKSPACE-AUDIT.md`
- `.planning/recovery/MIGRATION-MATRIX.md`

**Key Decisions**:
| Asset | Decision | Reason |
|-------|----------|--------|
| `client/` (React/Vite) | **REJECT** | Fundamentally incompatible architecture |
| `server/middleware/requestDrain.js` | **ADAPT** | Core logic reusable; port to canonical |
| `server/tests/integration/graceful-shutdown.test.js` | **ADAPT** | Comprehensive tests; adapt to canonical server.js |
| `server/services/inventoryService.js` | **VERIFY** | Already similar in canonical |
| `.github/workflows/ci-cd.yml` | **ADAPT** | Remove Render steps; Vercel-only |
| `client/playwright.config.ts` | **ADAPT** | Adapt for canonical HTML |
| `client/tests/e2e/cart.spec.ts` | **ADAPT** | New selectors for canonical HTML |
| `server/config/render.yaml` | **REJECT** | Canonical uses Vercel only |

### ✅ Phase 3: GSD Recovery in Canonical Repository
**Created in canonical repo** (`~/desktop/astrovetro-production/.planning/`):

| File | Purpose |
|------|---------|
| `config.yaml` | GSD configuration |
| `PROJECT.md` | Project identity & architecture (canonical) |
| `REQUIREMENTS.md` | Functional & non-functional requirements (canonical) |
| `ROADMAP.md` | Milestones & workstreams (canonical) |
| `STATE.md` | Current state & next actions (canonical) |
| `.planning/phases/01-4-production-readiness/01-04-PLAN.md` | **Complete Phase 1.4 plan** (rewritten for canonical) |
| `.planning/phases/01-4-production-readiness/1.4-UAT.md` | UAT tracking for Phase 1.4 |

### ✅ Phase 4: Phase 1.4 Plan Rewrite for Canonical Architecture
**Output**: `.planning/phases/01-4-production-readiness/01-04-PLAN.md` (99KB)

**Key Adaptations for Canonical Architecture**:

1. **Vercel-only deployment** (no Render)
2. **Same-origin `/api`** via in-process database mode
3. **Graceful shutdown corrected**: 
   - Exactly-once finalization via per-request guard
   - **CORRECT ORDER**: `startDrain()` → `server.close()` → `waitForDrain()` → `closeAllConnections()` → MongoDB shutdown
   - 10s Vercel timeout constraint documented
4. **CI/CD pipeline**: `test → lint → build → deploy-staging → smoke-tests → e2e`
   - Pre-deploy guard: `VERCEL_PROJECT_ID == "astrovetro-staging"`
   - Same `${{ github.sha }}` for client+server
5. **Playwright E2E**: 
   - Inspection phase required (`selectors.md`)
   - Test data cleanup in `beforeEach`/`afterEach`
   - SV-007 `NOT_STARTED` until CI passes
6. **Vercel 10s timeout vs 30s drain**: Documented as unresolved decision
6. **Atlas IP allowlist ONLY** (NO 0.0.0.0/0)

### 🔄 Phase 5: Implementation & Defect Correction (Pending)
**Next Steps** (require external credentials):
1. Provision Vercel staging project + MongoDB Atlas M10+ replica set
2. Configure DNS (`staging.astrovetro.com`)
3. Deploy to Vercel staging with `vercel-staging.json`
4. Configure GitHub secrets + test CI/CD pipeline
5. Install Playwright, inspect canonical HTML, create `selectors.md`
6. Implement `requestDrain.js`, `csrf.js`, `auditLog.js` middleware
6. Integrate into `server.js` with CORRECT shutdown order
7. Write unit + integration tests for shutdown
8. Execute all 8 SVs in staging
9. Create `RUNBOOK.md`, sign off M2

### 📋 Phase 6-8: Verification, GSD Validation, Final Audit (Pending)

---

## Key Artifacts Created

### Canonical Repository (`~/desktop/astrovetro-production/`)
```
.planning/
├── config.yaml                    # GSD config
├── PROJECT.md                     # Project identity (canonical)
├── REQUIREMENTS.md                # Requirements (canonical)
├── ROADMAP.md                     # Milestones (canonical)
├── STATE.md                       # Current state (canonical)
├── RECOVERY_BASELINE.md           # Phase 0 baseline
├── recovery/
│   ├── CANONICAL-ARCHITECTURE-AUDIT.md
│   ├── REFERENCE-WORKSPACE-AUDIT.md
│   └── MIGRATION-MATRIX.md
└── phases/01-4-production-readiness/
    ├── 01-04-PLAN.md              # Complete Phase 1.4 plan (99KB)
    └── 1.4-UAT.md                 # UAT tracking
```

### Reference Repository Backup
```
~/Desktop/astrovetro-recovery/
├── astrovetro-backup.tar.gz       # Full reference repo backup (4.6MB)
└── astrovetro/                    # Extracted reference repo
```

---

## Critical Unresolved Decisions (Require Approval)

1. **Vercel 10s timeout vs 30s drain**: Set `DRAIN_TIMEOUT_MS=8000`, `SHUTDOWN_DEADLINE_MS=9500`?
2. **Atlas Tier**: M10 ($57/mo) vs M20 ($114/mo) — recommend M10, destroy after
3. **Vercel Plan**: Hobby (free) vs Pro ($20/mo) — recommend Hobby
4. **Atlas IP Allowlist**: Vercel static IPs vs VPC peering — need to verify Vercel IPs
5. **Razorpay Timing**: Apply NOW in parallel (3-7 day approval) vs After M2

---

## Safety Constraints Verified

- ✅ No deployment actions in planning
- ✅ No production migrations
- ✅ No commits or pushes to remote
- ✅ No production infrastructure modifications
- ✅ No implementation started
- ✅ Phase 1.3 evidence preserved (51/51 tests)
- ✅ Phase 2.0 Razorpay blocked until all M2 criteria satisfied
- ✅ All 8 SV statuses `NOT_STARTED` until real staging evidence

---

## Next Executable Task

**WS-1 Task 1: Provision Vercel staging project**
- Requires: Vercel account, DNS access for `staging.astrovetro.com`
- Creates: Vercel project `astrovetro-staging`, custom domain, `vercel-staging.json`
- **Blocking**: All subsequent tasks depend on this infrastructure

---

## Commands to Resume Work

```bash
# Switch to canonical recovery branch
cd ~/desktop/astrovetro-production
git checkout recovery/phase-1.4-canonical

# View current state
cat .planning/STATE.md

# View Phase 1.4 plan
cat .planning/phases/01-4-production-readiness/01-04-PLAN.md

# Run tests (when MongoDB available)
npm test
```

---

*Recovery completed: 2026-11-22*  
*Canonical repository: `astrovetro-root` (branch `recovery/phase-1.4-canonical`)*  
*Reference repository preserved: `AstroVetro.com` (branch `phase-1.4-production-readiness`)*  
*Backup location: `~/Desktop/astrovetro-recovery/astrovetro-backup.tar.gz`*