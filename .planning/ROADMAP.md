# ROADMAP.md — Astrovetro Canonical (astrovetro-root)

## Roadmap Overview

| Milestone | Phase | Focus | Status | Target |
|-----------|-------|-------|--------|--------|
| **M0** | — | GSD Initialization | ✅ Complete | Nov 22 |
| **M1** | 1.1–1.3 | Core Platform + Inventory | ✅ Complete | Nov 21 |
| **M2** | 1.4 | **Production Readiness** | 🟡 Active | **Dec 11 (target)** |
| **M3** | 2.0 | **Payment Integration (Razorpay)** | 🔒 Blocked | **TBD after M2** |
| **M4** | 3.0 | Email & Notifications | 📋 Planned | TBD |
| **M5** | 4.0 | Advanced Commerce | 📋 Planned | TBD |

> **Note:** December 11 is a target, not a guaranteed deadline. Re-estimate after detailed phase planning based on actual workload.

---

## Phase 1.4: Production Readiness (Current Focus)

**Goal**: All 8 staging verifications PASS in real Vercel + MongoDB Atlas environment. CI/CD operational. E2E tests implemented. Serverless timeout model implemented. RUNBOOK.md published.

### Canonical Architecture Workstreams (Sequential with Dependencies)

```
WS-1: Infrastructure Provisioning (Days 1-3)
    → WS-2: Staging Deployment & Config (Days 4-5)
        → WS-3: CI/CD Pipeline (Days 6-8)
            → WS-4: E2E Test Implementation (Days 9-12)
            → WS-5: Serverless Timeout Model (Days 9-12)  [PARALLEL with WS-4]
                → WS-6: Staging Verification Execution (Days 13-15)
                    → WS-7: Documentation (Days 16-17)
```

| Workstream | Scope | Depends On | Est. Days |
|------------|-------|------------|-----------|
| **WS-1: Infra** | Vercel staging project, MongoDB Atlas M0, Upstash Redis, DNS | — | 3 |
| **WS-2: Deploy** | vercel-staging.json, deploy to Vercel staging, verify health | WS-1 | 2 |
| **WS-3: CI/CD** | GitHub Actions: test → lint → build → deploy-staging → smoke-tests → e2e | WS-2 | 3 |
| **WS-4: E2E** | Playwright install, config, SV-007 cart-clear test with real selectors | WS-2 | 4 |
| **WS-5: Timeout** | Serverless timeout model (10s), request drain, CSRF, audit log | WS-1 | 4 |
| **WS-6: Verify** | Execute all 8 SVs in staging → all PASS | WS-2, WS-4, WS-5 | 3 |
| **WS-7: Docs** | RUNBOOK.md, rollback procedures, M2 sign-off | WS-6 | 2 |

**Total Estimate: ~17 working days (target Dec 11, re-estimate after planning)**

### Exit Criteria for M2
- [ ] Vercel staging project deployed
- [ ] MongoDB Atlas M0 standalone connected with IP allowlist
- [ ] Upstash Redis staging connected
- [ ] CI/CD pipeline: 100% pass on main branch
- [ ] Playwright E2E: tests pass in CI against deployed staging
- [ ] Serverless timeout model: 10s function timeout, drain tracking, cold start handling
- [ ] All 8 SVs: **PASS** in staging
- [ ] RUNBOOK.md published

---

## Phase 2.0: Payment Integration (Razorpay)

**Blocked until M2 complete — ALL exit criteria must be satisfied**

### Timeline: TBD after M2 complete

| Workstream | Scope | Depends On |
|------------|-------|------------|
| **WS-1: Integration** | Razorpay test account, payment intent, webhook, client checkout | M2 complete |
| **WS-2: Flows** | COD, payment failure → stock release, refund | WS-1 |
| **WS-3: Tests** | Unit + integration + webhook tests | WS-2 |
| **WS-4: Verify** | Staging E2E payment flow | WS-3 |

### Dependencies (ALL must be satisfied)
- [ ] M2 complete (all exit criteria)
- [ ] Razorpay test account approved
- [ ] CI/CD operational in staging
- [ ] Admin unlock verified in staging
- [ ] Webhook URL available (staging)

---

## Phase 3.0: Email & Notifications

**Timeline: TBD after M3**

| Feature | Description |
|---------|-------------|
| Transactional emails | Order confirmation, booking confirmation, password reset |
| Newsletter delivery | Weekly digest via provider (Resend/SendGrid) |
| Admin notifications | New order, booking, contact form |
| Email templates | Branded, responsive, accessible |

---

## Phase 4.0: Advanced Commerce

**Timeline: TBD after M3**

| Feature | Description |
|---------|-------------|
| Guest checkout | Remove auth requirement for checkout |
| Shipping tracking | Integration with carrier APIs |
| Discount codes | Percentage/fixed, usage limits, expiry |
| Wishlist | Save for later, shareable |
| Reviews | Customer product reviews + moderation |
| Loyalty points | Earn on purchase, redeem on future |

---

## Dependency Graph

```
M0: GSD Init
    ↓
M1: Core Platform (DONE)
    ↓
M2: Production Readiness (ACTIVE)
    ├── WS-1: Infra (Vercel + Atlas M0 + Upstash + DNS)
    ├── WS-2: Deploy + Config
    ├── WS-3: CI/CD (GitHub Actions)
    ├── WS-4: E2E (Playwright)
    ├── WS-5: Serverless Timeout Model
    ├── WS-6: 8 SVs PASS
    └── WS-7: RUNBOOK.md
    ↓
M3: Payments (BLOCKED until M2 100%)
    ├── Razorpay integration
    ├── Webhooks + E2E
    ↓
M4: Email (AFTER M3)
    ↓
M5: Advanced Commerce (AFTER M3)
```

---

## Risk & Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Staging provisioning delays | Blocks all downstream | Start infra Day 1; parallelize DNS/config |
| Razorpay account approval | Blocks M3 | Apply early; use test mode in parallel |
| Playwright flakiness | Delays SV-007 | Use stable selectors; retry logic |
| Atlas costs | Budget | Use M0 for staging; destroy after verification |
| CI/CD pipeline failures | Blocks all | Incremental pipeline; test locally first |
| Serverless timeout complexity | Delays SV-006 | Design within 10s budget; test locally |
| Vercel 10s timeout vs drain | Critical | Design for 10s; 8s drain budget |
| Vercel Project ID resolution | High | Capture actual ID from dashboard |

---

## Resource Allocation (Solo Developer)

| Workstream | Focus | Notes |
|------------|-------|-------|
| WS-1: Infra | DevOps | Vercel dashboard, Atlas dashboard, DNS provider |
| WS-2: Deploy | DevOps | Vercel CLI, vercel-staging.json |
| WS-3: CI/CD | DevOps | GitHub Actions YAML, Vercel token |
| WS-4: E2E | QA + Frontend | Playwright, inspect canonical HTML |
| WS-5: Timeout | Backend | Middleware + integration tests |
| WS-6: Verify | QA + DevOps | Staging URLs, Atlas metrics |
| WS-7: Docs | DevOps | Markdown, operational knowledge |

---

## Milestone Tracking

| Milestone | Start | Target End | Actual End | Status |
|-----------|-------|------------|------------|--------|
| M0: GSD Init | Nov 22 | Nov 22 | Nov 22 | ✅ |
| M1: Core Platform | — | Nov 21 | Nov 21 | ✅ |
| M2: Prod Readiness | Nov 22 | Dec 11 (target) | — | 🟡 Active |
| M3: Payments | TBD | TBD | — | 🔒 Blocked |
| M4: Email | TBD | TBD | — | 📋 Planned |
| M5: Adv Commerce | TBD | TBD | — | 📋 Planned |

---

## Notes

- **Phase 1.3** (Inventory Integrity) completed Nov 21 with full UAT evidence (44 pass, 9 skipped)
- **Phase 2** explicitly blocked until staging verifications complete
- **No greenfield assumptions** — all planning based on actual repo state
- **Safety gates**: No deploy/migration without explicit approval
- **December 11 is a target, not a guarantee** — re-estimate after detailed phase planning
- **Canonical architecture**: Single Vercel deployment (no Render), serverless-first

---

*Canonical ROADMAP.md — adapted from reference for astrovetro-root architecture*
*Last updated: 2026-11-22*