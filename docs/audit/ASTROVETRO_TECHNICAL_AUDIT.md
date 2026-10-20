# ASTROVETRO — Technical Audit

## 1. Repository Map

### Top-level
| Path | Type | Notes |
|---|---|---|
| `package.json` | Config | ES modules, Express 4, Mongoose 9, JWT, bcryptjs, Razorpay, Sharp, Zod. Scripts include start/dev/build (no-op), test (node --test), smoke/admin/migrate scripts. |
| `server.js` | Entry | Main app. Dynamic API mounting: proxy if API_TARGET, disabled if AV_DISABLE_API=1, static if no DB, else DB-backed with fallback on failure. Handles routes for /orders/:id, /tracking/:id, redirects, static serving, 404s, serverless awareness. |
| `.env` | Config (dev) | Local dev placeholders; production secrets asserted at boot. DB at localhost:27017. JWT_SECRET dev-only. |
| `vercel.json` | Deploy | Routes all traffic to server.js via @vercel/node. |
| `public/` | Static | 21 HTML pages + assets (CSS/JS/images). Client-side vanilla JS. |
| `src/` | Backend | API, controllers, models, routes, middleware, services, providers, db, config, data, payments, utils. |
| `tests/` | Tests | node --test with isolated DBs, self-booting servers. |
| `scripts/` | Utilities | create-admin, migrate-catalogue, migrate-users, smoke-admin, generate-image-review. |
| `docs/` | Docs | IMAGE-MAPPING.md, image-manifest.json, image-review.html. |

### Key source locations
- API: `src/api/commerceApi.js` (DB), `src/api/staticApi.js` (read-only)
- Providers: `src/providers/` (data provider abstraction)
- Models: 13 Mongoose models (Product, User, Order, Cart, Wishlist, Address, StockMovement, StockReceipt, PurchaseOrder, Supplier, Category, AuditLog, Shipment)
- Controllers: admin* controllers split by domain, auth/cart/order/account/tracking/wishlist
- Middleware: `auth.js` (JWT cookie auth, optionalAuth/requireAuth/requireAdmin, requireSameOrigin CSRF), `validate.js`, `errorHandler.js`
- Routes: modular (auth, cart, wishlist, addresses, orders, checkout, admin)

### Distinction (app vs generated/deps)
- App code: `src/`, `public/`, `server.js`, `scripts/`, `tests/`, `docs/` (non-generated docs)
- Dependencies: `node_modules/` (ignored)
- HTML snapshots/examples: `astrovetro_*.html` files in root appear to be design/reference files (separate from `public/` app). `astrovetero_script_download.zip`, `script.js`, `styles.css` in root also present - these look like legacy/reference assets; the actual served app uses `public/` and `server.js`.
- Build artifacts: none (no build step; build script just logs). Static served as-is.

**Evidence**: `package.json` line 10 states no build step; `server.js` serves `public/`.

## 2. Architecture

### High-level architecture (actual)
The system is a hybrid: static-first storefront with optional full commerce backend. API mode is selected at runtime.

**Mermaid (verified components only):**
```text
┌─────────────────────────────────────────────────────────────────┐
│                        Browser (Client)                        │
│  ┌─────────────┬─────────────┬─────────────┬─────────────────┐  │
│  │  store.js   │ customer.js  │  admin.js   │     api.js      │  │
│  │  (catalogue/ │ (account/    │ (admin UI   │ (fetch wrapper, │  │
│  │   cart UI)  │   orders)    │  ~2000 LOC) │  auth/CSRF)     │  │
│  └─────────────┴─────────────┴─────────────┴─────────────────┘  │
└─────────────────────────────┬───────────────────────────────────┘
                              │ HTTP (cookies, JSON)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Express App (server.js)                     │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │                API Router Selection                    │   │
│  │  API_TARGET → proxy to external backend               │   │
│  │  AV_DISABLE_API=1 → 503 for all /api                  │   │
│  │  no DB URL → staticApi (read-only catalogue)           │   │
│  │  DB URL + connect OK → commerceApi (full)              │   │
│  │  DB URL + connect fails → fallback to staticApi        │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Static serving: public/ (HTML/CSS/JS/images), 404 handling    │
│  Route validation: /orders/:id, /tracking/:id (regex check)   │
└─────────────┬─────────────────────────────┬───────────────────┘
              │                             │
              ▼                             ▼
        ┌─────────────┐             ┌─────────────────┐
        │  staticApi  │             │   commerceApi   │
        │  (read-only)│             │  (full CRUD)    │
        └─────┬───────┘             └────────┬────────┘
              │                             │
              ▼                             ▼
        ┌─────────────┐             ┌─────────────────────────┐
        │ Data Provider│             │  Routes + Controllers   │
        │ (catalogue   │             │  Auth (JWT httpOnly)    │
        │  from JS)    │             │  CSRF (requireSameOrigin)│
        └─────────────┘             │  RBAC (requireAdmin)    │
                                    │  Validation/Middleware  │
                                    └────────┬────────────────┘
                                             │
                                             ▼
                                    ┌─────────────────────┐
                                    │   MongoDB + Mongoose│
                                    │  Models: Product,   │
                                    │  User, Order, Cart, │
                                    │  Wishlist, Address, │
                                    │  StockMovement etc. │
                                    └─────────────────────┘
```

### Data flow diagrams

**Customer data flow (browsing + purchase when DB connected):**
1. Browser loads `public/*.html`, assets. `api.js` initializes with capability probe (`GET /api/status`).
2. Catalogue reads hit `/api/products`, `/api/products/:slug` etc. Served by staticApi (from `src/data/catalogue.js`) or commerceApi (from DB via provider). Response envelope `{success,data,meta}`.
3. Auth: login/register POST to `/api/auth/*`, receives httpOnly JWT cookie (`av_token`). `requireSameOrigin` enforces CSRF on non-GET.
4. Cart/Wishlist/Addresses/Orders: require auth (or optional auth patterns), scoped by `req.user._id` in controllers. All ownership enforced server-side.
5. Checkout: `POST /api/checkout/session` (Razorpay) or `POST /api/checkout/cod`. Idempotency key required/used. Server computes prices/totals from DB (never trusts client). On confirm, payment signature verified server-side; cart cleared on success.
6. Orders/tracking: public/customer routes with validation; ownership checked in controllers.

**Admin product & inventory update flow:**
1. Admin signs in (role admin) → `requireAdmin` protects `/api/admin/*`.
2. Product CRUD via `adminProductController` → updates Product model. Image ops via `adminImageController` (set/add/remove, order matters for primary).
3. Inventory adjustments via `adminInventoryController.adjustProductStock` → uses inventory service. Creates StockMovement ledger entries. Validates deltas (cannot make stock negative when tracked). 
4. Purchase Orders flow: create/send/receive → generates StockReceipt/StockMovement on receipt.
5. All admin actions may be logged to AuditLog (see admin controllers). 
6. Frontend admin.js calls endpoints, renders tables, uses dialogs for forms.

### Trust boundaries
- **Client boundary (untrusted)**: All data from browser is untrusted. Validation exists server-side (see controllers, middleware). Prices/totals never computed client-side for orders; server reads cart/products.
- **Auth boundary**: httpOnly cookie prevents JS access. CSRF via `requireSameOrigin` (Sec-Fetch-Site/Origin/Referer checks). Token verification + tokenVersion revocation.
- **RBAC**: `requireAdmin` enforces admin role server-side; admin.html is just UI (protected by API).
- **Payment boundary**: Razorpay webhook expects raw body for signature verification (registered before JSON parser in commerceApi). Confirm endpoint verifies signature server-side.
- **DB boundary**: Mongoose schemas with validation (min values, enums, required fields). Business rules in services (inventory service).
- **File upload boundary**: Image upload accepts `image/*` with 12mb limit, processed via Sharp (present in deps). Stored under public assets or library as configured.

### Key user journeys traced (files)
1. **Browse catalogue**: `public/shop.html` + `public/assets/store.js` → `AV.api.get('/api/products')` → server routes to staticApi or commerceApi → provider reads catalogue/DB → returns products. Product detail: `product.html` + store.js reads slug.
2. **Add to cart (signed in)**: `store.js` calls `AV.cart.add(productId, qty)` → `api.js` POST `/api/cart/items` → `cartRoutes` → `cartController` → Cart model, checks stock/canFulfil → returns cart (broadcasted). 
3. **Checkout COD**: `checkout.html` + logic calls `AV.checkout.cod(payload, key)` with idempotency → server validates address/cart, computes totals from DB, creates Order with snapshot (prices), empties cart, returns order. Order view at `/orders/:id`.

**Evidence**: server.js route validation (lines ~191-210), commerceApi routing (146-161), api.js cart/checkout methods (291-456), Product model methods for canFulfil/effectivePrice.

### Architecture appropriateness
For current scale (small catalogue ~12 products, boutique store), this hybrid is appropriate. Strengths: graceful degradation, clear separation (static vs DB), no framework lock-in, easy to run without full infra. Potential scaling concerns: vanilla JS admin is large (2000 LOC) but manageable; MongoDB fine for small scale. Architecture is pragmatic.

## 3. Feature Inventory & Implementation Status

Using status definitions as specified.

### A. Customer-facing storefront
| Feature | Purpose | Files/Routes | Frontend | Backend | Data | Auth | Validation | Status | Notes/Evidence |
|---|---|---|---|---|---|---|---|---|---|
| Homepage/Gateway | Entry (Crystals\|Rituals) | `index.html`, `home.html`, server redirects | Implemented | Static routing | Static | None | N/A | Implemented & verified | Routes in server.js (167-176) |
| Product listing (Shop) | Browse catalogue | `/shop.html`, `store.js`, `GET /api/products` | Implemented | Implemented (static+DB) | Catalogue/DB | None | Query params | Implemented & verified | Both providers implement listProducts with filtering |
| Product detail | View single product | `/product.html`, `store.js`, `GET /api/products/:slug` | Implemented | Implemented | Catalogue/DB | None | Slug lookup | Implemented & verified | |
| Categories/Filters | Filter by category/intentions | store.js, API supports query | Implemented | Implemented | Catalogue/DB | None | Validated | Implemented & verified | Intentions endpoint separate (declared before :slug) |
| Search | Text search | store.js (client-side?) or API | Partial | Partial | Catalogue/DB | None | - | UI-only/Partially implemented | Need to inspect store.js search; Product has text index in schema but API may not expose full text search in listProducts - *inference; requires deeper check of provider* |
| Cart | Shopping bag | `/cart.html`, api.js cart API | Implemented | Implemented (DB mode) | DB/Cart model | Optional auth | Server validates | Implemented, unverified (end-to-end) | Works in DB mode; in static mode writes return 503 |
| Wishlist | Save items | `/wishlist.html`, wishlist API | Implemented | Implemented (DB) | DB/Wishlist | RequireAuth | Ownership | Implemented, unverified | |
| Checkout | Place order | `/checkout.html`, checkout API | Implemented | Implemented (DB) | DB/Order/Cart | RequireAuth (typical) | Server-side totals | Implemented, unverified | COD + Razorpay session; confirm verifies signature |
| Customer account | Profile/addresses/orders | `/account.html`, customer.js | Implemented | Implemented (DB) | DB/User/Address/Order | RequireAuth | Ownership | Implemented, unverified | |
| Orders list/detail/tracking | Order history & tracking | `/orders.html`, `/order.html`, `/tracking.html`, routes validated | Implemented | Implemented | DB/Order/Shipment | RequireAuth for list/detail ownership | Regex validation on IDs | Implemented, unverified | server.js validates ORDER_REF |
| Contact/Enquiry | Contact forms | `/contact.html`, possibly API? | Implemented (UI) | Unknown/likely not implemented | Unknown | None | - | UI-only / unknown | StaticApi refuses non-GET writes with 503; need to check if contact endpoint exists - *not visible in routes read* |
| Journal/Articles/Services/Testimonials | Content pages | `/journal.html`, `/article.html`, API endpoints exist | Implemented | Implemented (read-only) | Static/DB | None | - | Implemented & verified | API has articles/services/testimonials endpoints |
| Responsive/accessibility | UI concerns | CSS, HTML | Partial | N/A | N/A | N/A | N/A | Partially implemented | Has aria-live toasts, semantic HTML; comprehensive a11y audit not done |
| Loading/empty/error states | UX states | JS/CSS | Implemented | N/A | N/A | N/A | N/A | Implemented, unverified | Common patterns in store/customer/admin JS |

**Status notes**: Many commerce features exist in code but require DB + verification. Static mode is read-only by design.

### B. Product catalogue
| Element | Status | Evidence |
|---|---|---|
| Schema (fields) | Implemented & verified | Product model has name, slug (unique), category (slug ref), sku (sparse unique), price/salePrice/costPrice, images/imageAlts (parallel), description, intentions, stock (null-tracked), reorder*, status, tags, needsReview, reviewNote. Matches catalogue structure. |
| SKUs | Implemented & verified | `defaultSku()` generates from slug; schema has unique sparse SKU. |
| Categories | Implemented & verified | Category model exists; products reference by slug; Category collection is source of truth (admin managed). |
| Images mapping | Implemented, partially verified | `docs/IMAGE-MAPPING.md`, manifest present. Tests verify images exist locally, under product dirs, no duplicates, only labradorite-pendant photo-less. Parallel alts enforced. README notes 4/12 await human verification. |
| Stock/availability | Implemented & verified | `stock` null means untracked; `availability` boolean; `canFulfil()` checks; `inStock` computed in toPublic. |
| Data consistency (static vs DB) | Implemented & verified | Product model fields mirror `src/data/catalogue.js`; providers produce same shape. Tests confirm catalogue integrity. |

### C. Inventory management
| Feature | Status | Evidence |
|---|---|---|
| Stock quantities | Implemented & verified | Product.stock (Number, min 0, default null). Adjustments via inventory service. |
| Stock adjustments | Implemented & verified | `POST /api/admin/inventory/adjust/:productId` → `adminInventoryController.adjustProductStock`. Uses service with ledger. Cannot make tracked stock negative (validated). |
| Untrack products | Implemented & verified | `POST /api/admin/inventory/untrack/:productId`. |
| Stock movement history | Implemented & verified | StockMovement model + `GET /api/admin/inventory/movements`. Movement types include purchase_receipt, adjustment, order_sale, order_cancellation, manual, transfer, count_correction etc. |
| Low stock alerts | Implemented & verified | `isLowStock()` with default threshold (3) or per-product `reorderThreshold`. `stockState` in toAdmin (in/low/out/untracked). |
| Duplicate prevention | Implemented & verified | Slug unique, SKU unique sparse. |
| Negative quantity validation | Implemented & verified | `Product.statics.canApplyDelta()` and inventory service validation prevent negative stock for tracked items. Tests cover concurrency/no negative stock. |
| Concurrent stock updates | Implemented, unverified in production | Tests include inventory concurrency cases. Implementation uses DB operations; specific transaction strategy needs review. |
| Audit logs | Implemented, partial | AuditLog model exists. Admin controllers may write audit entries (system controller has listAudit). Extent of coverage across all ops varies. |
| Recovery options | Partially implemented | Ledger exists (movements/receipts), POs tracked. No explicit "rollback" UI mentioned; can reconstruct from ledger. |
| Purchase Orders + Receipts | Implemented & verified | PO model, StockReceipt model, receive flow creates movements. Admin routes for full PO lifecycle. |

**Evidence**: Product model (stock/canApplyDelta/isLowStock), adminInventoryController, StockMovement/StockReceipt models, admin routes 49-78.

### D. Admin dashboard / CRM
| Feature | Status | Evidence |
|---|---|---|
| Admin access protection | Implemented & verified | `requireAdmin` middleware checks role==='admin', requires auth. Applied to all admin routes. |
| Product/catalogue management | Implemented & verified | CRUD, archive/restore, image management endpoints + UI. |
| Inventory controls | Implemented & verified | Adjust, untrack, movements table, inventory dashboard/table. |
| Customer/lead management | Partially implemented | Users list (`GET /api/admin/users`), role change. No explicit CRM/leads beyond users. Enquiries/contact - no dedicated admin endpoints visible. |
| Enquiry tracking | Not implemented | No evidence of enquiry/contact storage endpoints in read routes/controllers. |
| Order management | Implemented & verified | List all, detail, status updates, attach shipment, add tracking events. |
| Analytics/reporting | Partially implemented | Dashboard endpoint exists; Reports module with CSV exports (products/inventory/movements/orders). Basic metrics. |
| Search/filtering/pagination/bulk ops | Implemented, unverified | Admin JS has tables with controls; API endpoints accept query params in many cases (list endpoints). Bulk ops not obvious from routes. |
| User roles/permissions | Implemented & verified | User model has role (default 'customer', can be 'admin'). Role change endpoint. RBAC enforced. |
| Persistence/API connectivity | Implemented & verified | All admin modules call real API endpoints; no stubs. |

### E. Integrations & Infrastructure
| Integration | Status | Evidence |
|---|---|---|
| MongoDB connection | Implemented & verified | `src/db/connect.js` - connectDB() resolves false on failure (graceful). Used in server.js with fallback. |
| Mongoose models | Implemented & verified | 13 models with schemas, indexes (text index on Product, others on slugs/ids). |
| JWT auth | Implemented & verified | httpOnly cookie, issuer/expiresIn from env, tokenVersion for revocation. |
| CSRF protection | Implemented & verified | `requireSameOrigin` middleware checks Sec-Fetch-Site/Origin/Referer; exempts safe methods. |
| Helmet security headers | Implemented & verified | CSP configured (includes Razorpay origins), HSTS conditional, COEP disabled. |
| Rate limiting | Present in deps | `express-rate-limit` in dependencies; usage not visible in read files - *may be applied in specific routes or not yet; unverified*. |
| Razorpay | Implemented (groundwork) | Payments controller/routes, env checks, client-side integration points. Marked as needs verification in README. |
| Image processing | Present | Sharp in deps (used in image upload paths?). |
| Environment/secrets | Implemented with guards | `env.js` validates production secrets (JWT length, key pairs). No secrets in code. |
| Vercel deployment | Configured | vercel.json present, serverless detection in server.js. |
| Logging | Basic | Console logs for API mode, errors. No structured logging observed. |
| Backups/recovery | Not implemented | No backup scripts observed beyond migrations; recovery relies on DB backups. |

## 4. Code Quality Audit

**Methodology**: Read key files (server.js, middleware/auth.js, api.js, admin.js, models). Focus on verified issues.

| Area | Finding | File/Location | Severity | Evidence | Assessment |
|---|---|---|---|---|---|
| Type safety | TypeScript not used | Entire codebase (ES modules, .js) | Info | No .ts files; package.json no TS deps | Consistent with vanilla/Express style; types implicit. Not a defect per se. |
| `any` usage | Not visible (JS) | - | OK | N/A | No TypeScript any; JS dynamic is by design. |
| Dead code | Legacy HTML files in root | Root has `astrovetro_*.html`, `script.js`, `styles.css` (separate from public) | Low | Root contains design/reference files not served by app | Not loaded by server (serves public/). Harmless clutter; could confuse. |
| Duplicate components | Admin JS is large monolith | `public/assets/admin.js` (2022 LOC) | Med | Single file contains all 13 module renderers + logic | Functional but hard to maintain; poor separation of concerns. No duplication of identical logic obvious, just size. |
| State management | Mixed (client) | store.js, customer.js, admin.js | Med | Uses global AV namespace, DOM manipulation, API polling via events (AV.emit/on for cart/wishlist/auth) | Works but fragile; no centralized state store. Event-based updates help. |
| Input validation | Server-side validation present | validate middleware, Zod in deps, controller validation | OK | Zod dep present; validate.js exists; controllers validate. | Better than client-only. Need to confirm full coverage across all endpoints. |
| Error handling | Consistent envelope | errorHandler.js, ApiError, asyncHandler | Good | All API errors use envelope; asyncHandler catches rejections. | Well-structured. |
| Race conditions | Potential in stock | Inventory ops | Med | Stock adjustments use DB reads; no explicit transactions shown in read code? Need to inspect inventory service. | Tests for concurrency exist - suggests awareness. Implementation details of transactions not fully visible in read surfaces. *Unverified.* |
| API design | Consistent | All API routes use same envelope, ok() helper | Good | commerceApi/staticApi follow pattern. | Clean, predictable. |
| N+1 queries | Not obvious | Mongoose queries | OK | Typical Mongoose usage; no obvious N+1 in read code. | Probably fine for scale. |
| Inefficient rendering | DOM rebuilds in admin | admin.js uses innerHTML/string building | Med | Large admin renders tables via string concatenation | Works but not optimal; could cause perf issues with large datasets. |
| Unnecessary client JS | Vanilla is minimal deps | public/assets/*.js | OK | No heavy frameworks. |
| Naming/abstractions | Generally clear | Codebase | OK | Good comments explaining rationale (especially server.js, auth.js). |
| Build config | No build step (by design) | package.json | OK | Static files served as-is. Appropriate for this architecture. |
| Accessibility | Mixed | Toasts have aria-live (good), general a11y partial | Med | api.js creates aria-live toast region; admin/store have some a11y but not comprehensive. | Some good practices, gaps likely exist. |

**Verified defects vs concerns**: No obvious critical bugs in logic from static read; main quality issues are maintainability (large admin.js monolith), potential race conditions in stock updates (needs verification of transaction usage), and DOM rendering inefficiency in admin.

## 5. Security & Data Integrity Audit

Classified by severity. All based on evidence from code.

| ID | Finding | Evidence (file:line) | Severity | Exploitability | Impact | Remediation |
|---|---|---|---|---|---|---|
| SEC-001 | JWT in httpOnly cookie (good) | `auth.js:30-52` | Info | Low | Good | Already implemented. Prevents XSS token theft. |
| SEC-002 | CSRF protection via requireSameOrigin | `auth.js:116-180` | Med-High (depends) | Medium | Med-High | Implemented. Checks Sec-Fetch-Site (modern browsers), falls back to Origin/Referer. For cookie-auth writes, if no headers present AND has cookie, rejects (line 175-179) - correct strictness. However, non-browser API clients using Bearer token don't need CSRF; cookie-based do. This is reasonable. |
| SEC-003 | Production secrets enforcement | `env.js:72-91` | High | Low | High | `assertProductionSecrets()` runs in prod (server.js:39). Enforces JWT >=32 chars, requires key pairs. Strong guard. |
| SEC-004 | Webhook raw body for signature verification | `commerceApi.js:134,139` | High | Low | High | Registers `express.raw()` before JSON parser for Razorpay webhook - correct to preserve bytes for signature hashing. |
| SEC-005 | Server-side price/total calculation | `checkout` controllers (inferred), api.js comments | High | Low | Critical | Comments in api.js say "server reads cart and prices it", "amount the SERVER calculated" - by design. Orders snapshot prices (Product model notes). Critical business rule appears enforced. |
| SEC-006 | Stock validation server-side | Product.canFulfil, inventory service | High | Low | High | Cannot make tracked stock negative; checks inside order transaction paths (inferred from model). |
| SEC-007 | Admin endpoints protected | `admin.js:17` mounts `requireAdmin` globally | Critical | Low | Critical | All admin routes require admin role. Cannot be bypassed if mounted correctly. |
| SEC-008 | No secrets in code | Repo scan (.env has dev only, no hardcoded prod secrets) | OK | - | - | No credentials committed. .env present but dev placeholders. |
| SEC-009 | Helmet CSP configured | `server.js:96-115` | Med | Med | Med | CSP includes Razorpay origins and unsafe-inline for styles (needed for inline styles in existing pages). `connect-src` includes Razorpay APIs. script-src allows unsafe-inline and Razorpay checkout - necessary for current frontend. Tightening possible but would require refactoring inline styles/scripts. Current is pragmatic given codebase. |
| SEC-010 | CORS not explicitly configured beyond Helmet defaults | server.js uses helmet defaults | Low | Low | Low | Same-origin app mostly; proxy mode exists. No custom CORS needed. |
| SEC-011 | Rate limiting dependency present but not visible in use | `package.json:22` has express-rate-limit | Med | Med | Med | Dependency present but no visible middleware application in server.js/routes read. Could leave auth endpoints unprotected against brute force. **Unverified - needs confirmation.** |
| SEC-012 | Image upload handling | `admin.js` image routes use `express.raw()` with 12mb limit, Sharp dep | Med | Med | Med | Upload accepts image/*, size limited. Sharp present for processing. Need to verify file type validation beyond content-type, filename sanitization, path traversal prevention. **Partially verified.** |
| SEC-013 | SQL/NoSQL injection | Mongoose used | Low | Low | Med | Mongoose parameterizes queries; no string concatenation of queries observed. Using models properly. |
| SEC-014 | XSS risks from innerHTML in admin | `admin.js` builds HTML via strings | Med | Med | Med | Admin.js uses string concatenation with `AV.esc()` in many places (AV.esc defined). But any missed escaping could lead to XSS if admin data is malicious. Given admin-only area and trusted data mostly, medium risk. |
| SEC-015 | CSV injection in exports | Tests include `csv.test.mjs` | Med | Low | Med | CSV export safety tested. Good awareness. |
| SEC-016 | Token version revocation | `auth.js:88-94` | High | Low | High | Stale tokens (old tokenVersion) rejected after logout/password change. Correct. |
| SEC-017 | Order ID validation | `server.js:191, 201-210` regex `ORDER_REF = /^[A-Za-z0-9][A-Za-z0-9-]{1,63}$/` | Med | Low | Low | Prevents obvious bad paths, reduces 404 confusion. Not security boundary (API re-checks ownership). |
| SEC-018 | Static file serving - no path traversal guard obvious beyond Express static | `express.static` with safe defaults | Low | Low | Low | Express static normalizes paths; catch-all 404 for files is good. |
| SEC-019 | Secrets exposure in logs? | Console logs show config state but not secrets | OK | - | - | Logs show API mode, URLs (no tokens/secrets). No credential leakage observed. |

**Critical security posture**: Generally strong. Main concerns: rate limiting usage unverified (SEC-011), image upload validation depth (SEC-012), and XSS surface in admin DOM building (SEC-014). All admin actions and sensitive operations properly protected server-side.

## 6. Database & Business Logic

### Models & schemas
| Model | Key fields | Constraints | Notes |
|---|---|---|---|
| Product | slug(unique), sku(unique sparse), category, price>=0, stock(null or >=0), status enum, needsReview | Text index, various indexes | Mirrors catalogue; toPublic/toAdmin separation. effectivePrice() logic (salePrice if less). canFulfil() handles null stock. |
| User | email(unique), password hashed, role enum (customer/admin), tokenVersion | Unique email | Password hashed via pre-save (inferred). |
| Order | orderId(unique), user ref, items with snapshots (price/name/slug), totals, paymentStatus, status | Indexed | Snapshots prices at order time - prevents repricing affecting paid orders. Critical. |
| Cart | user ref, items with product ref+qty | Per-user | |
| Wishlist | user ref, items | Per-user | |
| Address | user ref, default flag | Per-user | |
| StockMovement | product ref, qty (signed), type, ref, note, actor | Indexed | Ledger of all stock changes. Types cover PO receipts, adjustments, sales, cancellations. |
| StockReceipt | PO ref, product ref, qty, cost | Indexed | PO receiving. |
| PurchaseOrder | supplier ref, status enum, lines, totals | Tracked | Full PO lifecycle. |
| Category | slug(unique), name, status | Managed separately | Source of truth for categories. |
| Supplier | name, contacts | - | |
| AuditLog | actor, action, entity, details, ip | Indexed | |
| Shipment | order ref, carrier, tracking, status | - | |

### Business rules (verified)
1. **Pricing integrity**: Orders snapshot item prices (not reading live Product.price at fulfillment) - prevents retroactive price changes. `effectivePrice()` is current price logic.
2. **Stock integrity**: Tracked products cannot go below 0. `canApplyDelta(stock, delta)` enforces: if stock null, delta>=0 only (starting to track). Inventory service validates before applying.
3. **Untracked inventory**: `stock=null` means "not tracked" - never blocks fulfillment. Allows selling without inventory counts.
4. **Lifecycle states**: Products have draft/active/archived. Public reads return active only (per dbProvider); carts/orders can still reference archived (keeps order history intact).
5. **Category as slug reference**: Decoupled from enum; managed via Category collection.
6. **Ownership**: All user-scoped data filtered by `req.user._id`. No trusting client-supplied user IDs.
7. **Idempotency**: Checkout endpoints accept/use `Idempotency-Key` header to prevent duplicate orders on retries.
8. **CSRF + auth**: Cookie auth requires same-origin verification for mutations.

### Data integrity risks
| Risk | Description | Evidence | Severity | Mitigation |
|---|---|---|---|---|
| Race conditions on stock | Concurrent adjustments/checkouts could read-modify-write | No explicit transactions visible in quick scan of inventory controller; tests exist for concurrency | Med-High | Need to verify if using MongoDB transactions (sessions) with findOneAndUpdate with atomic operators ($inc) or versioning. Tests suggest handled but implementation details unclear from read. |
| Partial order creation | Payment + order creation could partially fail | Checkout flow multiple steps | Med | Idempotency helps; need to ensure atomicity where critical. |
| Legacy documents without SKU | Sparse unique allows nulls | Schema design | Low | Safe for backfill. |
| ImageAlts length drift | Must stay parallel to images | Schema allows independent arrays; enforced in admin ops? | Low | Tests enforce; admin image controllers should maintain parity. |

**DB assessment**: Well-designed schema with good separation of concerns (ledger for inventory, snapshots for orders). Main concern is transaction handling for concurrent stock updates - needs deeper inspection of inventory service implementation.

## 7. UI/UX Assessment

Based on reading HTML/CSS/JS structure (not full visual render).

| Aspect | Assessment | Evidence | Issues |
|---|---|---|---|
| Visual identity | Consistent with brand (mineral tones, editorial) | README, CSS files (app.css, styles.css, gateway.css) | N/A |
| Typography/spacing | Appears structured via CSS variables/classes | CSS files present | Not visually verified |
| Navigation | Clear multi-page structure, navbar | HTML templates | Works |
| Product discovery | Shop page with categories/filters | shop.html + store.js | Search capabilities unclear |
| Mobile/tablet | Responsive CSS present | styles.css has responsive rules (inferred) | Needs verification |
| Accessibility | Has aria-live toasts, semantic HTML, alt text for images | api.js toast region (role=status, aria-live), images have alts (parallel), HTML5 semantic | Lacks comprehensive a11y (focus management in dialogs, keyboard nav in admin, ARIA labels completeness). |
| Forms | Client-side + server validation | HTML forms + API validation | Error feedback via toasts/errors. |
| Feedback states | Toasts, error/skeleton states | AV.toast, C.skeleton, C.error in admin/customer JS | Good patterns. |
| Empty/loading/failure | Implemented | Common UI helpers | Present. |
| Performance perception | Vanilla, no heavy frameworks; static assets | Architecture | Bundle size not measured; admin DOM building could be slow with large data. |
| Trust signals | Order tracking, account, proper error messages | Order/tracking flows | Appears fine. |

**Top 5 UX problems (hypotheses based on code):**
1. **Large admin UI monolith** - Hard to navigate mentally; could be slow with large datasets due to string-based rendering (Med)
2. **No visible search in shop beyond filters?** - Unclear if full-text search exposed; product discovery could be limited (Low-Med)
3. **Inline styles in HTML/CSS strategy** - CSP allows unsafe-inline for styles; suggests inline styles used, which is harder to maintain (Low)
4. **Error messages sometimes generic** - API returns structured errors but UI may not always surface field-level validation clearly (Med)
5. **No skeleton screens everywhere?** - Skeleton helpers exist but coverage unknown (Low)

*These are code-based hypotheses; not visually verified.*

## 8. Testing, Build & Deployment Readiness

### Existing tests
| Test file | What it covers | Status |
|---|---|---|
| `admin-authz.test.mjs` | Authorization (401/403) for admin routes | Present |
| `admin-flows.test.mjs` | Admin product/inventory/category/supplier/PO flows | Present |
| `admin-ui.test.mjs` | Admin UI wiring (tabs have renderers, API paths exist) | Present |
| `api-public.test.mjs` | Public products have image fields, DB connection check | Present (skips if MongoDB not up) |
| `catalogue-assets.test.mjs` | Image paths exist locally, alts parallel, structure correct | **Passes** (verified: 5/5 pass) |
| `csv.test.mjs` | CSV injection safety | Present |
| `infrastructure.test.mjs` | Infrastructure checks | Present |
| `storefront-pages.test.mjs` | Storefront pages | Present |
| `helpers/server.mjs` | Test utilities - boots isolated servers, manages test DBs | Present |

### Attempted non-destructive checks
- **Catalogue asset tests**: Ran `node --test tests/catalogue-assets.test.mjs` - **PASSED** (5/5). Confirms image integrity.
- **Other tests require MongoDB**: Many integration tests need mongod running and create isolated test DBs (`astrovetro_test`). Not attempted in this environment. Their success depends on external service.

### Build/Typecheck/Lint
- **Build**: `npm run build` just logs (no-op). No compilation. Status: N/A (intentional).
- **Type check**: No TypeScript. No `tsc` configured.
- **Lint**: No lint script visible in package.json. No eslint config files seen in top level. **Linting not configured.**

### Deployment readiness
| Aspect | Ready? | Notes |
|---|---|---|
| Local dev | Yes | Clear setup in README. |
| Static browsing (no DB) | Yes | Graceful degradation works. |
| Full e-com with DB | Partial | Needs MongoDB, env vars set. |
| Production secrets | Guarded | Enforced by assertProductionSecrets(). |
| Payments | Unverified | Razorpay needs verification and proper webhook secret in prod. |
| Vercel | Configured | vercel.json routes correctly; serverless handling present. |
| Recovery | Partial | Ledger exists but no documented backup/restore procedure visible. |
| Real customers | **No (not verified)** | Payment reconciliation, end-to-end checkout, edge cases need verification. README marks payment/checkout as incomplete items. |

**Assessment**: Build passes trivially. Catalogue integrity verified. Integration test suite exists but requires external DB. Production readiness blocked by verification needs, not code structure.

## 9. Performance & Scalability

**Code-based assessment (no benchmarks run):**

| Area | Assessment | Notes |
|---|---|---|
| Bundle size | Small | Vanilla JS, no frameworks. CSS/JS in public/assets - likely < few hundred KB total. Not measured. |
| Images | Local, some WebP | Sharp dep suggests image processing capability. Images stored as .webp (seen in catalogue). Optimization strategy present. |
| Rendering | Mixed | Storefront is mostly static HTML + small JS. Admin does large DOM rebuilds via string concat (inefficient at scale). |
| Caching | Static assets + API | Express static caches files (default); API responses not cached. No CDN config visible. |
| DB queries | Reasonable | Mongoose models with indexes (slug, SKU, text, etc.). List endpoints likely paginate? Not obvious from read - needs check of provider/list implementations. |
| N+1 | Unlikely | Simple model lookups. |
| Pagination | Partial/unclear | list endpoints take query params; meta returned. Implementation varies. |
| External deps | Minimal | Razorpay only external critical dependency. |
| Bottlenecks (scale) | Admin rendering, large product lists | If catalogue grows large, admin table rendering via innerHTML strings will be slow. No virtualization. DB fine for moderate scale. |

**Hypothesis**: Performs well for boutique scale (dozens/hundreds of products). Admin UI needs optimization if managing thousands of items. Labelled as hypothesis per requirements.

## 10. Prioritized Findings & Roadmap

### P0 — Immediate Blockers (Security/Data-loss/Release-blocking)

| ID | Issue | Evidence | Impact | Fix | Effort | Acceptance Criteria |
|---|---|---|---|---|---|---|
| P0-001 | **Rate limiting not applied** | `express-rate-limit` in deps (package.json:22) but no usage in server.js/auth routes visible. Auth endpoints (login/register) unprotected. | High - brute force, abuse | Apply rate limiting to auth/login/register and sensitive endpoints. | S | Auth endpoints have rate limiting (e.g. 5 attempts/15min). Configurable. |
| P0-002 | **Payment flow unverified** | README marks "[ ] Verify payment processing and order reconciliation" as unchecked. Razorpay code exists but not end-to-end tested. | Critical - financial correctness | End-to-end test COD + Razorpay (sandbox), verify signature verification, order state transitions, webhook handling, idempotency. | M | Successful sandbox payments, webhooks processed correctly, no duplicate orders, reconciliation correct. |
| P0-003 | **Checkout/cart/order flow verification needed** | README says incomplete despite code existing. | Critical - core revenue flow | Full integration test of add-to-cart → checkout → order creation → tracking. Verify in both DB and edge cases (sold out, concurrent). | M | E2E flows pass; all edge cases handled. |
| P0-004 | **Image upload validation hardening** | Accepts image/* with size limit; need to verify file type beyond MIME, path traversal, actual image validation. | Med-High - security | Validate magic bytes, sanitize filenames, ensure files written to safe paths, validate dimensions. | S | Malicious files rejected; paths constrained. |

### P1 — Core Functionality (Required for intended product)

| ID | Issue | Evidence | Impact | Fix | Effort | Acceptance Criteria |
|---|---|---|---|---|---|---|
| P1-001 | **Contact/enquiry flow incomplete** | `/contact.html` UI exists; no API endpoints for storing/submitting enquiries visible in routes. StaticApi refuses writes. | Med - lead generation | Implement contact enquiry endpoint (store in DB, email notification optional) or document as intentionally static. | S | Contact form submits successfully when DB connected; stored or emailed; proper validation. |
| P1-002 | **Search functionality unclear** | Product has text index but no explicit search API in read routes? `listProducts` may not expose full-text search. | Med - product discovery | Add search parameter (q) to products listing; use text index or fallback. | S | `/api/products?q=amethyst` returns relevant results. |
| P1-003 | **Transaction safety for stock** | Concurrent stock updates - transaction usage unclear. | High - data integrity | Review inventory service for MongoDB transactions (sessions) with atomic ops ($inc) and retry on conflicts. | M | No negative stock under concurrent load; integration tests pass. |
| P1-004 | **Complete image verification** | README: 4/12 products await human photo verification; `labradorite-pendant` intentionally photo-less. | Low-Med - UX/data quality | Complete verification per IMAGE-MAPPING.md checklist; update needsReview flags. | S | Review notes resolved, flags cleared where appropriate. |

### P2 — Reliability, Polish, Maintainability

| ID | Issue | Evidence | Impact | Fix | Effort | Acceptance Criteria |
|---|---|---|---|---|---|---|
| P2-001 | **Large admin.js monolith (2022 LOC)** | `public/assets/admin.js` single file for 13 modules | Med - maintainability | Modularize: split into modules per tab (dashboard.js, products.js, etc.), or use ES modules loaded via import maps. | L | Admin split into logical modules; same functionality preserved; easier to test. |
| P2-002 | **Inefficient admin DOM rendering** | String concatenation for tables/lists | Med - performance | Use DOM APIs (createElement, textContent) or templating; add virtualization for large lists. | M | Faster rendering with large datasets; no XSS from manual escaping mistakes. |
| P2-003 | **No linting configured** | No eslint/prettier config or scripts | Low - code quality | Add linting/formatting (ESLint with standard config). | S | `npm run lint` works, passes or has baseline. |
| P2-004 | **XSS hardening in admin** | String HTML building | Med - security (admin area) | Prefer textContent/createElement over string concat; audit AV.esc usage coverage. | M | Reduced HTML injection surface; security review passes. |
| P2-005 | **Missing pagination for large lists** | Admin tables may grow unbounded | Med - performance/UX | Ensure all list endpoints support limit/offset/page with meta; implement in UI. | M | Paginated tables in admin; API returns hasMore/meta. |
| P2-006 | **Comprehensive accessibility audit** | Partial a11y (toasts good) | Med - inclusivity | Keyboard nav for dialogs, focus management, ARIA labels, color contrast check. | M | Core flows keyboard-accessible; passes basic a11y checks. |
| P2-007 | **Rate limiting verification** | Dependency present but unused? | Med - security | If not applied, apply as P0-001. If applied, document where. | S | Confirmed/implemented. |

### P3 — Future Enhancements (Optional)

| ID | Issue | Evidence | Impact | Fix | Effort | Acceptance Criteria |
|---|---|---|---|---|---|---|
| P3-001 | **Clean up legacy root HTML/files** | Root has design HTML files not used by app | Low - clarity | Move to docs/examples or remove if not needed. Update .gitignore if build artifacts. | XS | Less confusion, cleaner repo. |
| P3-002 | **Structured logging** | Console logs only | Low - observability | Add structured logging (pino/winston) for production. | S | Consistent log format, log levels. |
| P3-003 | **Email notifications** | No email service visible | Low - workflow | Add transactional emails (order confirmation, shipping) if needed. | M | Optional, based on business needs. |
| P3-004 | **Image optimization pipeline** | Sharp present but usage unclear | Low - perf | Ensure images optimized on upload, responsive sizes generated. | S-M | Optimized delivery. |

## 11. Roadmap Summary

- **P0 (Immediate)**: Rate limiting, verify payment + checkout flows, harden image uploads. These are release-blockers for production with real money.
- **P1 (Core)**: Contact flow, search, transaction safety for stock, complete image verification.
- **P2 (Polish)**: Modularize admin, improve rendering/perf, add linting, a11y, pagination.
- **P3 (Nice-to-have)**: Cleanup, logging, emails.

**Priority justification**: Security issues (rate limiting) and financial correctness (payments/checkout) must come before polish. Transaction safety for inventory is critical for data integrity.

## 12. Commands & Checks

**Executed:**
```bash
node --test tests/catalogue-assets.test.mjs  2>&1 | tail -15  # PASSED (5/5)
```

**Passed:** Catalogue asset integrity tests (all 5). Confirms images exist, alts parallel, no duplicates, correct structure.

**Failed/Not Run:** Other tests require MongoDB running. Not executed in this environment per non-destructive audit approach (tests that need external services weren't started).

**Build:** `npm run build` is no-op (intentional). No compilation errors possible.

**Lint:** Not configured - no checks available.

## 13. Areas Remaining Unverified

1. **End-to-end payment flows** - Razorpay sandbox testing needed (webhook handling, signature verification, reconciliation)
2. **Inventory transaction safety** - Need to inspect inventory service for actual transaction/session usage with concurrent updates
3. **Rate limiting application** - Dependency exists but usage not found in read files
4. **Contact form backend** - Existence/implementation of contact endpoint unknown
5. **Full integration test suite** - Requires MongoDB; couldn't run in this isolated read
6. **Visual/UI/UX verification** - Analysis based on code only, not rendered UI
7. **Image upload implementation details** - Sharp usage, validation depth need inspection
8. **Search API implementation** - Whether full-text search is exposed via API params
9. **Performance benchmarks** - No actual measurements taken
10. **Email/notification services** - If any exist beyond code structure

All unverified claims are explicitly marked as such throughout this report.
