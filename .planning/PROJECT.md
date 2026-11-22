# PROJECT.md — Astrovetro Canonical (astrovetro-root)

## 1. Project Identity

| Field | Value |
|-------|-------|
| **Project Name** | Astrovetro |
| **Version** | 1.0 |
| **Codebase Path** | `~/desktop/astrovetro-production` |
| **Repository** | `git@github.com:notbeingsuraj/astrovetro-root.git` |
| **Stack** | Express 4 + Mongoose 9, Vanilla ES Modules (no build step), MongoDB |
| **Language** | JavaScript ESM (server), Vanilla JS (client, no framework) |
| **Package Manager** | npm |
| **Deployment** | Vercel (serverless) + MongoDB Atlas |

---

## 2. Architecture Overview

### High-Level Structure
```
astrovetro-root/
├── server.js                    # Entry point (dual: local server + Vercel serverless)
├── package.json                 # Root package (frontend + API in one)
├── vercel.json                  # Vercel deployment config
├── public/                      # Static HTML/CSS/JS (served as-is)
│   ├── index.html               # Gateway (Crystals | Rituals)
│   ├── home.html                # Home page
│   ├── shop.html                # Product catalogue
│   ├── cart.html                # Shopping cart
│   ├── checkout.html            # Checkout flow
│   ├── order.html               # Order detail
│   ├── tracking.html            # Order tracking
│   ├── orders.html              # Order history
│   ├── rituals.html             # Rituals index
│   ├── ritual.html              # Ritual detail
│   ├── admin.html               # Admin dashboard
│   ├── 404.html                 # Not found
│   └── assets/
│       ├── css/
│       ├── js/                  # Vanilla ES modules (no build)
│       └── img/
├── src/
│   ├── api/
│   │   ├── staticApi.js         # Static catalogue provider (no DB)
│   │   └── commerceApi.js       # Full commerce API (with DB)
│   ├── config/
│   │   └── env.js               # Centralized environment config
│   ├── controllers/             # Route handlers
│   ├── middleware/              # Express middleware
│   ├── models/                  # Mongoose models
│   ├── routes/                  # Express route definitions
│   ├── services/                # Business logic
│   ├── utils/                   # Utilities
│   ├── db/
│   │   ├── connect.js           # MongoDB connection manager
│   │   └── seed.js              # Database seeding
│   ├── utils/
│   │   └── storage.js           # Storage abstraction (local/S3/B2)
│   └── payments/
│       └── razorpay.js          # Razorpay integration
├── tests/                       # Node.js test runner tests
└── scripts/                     # Operational scripts
```

### Data Flow
```
Client (Vanilla JS) → server.js → [staticApi | commerceApi | proxy] → MongoDB
                          ↓
                    Vercel Serverless
                          ↓
                    MongoDB Atlas
```

### Key Models
| Model | Purpose |
|-------|---------|
| `Product` | Commerce items with `stock` (null = untracked), `sku`, `status` |
| `Order` | Customer orders with status tracking, inventory commitment |
| `StockMovement` | Audit trail for all stock changes |
| `StockReceipt` | Idempotent purchase order receipts |
| `PurchaseOrder` | Supplier orders with receipt tracking |
| `User` | Authentication, roles (admin/customer), lockout |
| `Cart` | Server-side cart with cookie session |
| `Wishlist` | User wishlists |
| `Address` | Shipping/billing addresses |
| `Category` | Product taxonomy (managed separately) |
| `Ritual` | Service/reading catalog |
| `Collection` | Product groupings |
| `SiteContent` | CMS content |
| `AuditLog` | Admin action audit trail |
| `Supplier` | Supplier management |
| `Shipment` | Shipment tracking |

---

## 3. Current State Assessment

### ✅ Completed (Verified)
| Feature | Evidence |
|---------|----------|
| **Core API Architecture** | Dual-mode server.js (local + serverless) |
| **Static Catalogue Mode** | Works without DATABASE_URL |
| **Database Mode** | commerceApi with Mongoose 9 |
| **Proxy Mode** | API_TARGET for external backend |
| **Health Endpoint** | `/health` with DB/storage checks |
| **Storage Abstraction** | local/S3/B2 adapters with health checks |
| **Inventory Service** | Guarded `$inc` with compensating reversal |
| **Atomic Stock Delta** | `applyStockDelta` with ledger |
| **Idempotent Receipts** | `recordReceipt` with idempotencyKey |
| **Storage Adapters** | local, S3, B2 with health checks |
| **Graceful Shutdown** | Basic (10s force exit) - NEEDS ENHANCEMENT |
| **CSP Headers** | Helmet with Razorpay allowances |
| **CORS** | Credentialed, explicit origins only |
| **Trust Proxy** | Configurable (Vercel/Cloudflare) |
| **Admin Auth** | JWT httpOnly cookies, role-based |
| **Razorpay Integration** | Keys validated at startup |

### ⚠️ Partially Implemented
| Feature | Status | Gap |
|---------|--------|-----|
| **Graceful Shutdown** | Basic only | No in-flight request drain, no forced connection close, 10s timeout |
| **Request Drain** | Missing | No in-flight counter, no wait-for-drain |
| **CSRF Protection** | Missing | No double-submit cookie |
| **Audit Logging** | Missing | No admin action audit trail |
| **Playwright E2E** | Missing | No browser tests |
| **CI/CD Pipeline** | Missing | No GitHub Actions |
| **Staging Environment** | Missing | No Vercel staging, no Atlas staging |
| **Runbook** | Missing | No operational procedures |

### ❌ Not Started
| Feature | Blocker |
|---------|---------|
| SV-001 through SV-008 verification | Staging environment |
| Phase 2 (Razorpay) | All SVs must pass in staging |

---

## 4. Testing Status

| Suite | Tests | Status |
|-------|-------|--------|
| Unit (`tests/unit/`) | ~20 | ✅ Pass (MongoDB skipped) |
| Integration (`tests/integration/`) | ~10 | ⚠️ 9 skipped (no MongoDB) |
| **Total** | **~30** | **44 pass, 9 skipped** |

| Check | Result |
|-------|--------|
| No MongoDB | 9 tests skipped (mongod not reachable) |
| Storage tests | ✅ All pass (local + mocked B2/S3) |
| Auth tests | ⚠️ Skipped (no MongoDB) |
| Commerce tests | ⚠️ Skipped (no MongoDB) |

---

## 5. Key Constraints & Decisions

| Decision | Rationale |
|----------|-----------|
| **Single server.js for all modes** | Simplifies deployment, avoids CORS, single deploy target |
| **Dual API mode (static/db/proxy)** | Zero-config dev, graceful degradation, future migration path |
| **Guarded `$inc` over transactions** | Works on standalone MongoDB; transactions need replica set |
| **`stock: null` = untracked** | Allows "made to order" items; never blocks checkout |
| **`toPublic()` / `toAdmin()` serializers** | Single source of truth; no operational data leakage |
| **Storage adapter pattern** | Swap B2/S3/local without code changes |
| **`API_TARGET` proxy** | Future backend migration path |
| **`AV_DISABLE_API`** | Resilience testing affordance |
| **No build step** | `public/` served as-is; vanilla ES modules |
| **Vercel serverless primary** | No persistent HTTP server in production |

---

## 6. Phase 1.4: Production Readiness (Current Focus)

**Goal**: All 8 staging verifications PASS in real Vercel + MongoDB Atlas environment. CI/CD operational. E2E tests implemented. Graceful shutdown drain implemented. RUNBOOK.md published.

### Workstreams (Adapted for Canonical Architecture)

```
WS-1: Infrastructure Provisioning
    → Vercel staging project
    → MongoDB Atlas staging cluster (replica set for transactions)
    → DNS: staging.astrovetro.com → Vercel
    
WS-2: Staging Deployment & Config
    → vercel-staging.json with rewrites
    → Deploy to Vercel staging
    → Verify health endpoints
    
WS-3: CI/CD Pipeline
    → GitHub Actions: test → lint → build → deploy-staging → smoke → e2e
    → Pre-deploy guard: VERCEL_PROJECT_ID == "staging-project-id"
    → Client+server deploy same commit SHA
    
WS-4: Playwright E2E Implementation
    → Install Playwright
    → Create playwright.config.ts
    → Inspect canonical HTML → document selectors
    → Implement cart.spec.ts for SV-007
    
WS-5: Graceful Shutdown Drain (Canonical Architecture)
    → requestDrain middleware with per-request finalized guard
    → CORRECT ORDER: startDrain() → server.close() → waitForDrain() → closeAllConnections() → await MongoDB
    → Integration tests with real ChildProcess
    
WS-6: Staging Verification Execution (8 SVs)
    → SV-001: Proxy cookie behavior (same-origin /api)
    → SV-002: Browser CSP enforcement
    → SV-003: 100 parallel orders (Atlas replica set)
    → SV-004: 15-min lock expiry
    → SV-005: Admin unlock endpoint
    → SV-006: SIGTERM drain drill (correct order + force-close)
    → SV-007: E2E cart-clear flow (Playwright)
    → SV-008: CSRF origin allowlist
    
WS-7: Documentation
    → RUNBOOK.md (deploy, rollback, failure handling, SV re-run)
    → M2 completion sign-off
```

**Critical Difference from Reference**: Canonical uses **Vercel-only deployment** (no Render). Staging is Vercel staging project + Atlas staging cluster. CI/CD deploys to Vercel staging only.

---

## 7. Phase 2 Readiness Gate

**Phase 2 (Razorpay Payment Integration) is NOT AUTHORIZED** until:
1. ✅ All 8 staging verifications code-ready
2. ⏳ Vercel staging project deployed
3. ⏳ MongoDB Atlas staging replica set connected
4. ⏳ All 8 SVs PASS in staging environment
5. ⏳ CI/CD pipeline operational in staging
6. ⏳ Admin unlock verified in staging

---

## 8. Team & Context

| Role | Notes |
|------|-------|
| **Owner/Dev** | Solo developer (Suraj) |
| **Prior Work** | Core platform complete; now adopting GSD for Phase 1.4 |
| **Methodology** | GSD workflow adopted Nov 2026 |
| **Next Milestone** | Production readiness (staging + CI/CD + E2E) |

---

## 9. GSD Configuration

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

*Canonical PROJECT.md — adapted from reference AstroVetro.com for astrovetro-root architecture*
*Last updated: 2026-11-22*