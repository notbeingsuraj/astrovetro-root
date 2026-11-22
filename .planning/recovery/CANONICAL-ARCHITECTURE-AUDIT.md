# Canonical Architecture Audit — Astrovetro Root

## 1. Project Overview

**Repository**: `notbeingsuraj/astrovetro-root`  
**Local Path**: `~/desktop/astrovetro-production`  
**Branch**: `recovery/phase-1.4-canonical` (from `main` at `aad286d`)  
**Primary Purpose**: Astro Vetro — static design served with an API proxy to the Astro Vetro backend (localhost:5002) or in-process static/database API.

---

## 2. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        ASTROVETRO ROOT                               │
│  (Express + Vite-less static frontend + in-process API)             │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
            ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
            │  Static     │ │  Database   │ │  Proxy      │
            │  Catalogue  │ │  (MongoDB)  │ │  (API_TARGET)│
            │  (local)    │ │  (Mongoose) │ │  (optional) │
            └─────────────┘ └─────────────┘ └─────────────┘
                    │               │               │
                    └───────────────┼───────────────┘
                                    ▼
                        ┌─────────────────────┐
                        │  Storage Adapter    │
                        │  (local / S3 / B2)  │
                        └─────────────────────┘
```

---

## 3. High-Level Structure

```
astrovetro-root/
├── server.js                    # Entry point (dual: local server + Vercel serverless)
├── package.json                 # Root package (frontend + API in one)
├── vercel.json                  # Vercel deployment config
├── public/                      # Static HTML/CSS/JS (served as-is)
│   ├── index.html
│   ├── shop.html
│   ├── admin.html
│   ├── order.html
│   ├── tracking.html
│   ├── rituals.html
│   ├── 404.html
│   └── assets/
│       ├── css/
│       ├── js/                  # client-side JS (vanilla, no build step)
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

---

## 4. Core Components

### 4.1 Server Architecture (`server.js`)

**Dual-Mode Execution**:
- **Local/Traditional**: `node server.js` → binds to PORT (default 5173)
- **Vercel Serverless**: Exports `app` as default; Vercel manages socket

**API Resolution Strategy** (priority order):
1. `AV_DISABLE_API=1` → All `/api` requests fail (resilience testing)
2. `API_TARGET` set → Proxy `/api` to external backend (e.g., `http://localhost:5002`)
3. `DATABASE_URL` set → In-process `commerceApi` with MongoDB
4. No `DATABASE_URL` → In-process `staticApi` (read-only catalogue)

**Key Middleware Chain**:
```
helmet (CSP) → cookieParser → CORS (/api) → DB readiness → API provider
```

**Graceful Shutdown** (local only):
- SIGTERM/SIGINT → close HTTP server → disconnect DB → 10s force exit

### 4.2 Configuration (`src/config/env.js`)

**Centralized Environment**: Single source of truth, read once at import.

**Key Features**:
- `frontendOrigins`: Parsed from `FRONTEND_URL` (comma-separated, no wildcard in prod)
- `databaseUrl`: From `DATABASE_URL` or `MONGODB_URI`
- `jwt.secret`: Required in production, min 32 chars
- `razorpay`: `keyId`, `keySecret`, `webhookSecret` → `paymentLive` derived
- `paymentLive`: Both keyId and keySecret must be present together
- `assertProductionSecrets()`: Hard failure in prod for missing/insecure secrets

### 4.3 Database (`src/db/connect.js`)

**Connection Manager Features**:
- Single shared connection promise (no duplicate connections)
- Bounded exponential backoff with jitter (3 attempts, 1-10s)
- Actual ping verification before resolving
- Serverless-compatible (Vercel warm/cold starts)
- Structured logging with instance ID, no credential leakage
- Event listeners for observability (connected, disconnected, error, reconnected)

**Key Exports**:
- `connectDB()` → `Promise<boolean>`
- `ensureConnected()` → `Promise<true>` / throws
- `dbReady()` → `Promise<boolean>` (graceful degradation)
- `disconnectDB()` → `Promise<void>`
- `isConnected()` / `isDbConnected()` → `boolean`

### 4.4 Storage Abstraction (`src/utils/storage.js`)

**Three Adapters** (pluggable via `STORAGE_ADAPTER` env):

| Adapter | Use Case | Credentials |
|---------|----------|-------------|
| `local` (default) | Dev, single-server prod | None |
| `s3` | Cloudflare R2, AWS S3, MinIO | S3_BUCKET, ACCESS_KEY, SECRET |
| `b2` | Backblaze B2 | B2_BUCKET_NAME, B2_KEY_ID, B2_APPLICATION_KEY |

**Interface** (all adapters implement):
- `upload({buffer, filename})` → `{original, large, thumb, width, height, size}`
- `list({assignedPaths})` → grouped by base name
- `resolve(publicPath)` → absolute path or S3 key
- `exists(publicPath)` → `boolean`
- `delete(publicPath)` → count deleted
- `stat(publicPath)` → `{size, mtime}`
- `getReadStream(publicPath)` → `ReadableStream`

**Health Check** (`checkStorageHealth()`):
- Local: checks `public/assets/img/library` R/W access
- S3/B2: lightweight `ListObjectsV2` (MaxKeys: 1)
- Warns if local adapter used in serverless production

### 4.5 API Providers

**Static Provider** (`src/api/staticApi.js`):
- Read-only catalogue from `src/data/catalogue.js`
- No authentication, no writes
- Serves products, categories, collections

**Commerce Provider** (`src/api/commerceApi.js`):
- Full CRUD with MongoDB
- Authentication, cart, orders, wishlist, addresses
- Inventory management with atomic stock operations
- Admin endpoints

### 4.6 Inventory Service (`src/services/inventoryService.js`)

**Key Invariants**:
1. Balance never negative, never changes without ledger entry
2. Untracked products (`stock: null`) never decremented
3. Every movement carries actor, reason, before/after, reference

**Concurrency Model**: Guarded single-document `$inc` (no transactions — standalone MongoDB)
- `applyStockDelta()`: atomic `$inc` with `$expr` guard
- Compensating reversal if ledger write fails
- `recordReceipt()`: idempotent via unique `idempotencyKey`
- `restoreInventoryForCancelledOrder()`: idempotent, only if `inventoryCommitted`

### 4.7 Models

**Product** (`src/models/Product.js`):
- `stock: Number | null` (null = untracked, not sold out)
- `sku`: sparse unique, generated from slug
- `status`: draft | active | archived
- `toPublic()` / `toAdmin()` serializations

**Other Models**: User, Order, Cart, Wishlist, Address, Category, StockMovement, StockReceipt, PurchaseOrder, Supplier, Shipment, BlogPost, Ritual, Collection, SiteContent, AuditLog

---

## 5. Deployment Model

### 5.1 Vercel (Primary)

**Configuration** (`vercel.json`):
```json
{
  "builds": [{ "src": "server.js", "use": "@vercel/node" }],
  "routes": [{ "src": "/(.*)", "dest": "server.js" }]
}
```

**Execution**: Serverless function per request (no persistent HTTP server)

**Environment Variables** (set in Vercel dashboard):
- `FRONTEND_URL` (required in prod)
- `DATABASE_URL` / `MONGODB_URI`
- `JWT_SECRET`
- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`
- `STORAGE_ADAPTER` (b2/s3/local)
- B2/S3 credentials if applicable

### 5.2 Local Development

```bash
npm start          # Runs server.js on PORT 5173
npm run dev        # Same (no hot reload - static files served as-is)
```

**No Build Step**: `public/` served as-is; client JS is vanilla ES modules.

---

## 6. Testing Infrastructure

### 6.1 Test Runner
- **Framework**: Node.js built-in `--test` (`node --test tests/`)
- **Location**: `tests/*.test.mjs`
- **Helper**: `tests/helpers/` for common setup

### 6.2 Test Categories

| Test File | Purpose | DB Required |
|-----------|---------|-------------|
| `auth-validation.test.mjs` | Auth flows | Yes |
| `admin-flows.test.mjs` | Admin API | Yes |
| `commerce-validation.test.mjs` | Commerce flows | Yes |
| `storage-b2.test.mjs` | B2 adapter | No (mocked) |
| `storage-health.test.mjs` | Health checks | No |
| `b2-error-normalization.test.mjs` | Error mapping | No |
| `cancellation-inventory.test.mjs` | Inventory restore | Yes |
| `admin-authz.test.mjs` | Admin auth | Yes |
| `admin-ui.test.mjs` | Admin UI routes | No |
| `api-public.test.mjs` | Public API | No |
| `capabilities.test.mjs` | Capability detection | No |
| `catalogue-assets.test.mjs` | Image assets | No |
| `storefront-pages.test.mjs` | Static pages | No |
| `studio.test.mjs` | Studio CMS | Yes |
| `db-connection-recovery.test.mjs` | DB resilience | Yes |
| `image-upload-limits.test.mjs` | Upload limits | No |

### 6.3 Current Test Results (MongoDB unavailable)
- **Pass**: 44 (storage, static assets, error normalization, health checks)
- **Skipped**: 9 (all DB-dependent tests — `mongod not reachable`)
- **Fail**: 0

---

## 7. Runtime Assumptions

| Assumption | Reality | Notes |
|------------|---------|-------|
| Persistent HTTP server | ❌ Serverless on Vercel | `server.close()` only runs locally |
| MongoDB transactions | ❌ Standalone MongoDB | Uses guarded `$inc` instead |
| Redis for rate limiting | ❌ Upstash Redis | `@upstash/ratelimit` + `@upstash/redis` |
| Separate frontend/backend | ❌ Single deployment | `server.js` serves both |
| Build step required | ❌ No build | `public/` served directly |
| React/Vite frontend | ❌ Vanilla JS | `public/assets/js/*.js` |

---

## 8. Dependencies

**Production** (from `package.json`):
- `express` 4.21.2
- `mongoose` 9.10.4
- `helmet` 8.3.0
- `cors` 2.8.6
- `cookie-parser` 1.4.7
- `jsonwebtoken` 9.0.3
- `bcryptjs` 3.0.3
- `zod` 4.6.5
- `helmet` 8.3.0
- `express-rate-limit` 8.7.0
- `@upstash/ratelimit` 2.0.0 + `@upstash/redis` 1.34.0
- `@aws-sdk/client-s3` 3.450.0 + `@aws-sdk/s3-request-presigner`
- `razorpay` 2.9.8
- `sharp` 0.35.5 (image processing)
- `multer` 1.4.5-lts.1 (uploads)
- `http-proxy-middleware` 3.0.3 (API_TARGET proxy)

**Dev**: `aws-sdk-client-mock` 4.1.0

---

## 9. Unresolved Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| No local MongoDB | DB tests skipped | Document how to run with DB |
| No replica set | No transactions | Guarded `$inc` compensates |
| Serverless shutdown | 10s force exit | Document limitations |
| Local storage in serverless | Ephemeral uploads | Warn in health check |
| No CI/CD pipeline | Manual deploys | Need GitHub Actions |
| No Playwright E2E | Browser tests missing | Need integration |
| Razorpay webhook | Unverified in tests | Need mock/integration test |

---

## 10. Architectural Decisions

| Decision | Rationale |
|----------|-----------|
| Single `server.js` for static + API | Simplifies deployment, avoids CORS |
| Dual API mode (static/db/proxy) | Zero-config dev, graceful degradation |
| Guarded `$inc` over transactions | Works on standalone MongoDB |
| `stock: null` = untracked | Allows "made to order" items |
| `toPublic()` / `toAdmin()` | Single source of truth, no leakage |
| Storage adapter pattern | Swap B2/S3/local without code changes |
| `API_TARGET` proxy | Future backend migration path |
| `AV_DISABLE_API` | Resilience testing affordance |

---

## 11. Files Requiring Attention for Phase 1.4

| File | Current State | Phase 1.4 Need |
|------|---------------|----------------|
| `server.js` | Basic shutdown (10s) | Drain in-flight, force-close, DB timeout |
| `src/middleware/` | No requestDrain, CSRF | Add drain, CSRF, auditLog |
| `src/db/connect.js` | Good | Verify shutdown integration |
| `src/utils/storage.js` | Complete | Health check verified |
| `tests/` | No Playwright | Add E2E for SV-007 |
| `.github/workflows/` | Missing | CI/CD with staging guard |
| `vercel.json` | Production only | Staging config needed |
| `RUNBOOK.md` | Missing | Operational procedures |

---

*Report generated: 2026-11-22*  
*Audit scope: Canonical repository only (`astrovetro-root`)*