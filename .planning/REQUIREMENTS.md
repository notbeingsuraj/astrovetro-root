# REQUIREMENTS.md — Astrovetro Canonical

## 1. Product Vision

**Astrovetro** is a crystal and ritual e-commerce platform with a focus on editorial design, secure commerce, and operational reliability. Built as a single Express + vanilla JS application deployed to Vercel with MongoDB Atlas.

**Target Users:**
- Customers purchasing crystals, jewellery, ritual items
- Customers booking ritual/reading services
- Content readers (journal, rituals)
- Admins managing inventory, orders, users, content

---

## 2. Functional Requirements (Current State)

### FR-01: Core Platform
| ID | Requirement | Status |
|-----|-------------|--------|
| FR-01.1 | Static catalogue served without database | ✅ |
| FR-01.2 | Database mode with full commerce | ✅ |
| FR-01.3 | Proxy mode for external backend | ✅ |
| FR-01.4 | Health endpoint with DB/storage checks | ✅ |
| FR-01.5 | Storage abstraction (local/S3/B2) | ✅ |

### FR-02: Authentication & Authorization
| ID | Requirement | Status |
|-----|-------------|--------|
| FR-02.1 | JWT auth via httpOnly Secure cookie | ✅ |
| FR-02.2 | Role-based access (admin/customer) | ✅ |
| FR-02.3 | Account lockout after failed logins | ✅ |
| FR-02.4 | Admin manual unlock endpoint | ✅ |
| FR-02.5 | **CSRF protection (double-submit)** | ❌ **MISSING** |
| FR-02.6 | Audit logging for admin actions | ❌ **MISSING** |

### FR-03: Product Catalogue
| ID | Requirement | Status |
|-----|-------------|--------|
| FR-03.1 | Product CRUD (admin) | ✅ |
| FR-03.2 | Category/collection filtering | ✅ |
| FR-03.3 | Product detail with images | ✅ |
| FR-03.4 | Stock tracking (`stock`, `unlimitedInventory`) | ✅ |
| FR-03.5 | Inventory ledger (audit trail) | ✅ |
| FR-03.6 | Admin restock/adjust | ✅ |

### FR-04: Shopping Cart & Checkout
| ID | Requirement | Status |
|-----|-------------|--------|
| FR-04.1 | Server-side cart (cookie session) | ✅ |
| FR-04.2 | Address collection | ✅ |
| FR-04.3 | Payment method selection (Razorpay/COD) | ✅ |
| FR-04.4 | Order creation with stock reservation | ✅ |
| FR-04.5 | Order confirmation + tracking | ✅ |

### FR-05: Orders & Inventory
| ID | Requirement | Status |
|-----|-------------|--------|
| FR-05.1 | Atomic order creation + stock reservation | ✅ |
| FR-05.2 | Transaction-safe cancellation + stock release | ✅ |
| FR-05.3 | Inventory ledger (idempotent) | ✅ |
| FR-05.4 | Concurrency-safe (guarded `$inc`) | ✅ |
| FR-05.5 | Admin inventory management | ✅ |
| FR-05.6 | Purchase orders + receipts | ✅ |

### FR-06: Bookings (Rituals/Readings)
| ID | Requirement | Status |
|-----|-------------|--------|
| FR-06.1 | Service catalog | ✅ |
| FR-06.2 | Booking form + confirmation | ✅ |
| FR-06.3 | Admin booking management | ✅ |

### FR-07: Content Management
| ID | Requirement | Status |
|-----|-------------|--------|
| FR-07.1 | Journal/blog articles (CRUD) | ✅ |
| FR-07.2 | Rituals/services catalog | ✅ |
| FR-07.3 | Site content management | ✅ |

### FR-08: Admin Dashboard
| ID | Requirement | Status |
|-----|-------------|--------|
| FR-08.1 | Stats + revenue chart | ✅ |
| FR-08.2 | Order management (status updates) | ✅ |
| FR-08.3 | Booking management | ✅ |
| FR-08.4 | Product CRUD | ✅ |
| FR-08.5 | User management (unlock) | ✅ |
| FR-08.6 | Inventory status + ledger | ✅ |
| FR-08.7 | Purchase order management | ✅ |
| FR-08.8 | Content management | ✅ |

---

## 3. Non-Functional Requirements

### NFR-01: Security
| ID | Requirement | Status |
|-----|-------------|--------|
| NFR-01.1 | JWT httpOnly Secure cookie | ✅ |
| NFR-01.2 | **CSRF double-submit protection** | ❌ **MISSING** |
| NFR-01.3 | Helmet CSP headers | ✅ |
| NFR-01.4 | Rate limiting (Upstash Redis) | ✅ |
| NFR-01.5 | Input validation (Zod) | ✅ |
| NFR-01.6 | **Audit logging (admin actions)** | ❌ **MISSING** |
| NFR-01.7 | Password policy (strong) | ✅ |
| NFR-01.8 | Razorpay keys validated at startup | ✅ |

### NFR-02: Reliability
| ID | Requirement | Status |
|-----|-------------|--------|
| NFR-02.1 | **Graceful SIGTERM shutdown (30s drain)** | ⚠️ **PARTIAL** |
| NFR-02.2 | Health endpoint (/health) | ✅ |
| NFR-02.3 | **In-flight request drain** | ❌ **MISSING** |
| NFR-02.4 | **Forced connection closure on deadline** | ❌ **MISSING** |
| NFR-02.5 | MongoDB shutdown within deadline | ⚠️ **PARTIAL** |
| NFR-02.6 | Idempotent stock operations | ✅ |
| NFR-02.7 | Concurrent order safety | ✅ |

### NFR-03: Performance
| ID | Requirement | Status |
|-----|-------------|--------|
| NFR-03.1 | No build step (instant deploy) | ✅ |
| NFR-03.2 | Static file caching (immutable) | ✅ |
| NFR-03.3 | Image derivatives (large/thumb) | ✅ |
| NFR-03.4 | Upstash Redis rate limiting | ✅ |

### NFR-04: Observability
| ID | Requirement | Status |
|-----|-------------|--------|
| NFR-04.1 | **Audit logging (admin actions)** | ❌ **MISSING** |
| NFR-04.2 | Inventory ledger (full audit) | ✅ |
| NFR-04.3 | Health checks (DB, storage) | ✅ |
| NFR-04.4 | Structured logging (instance ID) | ✅ |

### NFR-05: Deployability
| ID | Requirement | Status |
|-----|-------------|--------|
| NFR-05.1 | Single Vercel deployment | ✅ |
| NFR-05.2 | **Staging environment (Vercel + Atlas)** | ❌ **MISSING** |
| NFR-05.3 | **CI/CD pipeline (GitHub Actions)** | ❌ **MISSING** |
| NFR-05.4 | **Pre-deploy guard (staging project ID)** | ❌ **MISSING** |
| NFR-05.5 | Same commit SHA for client+server | ❌ **MISSING** |

---

## 4. Staging Verification Requirements (8 SVs)

| SV | Description | Code Ready | Staging Required |
|----|-------------|------------|------------------|
| **SV-001** | Reverse-proxy cookie behavior (same-origin /api) | ❌ | Vercel staging |
| **SV-002** | Browser CSP enforcement | ❌ | Vercel staging |
| **SV-003** | 100 parallel orders (Atlas replica set) | ❌ | Atlas replica set |
| **SV-004** | 15-min lock expiry | ❌ | Wall-clock time |
| **SV-005** | Admin unlock endpoint | ❌ | Vercel + Atlas |
| **SV-006** | SIGTERM drain drill (correct order + force-close) | ❌ | Vercel staging |
| **SV-007** | E2E cart-clear flow (Playwright) | ❌ | Playwright + Browser |
| **SV-008** | CSRF origin allowlist | ❌ | Vercel staging |

---

## 5. Phase 2 Requirements (Deferred)

| ID | Requirement | Dependency |
|----|-------------|------------|
| FR-2.1 | Razorpay payment integration | All 8 SVs PASS in staging |
| FR-2.2 | Webhook handling (payment success/fail) | Razorpay account |
| FR-2.3 | Payment failure → stock release | FR-2.2 |
| FR-2.4 | COD order flow | FR-2.1 |
| FR-2.5 | Refund handling | FR-2.1 |

---

## 6. Acceptance Criteria Summary

### Phase 1.4 Target (Production Readiness)
- [ ] Vercel staging project deployed
- [ ] MongoDB Atlas staging replica set connected
- [ ] CI/CD pipeline: 100% pass on main branch
- [ ] Playwright E2E: tests pass in CI against deployed staging
- [ ] Graceful shutdown drain: implemented + tested (correct order)
- [ ] All 8 SVs: **PASS** in staging
- [ ] RUNBOOK.md published

### Phase 1.3.2 (Completed - Historical)
- [x] Product model: `stock` (Number, min: 0), `unlimitedInventory` (Boolean)
- [x] InventoryLedger: compound unique index on `(idempotencyKey, product)`
- [x] `applyStockDelta`: guarded `$inc` + compensating reversal
- [x] `recordReceipt`: idempotent via unique `idempotencyKey`
- [x] Order creation: guarded stock reservation
- [x] Order cancellation: stock restoration + ledger
- [x] Admin routes: GET inventory, GET ledger, POST restock, PATCH adjust
- [x] Concurrency: 20 parallel, race-free
- [x] All tests pass (local MongoDB required)

---

## 7. Traceability Matrix

| Requirement | Model | Service | Route | Test |
|-------------|-------|---------|-------|------|
| Stock fields | Product.js | — | — | inventory.test.mjs |
| InventoryLedger | StockMovement.js | — | — | inventory.test.mjs |
| applyStockDelta | — | inventoryService.js | — | inventory.test.mjs |
| recordReceipt | — | inventoryService.js | — | inventory.test.mjs |
| Order creation | Order.js | inventoryService.js | POST /api/orders | commerce-validation.test.mjs |
| Order cancel | Order.js | inventoryService.js | PATCH /api/orders/:id | cancellation-inventory.test.mjs |
| Admin inventory | — | inventoryService.js | /api/admin/inventory* | (manual) |
| Concurrency | — | inventoryService.js | — | inventory.test.mjs |
| Idempotency | — | inventoryService.js | — | inventory.test.mjs |
| Graceful drain | — | requestDrain middleware | — | graceful-shutdown.test.mjs |
| CSRF | — | csrf middleware | /api/* | (pending) |
| Audit log | AuditLog.js | auditService.js | /api/admin/* | (pending) |
| Playwright E2E | — | — | /shop, /cart, /checkout | cart.spec.ts (pending) |

---

*Canonical REQUIREMENTS.md — adapted from reference for astrovetro-root architecture*
*Last updated: 2026-11-22*