# Phase 0 — Architecture Audit

**Date:** 2026-11-20  
**Auditor:** Production Validation Agent  
**Status:** Complete

---

## 1. Repository Structure Overview

```
Astrovetro-production/
├── server.js                     # Express application entry point (serverless-compatible)
├── vercel.json                   # Vercel deployment configuration
├── package.json                  # Dependencies and scripts
├── public/                       # Static frontend assets (HTML, CSS, JS)
├── src/
│   ├── api/
│   │   ├── staticApi.js          # Read-only catalogue API (no DB)
│   │   └── commerceApi.js        # Full commerce API (requires DB)
│   ├── config/
│   │   └── env.js                # Environment validation and capability detection
│   ├── controllers/              # HTTP route handlers
│   │   ├── authController.js     # Register, login, logout, me
│   │   ├── cartController.js     # Cart operations
│   │   ├── wishlistController.js # Wishlist operations
│   │   ├── addressController.js  # Saved addresses
│   │   ├── orderController.js    # Checkout, orders, webhooks
│   │   ├── admin*.js             # Admin controllers (11 files)
│   │   └── ...                   # Other controllers
│   ├── db/
│   │   ├── connect.js            # MongoDB connection lifecycle
│   │   └── seed.js               # Database seeding
│   ├── middleware/
│   │   ├── auth.js               # JWT auth, CSRF, role checks
│   │   ├── rateLimitStore.js     # Distributed rate limiting (Upstash Redis)
│   │   ├── validate.js           # Zod validation + rate limiters
│   │   └── errorHandler.js       # Centralized error handling
│   ├── models/                   # Mongoose schemas (18 models)
│   │   ├── User.js               # Authentication + tokenVersion revocation
│   │   ├── Order.js              # Order lifecycle + inventory snapshots
│   │   ├── Product.js            # Catalogue + stock tracking
│   │   ├── Cart.js               # Server-side cart (one per user)
│   │   ├── Wishlist.js           # Saved items per user
│   │   ├── Address.js            # Delivery addresses
│   │   ├── StockMovement.js      # Inventory ledger (immutable)
│   │   ├── StockReceipt.js       # Purchase order receipts (idempotent)
│   │   ├── PurchaseOrder.js      # Supplier orders
│   │   ├── Category.js           # Product taxonomy
│   │   ├── Collection.js         # Curated product groups
│   │   ├── Ritual.js             # Editorial content
│   │   ├── BlogPost.js           # Journal content
│   │   ├── SiteContent.js        # Dynamic page content
│   │   ├── Supplier.js           # Supplier management
│   │   ├── Shipment.js           # Order tracking
│   │   └── AuditLog.js           # Admin action audit trail
│   ├── payments/
│   │   └── razorpay.js           # Razorpay integration (checkout + webhooks)
│   ├── providers/
│   │   ├── staticProvider.js     # In-memory catalogue data
│   │   ├── mongoProvider.js      # Database-backed catalogue
│   │   ├── dbProvider.js         # Provider selector
│   │   └── index.js              # Exports
│   ├── routes/                   # Express routers (8 files)
│   ├── services/                 # Business logic
│   │   ├── cartService.js        # Cart operations (priced on read)
│   │   ├── inventoryService.js   # Stock changes + ledger
│   │   ├── pricing.js            # Cart pricing (server-authoritative)
│   │   └── auditService.js       # Admin action logging
│   └── utils/
│       ├── storage.js            # Storage abstraction (local, S3, B2)
│       ├── ApiError.js           # Standardized error responses
│       ├── asyncHandler.js       # Express async wrapper
│       ├── responses.js          # Pagination helpers
│       ├── csv.js                # CSV export
│       └── content.js            # Content helpers
├── scripts/                      # Operational scripts
│   ├── smoke-production.mjs      # Production health validation
│   ├── smoke-admin.mjs           # Admin flow validation
│   ├── create-admin.mjs          # Admin user provisioning
│   ├── backup-db.mjs             # Database backup
│   ├── backup-media.mjs          # Media backup
│   ├── migrate-catalogue.mjs     # Data migration
│   ├── migrate-users.mjs         # User migration
│   └── restore-stock.mjs         # Inventory restoration
└── tests/                        # Node.js test runner suite (17 files)
```

---

## 2. Critical Request Flows

### 2.1 Customer Authentication Flow
```
POST /api/auth/register
  → validate(signupSchema) → signupLimiter (5/hr)
  → User.findOne(email) → User.create(passwordHash) → issueToken(JWT in httpOnly cookie)
  → 201 { user: toPublic() }

POST /api/auth/login
  → validate(loginSchema) → authLimiter (10/15min)
  → User.findOne(email).select('+passwordHash')
  → bcrypt.compare(plain, hash) OR verifyAgainstNothing() [constant-time]
  → if (!user || !okPassword) → 401 "That email and password do not match."
  → user.lastLoginAt = now → issueToken(JWT) → 200 { user: toPublic() }

GET /api/auth/me
  → requireAuth → resolveUser(JWT) → tokenVersion check → 200 { user }

POST /api/auth/logout
  → optionalAuth → clearToken(cookie) → if (req.user) user.tokenVersion++ → 200
```

### 2.2 Checkout Flow (Cash on Delivery)
```
POST /api/checkout/cod
  → requireAuth → checkoutLimiter (30/10min) → validate(checkoutSchema)
  → loadValidatedCart(userId) → Cart.populate('items.product') → priceCart()
  → stock/availability validation → resolveAddress()
  → reserveOrderNumber() → buildOrder(PAYMENT_METHOD.COD) → order.save()
  → commitInventory(order) [guarded $inc, ledger write, rollback on failure]
  → clearCart() → 201 { order }
```

### 2.3 Checkout Flow (Razorpay Card/UPI)
```
POST /api/checkout/session
  → requireAuth → checkoutLimiter → validate(checkoutSchema)
  → loadValidatedCart() → resolveAddress() → reserveOrderNumber()
  → razorpay.createProviderOrder(amountInPaise, receipt, notes)
  → buildOrder(PENDING) + order.payment = {providerOrderId, amount}
  → order.save() → 201 { razorpayOrderId, keyId, amount, idempotencyKey }

POST /api/checkout/confirm
  → requireAuth → checkoutLimiter → validate(confirmSchema)
  → findByIdempotency() → razorpay.verifyCheckoutSignature()
  → Order.findOne(providerOrderId, user) → razorpay.fetchPayment()
  → isPaymentSuccessful(payment, expectedAmount) → re-read cart & re-price
  → if (amountMismatch) → 409 "bag changed"
  → order.paymentStatus = PAID → order.save()
  → commitInventory() → clearCart() → 201 { order }

POST /api/webhooks/razorpay (express.raw)
  → verifyWebhookSignature(rawBody, x-razorpay-signature)
  → event = JSON.parse(rawBody) → paymentEntity = event.payload.payment.entity
  → Order.findOne(providerOrderId)
  → idempotent: if (paymentStatus === PAID) return 200 { alreadySettled }
  → if (paymentEntity.status === 'captured' && amount === order.payment.amount)
  → order.paymentStatus = PAID → order.save()
  → if (!inventoryCommitted) commitInventory() → clearCart() → 200 { settled }
```

### 2.4 Inventory Commitment (Order)
```
commitInventory(order)
  → for each item with product && product.stock != null
    → Product.findOneAndUpdate(
        { _id, stock: { $gte: quantity } },
        { $inc: { stock: -quantity } },
        { new: false }
      ) → returns balanceBefore
    → if (!beforeDoc) → throw "sold out" → rollback applied lines
    → StockMovement.create(type: 'sale', quantity: -qty, balanceBefore/After)
    → applyZeroStockRule(productId, balanceAfter) → availability = false
  → order.inventoryCommitted = true → order.save()
```

### 2.5 Order Cancellation + Inventory Restoration
```
PATCH /api/admin/orders/:orderId/status (status: 'cancelled')
  → canTransition(current, 'cancelled') → order.status = 'cancelled' → order.save()
  → restoreInventoryForCancelledOrder({ order, actor })
    → if (!order.inventoryCommitted) return { restored: false }
    → for each item with product && product.stock != null
      → Product.findOneAndUpdate({_id, stock: {$ne: null}}, {$inc: {stock: +qty}})
      → StockMovement.create(type: 'return', quantity: +qty, reference: orderNumber)
    → order.inventoryCommitted = false → order.save()
    → auditBestEffort(...)
```

---

## 3. Database Relationships

```
User (1) ──────< Cart (1:1, user unique)
User (1) ──────< Wishlist (1:1, user unique)
User (1) ──────< Address (1:N, user index)
User (1) ──────< Order (1:N, user index, customerEmail)
User (1) ──────< AuditLog (1:N, actor.userId)

Order (1) ──────< OrderItem (embedded array, snapshot)
Order (1) ──────< Shipment (1:1, order ref)
Order (1) ──────< StockMovement (1:N, reference: orderNumber)

Product (1) ──────< StockMovement (1:N, product ref)
Product (1) ──────< StockReceipt (1:N, lines.product ref)
Product (N) ──────< Category (by slug string)
Product (N) ──────< Collection (by slug string)

PurchaseOrder (1) ──────< StockReceipt (1:N, purchaseOrder ref)
PurchaseOrder (1) ──────< PO Lines (embedded array)

Admin actions ──────< AuditLog (entity, action, summary)
```

---

## 4. Authentication & Authorization Boundaries

### 4.1 Identity Layer
- **JWT** in httpOnly, secure, sameSite=lax cookie (`av_token`)
- **Payload:** `{ sub: userId, role: 'customer'|'admin', tv: tokenVersion }`
- **Verification:** `jwt.verify(token, secret, { issuer: 'astrovetro' })`
- **Revocation:** `tokenVersion` bump on logout → invalidates all prior tokens
- **Fallback:** Bearer token support for API clients/tests

### 4.2 Middleware Chain
```
cookieParser() → optionalAuth/requireAuth/requireAdmin → requireSameOrigin (CSRF)
```

### 4.3 Authorization Matrix

| Endpoint | Auth Required | Role Check | Ownership Scope |
|----------|---------------|------------|-----------------|
| `/api/auth/*` | No (public) | — | — |
| `/api/me` | requireAuth | — | req.user._id |
| `/api/cart/*` | requireAuth | — | req.user._id |
| `/api/wishlist/*` | requireAuth | — | req.user._id |
| `/api/me/addresses/*` | requireAuth | — | req.user._id (scoped queries) |
| `/api/checkout/*` | requireAuth | — | req.user._id |
| `/api/orders/*` | requireAuth | — | req.user._id (scoped queries) |
| `/api/admin/*` | requireAdmin | role === 'admin' | — |

### 4.4 CSRF Protection (`requireSameOrigin`)
- **Safe methods:** GET, HEAD, OPTIONS → exempt
- **Sec-Fetch-Site:** `same-origin` or `none` → allowed
- **Fallback:** Origin/Referer host matching
- **No headers + cookie:** 403 (stripped headers = attack vector)
- **No headers + no cookie:** allowed (CLI/test clients)

---

## 5. Payment Lifecycle

### 5.1 Razorpay Integration Points
1. **Provider Order Creation:** `razorpay.orders.create()` with server-computed amount
2. **Checkout Signature Verification:** `HMAC_SHA256(order_id|payment_id, key_secret)` — constant-time compare
3. **Webhook Verification:** `HMAC_SHA256(raw_body, webhook_secret)` — requires `express.raw()`
4. **Payment Fetch:** `razorpay.payments.fetch(paymentId)` — authoritative confirmation
5. **Amount Validation:** Payment amount must match order's `payment.amount` (paise)

### 5.2 Payment State Machine
```
PENDING (order created) 
  → PAID (confirmPayment OR webhook 'captured') 
    → inventoryCommitted = true
    → status: PENDING → PAID (if transition allowed)
  → FAILED (webhook 'failed') 
    → status: PENDING → PAYMENT_FAILED (if allowed)
  → REFUNDED (manual/admin) 
    → status: CANCELLED/REFUNDED
```

### 5.3 Idempotency Guarantees
- **Client:** `Idempotency-Key` header → unique index on `(user, idempotencyKey)` sparse
- **Webhook:** `paymentStatus === PAID` early return + `inventoryCommitted` guard
- **Receipt:** `idempotencyKey` unique index on `StockReceipt`

---

## 6. Inventory Lifecycle

### 6.1 Stock Tracking Conventions
- `stock: null` = untracked (made-to-order, never blocks sale)
- `stock: N (number)` = tracked, authoritative balance
- `availability: false` = explicitly disabled (overrides stock > 0)

### 6.2 Stock Change Operations (All via `inventoryService.js`)

| Operation | Method | Ledger Type | Guards |
|-----------|--------|-------------|--------|
| Opening balance | `applyStockDelta({type: 'opening', delta: N})` | `opening` | `stock === null`, `delta >= 0` |
| Sale (order) | `commitInventory()` (guarded $inc) | `sale` | `stock >= qty`, atomic |
| Receive (PO) | `recordReceipt()` → `applyStockDelta('receive')` | `receive` | idempotencyKey, PO validation |
| Adjustment | `setStockAbsolute()` or `applyStockDelta('adjustment')` | `adjustment` | atomic, negative guard |
| Write-off | `applyStockDelta('write_off', -N)` | `write_off` | atomic, negative guard |
| Return | `restoreInventoryForCancelledOrder()` | `return` | `inventoryCommitted === true` |
| Untrack | `clearTracking()` | — | sets `stock: null` |

### 6.3 Atomicity Guarantees
- **Single-document guarded `$inc`** with `$expr: { $gte: [{ $add: ['$stock', delta] }, 0] }`
- **Balance before/after** captured from `findOneAndUpdate({new: false})` return
- **Ledger write** after balance change; on failure → compensating `$inc` reversal
- **No multi-document transactions** (standalone MongoDB); single-atomic + compensation pattern

### 6.4 Inventory Ledger (`StockMovement`)
- **Immutable:** `pre` hooks throw on any update/delete
- **Snapshot fields:** sku, productName, balanceBefore, balanceAfter
- **Actor attribution:** userId + email (snapshotted)
- **Reference:** orderNumber, PO number, receipt number

---

## 7. Image Upload Lifecycle

### 7.1 Storage Abstraction (`storage.js`)
```
Adapter Interface:
  upload({buffer, filename}) → {original, large, thumb, width, height, size}
  list({assignedPaths}) → [{base, files[], assigned}]
  resolve(publicPath) → absolute path / {bucket, key} / null
  exists(publicPath) → boolean
  delete(publicPath) → count
  stat(publicPath) → {size, mtime}
  getReadStream(publicPath) → ReadableStream
```

### 7.2 Adapters
| Adapter | Prefix | Use Case |
|---------|--------|----------|
| `local` | `library/` | Development, single-server |
| `s3` | `library/` | S3/R2/MinIO |
| `b2` | `library/` | Backblaze B2 (S3-compatible) |

### 7.3 Upload Flow (Admin)
```
POST /api/admin/images/upload (express.raw, limit 12mb)
  → images.uploadImage
  → detectImage(buffer) [magic bytes: JPEG, PNG, WebP, AVIF]
  → sharp: metadata, rotate, resize (1600px large, 480px thumb) → WebP
  → adapter.upload(buffer, filename)
  → returns {original, large, thumb} paths with `/assets/img/library/` prefix
```

### 7.4 Image Delivery
```
GET /assets/img/:path(*)
  → adapter.getReadStream('/assets/img/' + path)
  → if (!stream) 404
  → Content-Type from extension
  → Cache-Control: public, max-age=31536000, immutable
  → stream.pipe(res)
```

### 7.5 Security Controls
- Magic-byte validation (not Content-Type header)
- 12MB size limit
- Filename generated server-side (`timestamp-random.ext`)
- Path traversal prevention in `resolve()`
- Admin-only upload endpoint

---

## 8. External Service Dependencies

| Service | Purpose | Client Library | Failure Mode |
|---------|---------|----------------|--------------|
| **MongoDB Atlas** | Primary database | Mongoose 9.x | Degrade to static catalogue |
| **Backblaze B2** | Object storage | @aws-sdk/client-s3 | Local fallback, read-only images |
| **Upstash Redis** | Distributed rate limiting | @upstash/ratelimit, @upstash/redis | In-memory fallback (non-distributed) |
| **Razorpay** | Payments | razorpay npm | COD only, card/UPI disabled |

---

## 9. Existing Test Coverage

| Test File | Scope | Tests | DB Required |
|-----------|-------|-------|-------------|
| `cancellation-inventory.test.mjs` | Order cancellation + inventory | 7 | Yes |
| `admin-authz.test.mjs` | Admin auth boundaries | 5 | Yes |
| `admin-flows.test.mjs` | Admin API CRUD | 24 | Yes |
| `admin-ui.test.mjs` | Admin bundle validation | 5 | No |
| `storage-b2.test.mjs` | B2 adapter (mocked) | 6 | No |
| `b2-error-normalization.test.mjs` | S3 error mapping | 11 | No |
| `storage-health.test.mjs` | Storage health checks | 3 | No |
| `capabilities.test.mjs` | Frontend capability detection | 3* | No |
| `api-public.test.mjs` | Public API endpoints | 1 | No |
| `storefront-pages.test.mjs` | HTML page validation | 3 | No |
| `csv.test.mjs` | CSV export | 7 | No |
| `infrastructure.test.mjs` | Deployment config | 1 | No |
| `account-database-fallback.test.mjs` | DB fallback behavior | — | No |
| `studio.test.mjs` | Admin UI routes | — | Yes |
| `db-connection-recovery.test.mjs` | Connection recovery | — | Yes |
| `image-upload-limits.test.mjs` | Upload validation | — | No |

*Note: `capabilities.test.mjs` has 2 pre-existing bugs (missing `await` on subtests)*

---

## 10. Identified Architectural Risks

### 10.1 Critical Risks

| Risk | Description | Impact | Current Mitigation |
|------|-------------|--------|-------------------|
| **Connection failure = permanent outage per instance** | First DB connection failure caches rejected promise; no auto-retry | Complete loss of commerce features until redeploy | Structured logging; manual restart |
| **Upstash Redis unavailable** | Rate limiting falls back to in-memory (non-distributed) | Auth rate limits reset per cold start | Warns at startup; acceptable for serverless |
| **No multi-document transactions** | Inventory + order + cart operations span multiple collections | Potential inconsistency on crash | Single-atomic + compensation pattern |
| **Vercel cold starts** | New DB connection per invocation | Latency (500-1500ms) | 5s serverSelectionTimeout; connection pooling |
| **Atlas connection exhaustion** | `maxPoolSize: 10` × N instances | Cannot connect to DB | Monitoring; consider pool sizing |

### 10.2 High Risks

| Risk | Description | Impact |
|------|-------------|--------|
| **Webhook delay/loss** | Order stays PENDING until webhook arrives | Customer confusion, manual intervention |
| **B2 credentials in env vars** | Rotation requires redeploy | Operational burden |
| **No backup/restore automation** | Manual scripts only | RPO/RTO undefined |
| **Payment verification only in confirmPayment** | No periodic reconciliation job | Stale PENDING orders |

### 10.3 Medium Risks

| Risk | Description |
|------|-------------|
| `orderNumber` generation | Race on concurrent checkouts (retries with unique index guard) |
| `tokenVersion` revocation | Logout invalidates all sessions (no selective revocation) |
| Single `tokenVersion` | Cannot revoke specific device/session |

---

## 11. Code Quality Observations

### Strengths
- **Defense in depth:** Validation at boundary (Zod), database (unique indexes), business logic (guards)
- **Idempotency everywhere:** Client keys, webhook dedup, receipt keys, order idempotency
- **Constant-time auth:** `verifyAgainstNothing()` prevents account enumeration
- **Server-authoritative pricing:** Cart/wishlist/checkout all recompute from `Product`
- **Immutable ledger:** `StockMovement` cannot be modified
- **No secrets in logs:** Host sanitization, error message stripping
- **Comprehensive error codes:** `ApiError` with machine-readable codes

### Areas for Hardening
- **Connection resilience:** Add retry with `connectionPromise = null` on failure
- **Rate limit fail-closed policy:** Document behavior when Redis unavailable
- **Webhook reconciliation job:** Periodic sweep for stuck PENDING orders
- **Backup verification:** Automated restore test procedure
- **Observability:** Structured JSON logs with instance IDs, request tracing

---

## 12. Phase 0 Conclusion

The Astrovetro architecture is **well-structured for production commerce** with:
- Clear separation of concerns (controllers → services → models)
- Strong security defaults (httpOnly cookies, CSRF, constant-time auth)
- Server-authoritative business logic (pricing, inventory, payments)
- Idempotency at every critical write path
- Graceful degradation when dependencies fail

**Critical gaps to validate in subsequent phases:**
1. Distributed rate limiting actually works across instances (Upstash integration)
2. B2 storage works with real credentials (not mocked)
3. Payment webhook idempotency under duplicate delivery
4. Inventory concurrency under load
5. Connection failure recovery behavior

Proceed to Phase 1: Customer Authentication Validation.