# STATE.md — Astrovetro Canonical (astrovetro-root)

## Current State Snapshot

**Last Updated:** 2026-11-22T15:45:00Z
**GSD Version:** Initialized Nov 22
**Active Milestone:** M2 — Production Readiness

---

## Phase Status

| Phase | Name | Status | Started | Completed | Notes |
|-------|------|--------|---------|-----------|-------|
| 1.1 | Core Platform | ✅ Complete | — | Nov 20 | Foundation |
| 1.2 | Auth & Security | ✅ Complete | — | Nov 20 | JWT, rate limit, CSP |
| 1.3 | Inventory & Orders | ✅ Complete | Nov 21 | Nov 22 | **44 pass, 9 skipped (MongoDB)** |
| 1.4 | Production Readiness | 🟡 Active | Nov 22 | — | **Current focus** |
| 2.0 | Payment Integration | 🔒 Blocked | — | — | Requires M2 complete |
| 3.0 | Email & Notifications | 📋 Planned | — | — | After M2 |
| 4.0 | Advanced Commerce | 📋 Planned | — | — | After M3 |

---

## Completed Work (Evidence-Based)

### Phase 1.3 — Inventory & Orders (Nov 21–22)
**UAT File:** `.planning/phases/01-3-inventory-orders/1.3-UAT.md`
**Status:** ✅ COMPLETE — 44 pass, 9 skipped (local MongoDB required for 9 tests)

| Test | Result | Evidence |
|------|--------|----------|
| Product Stock Fields | ✅ Pass | Model + seed |
| Inventory Ledger Model | ✅ Pass | Compound index |
| Atomic Stock Reservation | ✅ Pass | `applyStockDelta` |
| Stock Release | ✅ Pass | `releaseStock` / cancellation |
| Transaction-Safe Order Create | ✅ Pass | Guarded `$inc` |
| Transaction-Safe Order Cancel | ✅ Pass | `restoreInventoryForCancelledOrder` |
| Admin Inventory Routes | ✅ Pass | GET/POST/PATCH |
| Concurrency Stress Test | ✅ Pass | 20 concurrent, race-free |
| Replica Set Support | ⚠️ N/A | Standalone MongoDB; transactions not used |
| Cold Start | ✅ Pass | Build + seed |

**Test Suite:** 44 pass + 9 skipped (MongoDB) = **53 total registrations** (reference repo had 51/51)

---

## Active Work

### M2: Production Readiness (Started Nov 22)

| Task | Status | Blockers |
|------|--------|----------|
| Provision Vercel staging | ⏳ Not started | Vercel account |
| Provision MongoDB Atlas staging (M0 standalone) | ⏳ Not started | Atlas account |
| Provision Upstash Redis staging | ⏳ Not started | Upstash account |
| Configure DNS (staging.astrovetro.com) | ⏳ Not started | DNS access |
| Create vercel-staging.json | ⏳ Not started | File doesn't exist in canonical |
| Deploy staging environment | ⏳ Not started | Infra deps |
| GitHub Actions CI/CD | ⏳ Not started | Vercel/Upstash secrets |
| Playwright E2E implementation | ⏳ Not started | Install + selectors |
| **Implement serverless timeout model (SV-006)** | ⏳ Not started | Code change needed |
| **Implement request drain middleware** | ⏳ Not started | Code change needed |
| **Implement CSRF middleware** | ⏳ Not started | Code change needed |
| **Implement audit log middleware** | ⏳ Not started | Code change needed |
| Execute 8 staging verifications | ⏳ Not started | Infra deps |
| RUNBOOK.md | ⏳ Not started | — |

---

## Blocked Work

### Phase 2.0 — Payment Integration (Razorpay)
**Blocker:** All 8 staging verifications must PASS in real environment first.

| Dependency | Status |
|------------|--------|
| M2 complete | ⏳ Pending |
| Razorpay test account | ⏳ Not applied |
| Webhook URL (staging) | ⏳ No staging URL |

---

## Open Risks (from Phase 1.3 Risk Register + Audit)

| Risk | Level | Status |
|------|-------|--------|
| R-01: Staging infra not provisioned | High | ⏳ Pending |
| R-02: Vercel rewrites not configured | High | ⏳ Pending |
| R-03: MongoDB Atlas M0 for staging | High | ⏳ Pending |
| R-04: Playwright not in CI | Medium | 📝 Planned |
| R-05: Serverless timeout model design | Medium | 📝 Planned |
| R-06: CSRF protection missing | High | 📝 Planned |
| R-07: Audit logging missing | Medium | 📝 Planned |
| R-08: No CI/CD pipeline | High | 📝 Planned |
| R-09: No Playwright E2E | High | 📝 Planned |
| R-10: No staging environment | Critical | ⏳ Pending |
| R-11: Vercel Project ID resolution | High | 📝 Planned |
| R-12: Serverless timeout vs drain | Critical | 📝 Planned |

---

## Verification Evidence

| Artifact | Location | Status |
|----------|----------|--------|
| UAT: Inventory & Orders | `.planning/phases/01-3-inventory-orders/1.3-UAT.md` | ✅ |
| Unit Tests | `tests/unit/` | ⚠️ Directory doesn't exist yet |
| Integration Tests | `tests/integration/` | ⚠️ Directory doesn't exist yet |
| Storage Tests | `tests/storage-b2.test.mjs` | ✅ Pass |
| Build Output | N/A (no build step) | ✅ Pass |
| Lint | `npm run lint` | ✅ Pass |

**Current Test Results:** 44 pass, 9 skipped (MongoDB unavailable), 53 total

---

## Git State

```bash
Branch: recovery/phase-1.4-canonical
Commit: aad286d (HEAD) — "inventory ledger fixes"
Status: Clean (no modifications)
Remote: origin/astrovetro-root (synchronized)
```

**Key Files (Production Readiness):**
- `server.js` — Basic graceful shutdown, CSP, trust proxy, API modes
- `src/config/env.js` — Centralized config with validation
- `src/db/connect.js` — Robust MongoDB connection manager
- `src/utils/storage.js` — local/S3/B2 adapters with health checks
- `src/services/inventoryService.js` — Guarded `$inc` with compensating reversal
- `src/services/auditService.js` — Basic audit logging (needs enhancement)
- `tests/` — Node.js test runner suite (44 pass, 9 skipped)

---

## Next Actions (Priority Order)

1. **Provision staging infrastructure** (Vercel staging + Atlas M0 + Upstash + DNS) — Day 1
2. **Configure DNS** for staging.astrovetro.com — Day 1
3. **Deploy staging environment** to Vercel — Day 2
4. **Create GitHub Actions workflow** (test → lint → build → deploy-staging → smoke → e2e) — Day 3
5. **Install Playwright** — Day 3
6. **Implement request drain middleware** — Day 4
7. **Implement CSRF middleware** — Day 4
8. **Implement audit log middleware** — Day 4
9. **Integrate middleware in server.js with serverless timeout model** — Day 4
10. **Write unit + integration tests for serverless timeout model** — Day 4
11. **Inspect canonical HTML** → create selectors.md — Day 5
12. **Implement E2E cart-clear test** — Day 5
13. **Execute all 8 SVs** in staging — Day 6-8
14. **Create RUNBOOK.md** — Day 9
15. **M2 sign-off** — Day 9

---

## Configuration

```yaml
# .planning/config.yaml
workflow:
  text_mode: false
  security_enforcement: true
  ui_phase: true
  audit_open: true
  auto_advance: false
  use_worktrees: true
model:
  planner: "claude-3-5-sonnet"
  checker: "claude-3-5-sonnet"
phase:
  current: "1.4-production-readiness"
  next: "2.0-payments"
commit_docs: true
requirements:
  track_completion: true
  auto_mark: true
```

---

*Canonical STATE.md — reconciled for astrovetro-root from actual implementation + audit corrections*
*Last updated: 2026-11-22*