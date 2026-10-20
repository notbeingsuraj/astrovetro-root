# ASTROVETRO — Project Context (Handoff Document)

*This document is designed for a new coding agent to understand the repository without rediscovering major architectural decisions.*

## 1. Product Purpose & Verified Requirements

**Astrovetro** is a bespoke e-commerce storefront for crystal jewellery and spiritual/ritual products (Crystals · Rituals · Celestial Living). 

**Verified facts:**
- Editorial-style experience with split-screen gateway (Crystals | Rituals), product-led storytelling
- Catalogue of physical products (jewellery: rings, bracelets, pendants, earrings, chains, carvings) with stone/metal attributes
- Product data includes intentions (Calm, Protection, Intuition, etc.) for filtering/storytelling
- Images stored locally under `public/assets/img/products/{slug}/` with parallel alt text; `labradorite-pendant` intentionally photo-less
- Admin-managed catalogue, inventory, orders, suppliers, purchase orders
- Supports COD and Razorpay payments (integration present, needs verification)
- Works in static mode (browse only) or full DB mode (accounts, cart, orders, admin)

**Inferred** (not verified as explicit requirements): Target audience is spiritually-minded customers; brand positioning as luxury/artisan. Treat as inference.

## 2. Architecture Overview

### Runtime Modes (server.js)
Server dynamically selects API behavior:
1. `API_TARGET` set → proxy `/api` to external backend (http-proxy-middleware)
2. `AV_DISABLE_API === '1'` → all `/api` return 503 `API_UNAVAILABLE` (testing)
3. No `DATABASE_URL`/`MONGODB_URI` → mount `src/api/staticApi.js` (read-only catalogue)
4. DB URL present → `connectDB()` attempts connection. If connected and seeded OK → mount `src/api/commerceApi.js`. If connection fails → fallback to `staticApi.js` with error log.

**Key design**: Graceful degradation - DB outage doesn't take site offline, falls back to catalogue browsing.

### Entry Points
- **Server**: `server.js` (ES module). Listens on PORT (default 5173) unless serverless (Vercel/Lambda).
- **Client**: Static HTML in `public/` + JS modules in `public/assets/` (api.js, store.js, customer.js, admin.js)
- **API**: `/api/*` handled by selected provider

### Data Flow
- Catalogue reads: `GET /api/products`, `/api/products/:slug`, `/api/services/*`, `/api/articles/*`, `/api/testimonials` → served by provider
- Auth: JWT in httpOnly cookie `av_token`, issued by `issueToken()`, verified by `resolveUser()`, revoked via `tokenVersion`
- CSRF: `requireSameOrigin` on non-GET requests (checks Sec-Fetch-Site/Origin/Referer)
- Admin: All `/api/admin/*` require `requireAdmin` (auth + role check)
- Orders: Validated routes `/orders/:orderId`, `/tracking/:orderId` with regex `ORDER_REF = /^[A-Za-z0-9][A-Za-z0-9-]{1,63}$/`

## 3. Important Files & Modules

### Backend Core
| File | Purpose | Notes |
|---|---|---|
| `server.js` | App setup, routing, API mounting | Study this first - controls entire behavior |
| `src/api/commerceApi.js` | Full commerce API | Webhook on raw body (line 139), JSON parser after, CSRF after, routes mounted in order |
| `src/api/staticApi.js` | Read-only catalogue API | All writes return 503 DATABASE_NOT_CONFIGURED |
| `src/config/env.js` | Environment config | Production secret validation in `assertProductionSecrets()` |
| `src/middleware/auth.js` | Auth/CSRF/RBAC | JWT cookie auth, tokenVersion revocation, requireSameOrigin CSRF |
| `src/middleware/errorHandler.js` | Error formatting | Standard ApiError handling |
| `src/providers/dbProvider.js` | DB data provider | Implements same interface as static provider |

### Models (src/models/)
| Model | Purpose | Critical Notes |
|---|---|---|
| `Product.js` | Products/catalogue | `stock` null = untracked; `canFulfil()`, `effectivePrice()`, `toPublic()`/`toAdmin()` serialization; `isLowStock()` with defaults |
| `User.js` | Users/auth | Roles (customer/admin), `tokenVersion` for revocation |
| `Order.js` | Orders | **Snapshots prices** at order time; paymentStatus, status tracking |
| `Cart.js`/`Wishlist.js` | Shopping | Per-user, product references |
| `Address.js` | Customer addresses | |
| `StockMovement.js`/`StockReceipt.js` | Inventory ledger | All stock changes tracked |
| `PurchaseOrder.js`/`Supplier.js`/`Category.js` | Procurement/catalogue mgmt | |
| `AuditLog.js`/`Shipment.js` | Audit/tracking | |

### Controllers
- `authController.js` - login/register/logout
- `cartController.js`/`wishlistController.js`/`addressController.js` - Customer commerce
- `orderController.js`/`checkoutController.js` - Orders & payments (webhook, session, confirm)
- `accountController.js` - Profile management
- `admin*.js` - Split by domain (products, inventory, categories, suppliers, purchase orders, images, reports, system)

### Frontend (public/assets/)
| File | Purpose | Notes |
|---|---|---|
| `api.js` | HTTP wrapper, API client, event bus | Single place for fetch; handles 401s (drops session), CSRF implicit via cookies; cart/wishlist/auth events; checkout with idempotency keys |
| `store.js` | Storefront UI logic | Product listing, cart/wishlist interactions |
| `customer.js` | Account/orders UI | Customer dashboard |
| `admin.js` | Admin dashboard (2022 LOC) | **Large monolith** - all admin modules in one file. Study structure before modifying. |

### Data & Config
- `src/data/catalogue.js` - Static catalogue (12 products). Source of truth for static mode, mirrors DB structure.
- `docs/IMAGE-MAPPING.md` - Image mapping methodology and review checklist
- `scripts/create-admin.mjs` - Create/reset admin (no seeded password)
- `tests/helpers/server.mjs` - Test server bootstrap

## 4. Implemented, Partial, Mocked, Missing Features

### Implemented (verified)
- **Static browsing**: Full catalogue browsing without DB
- **Auth system**: JWT httpOnly cookies, CSRF protection, role-based access, token revocation
- **Admin dashboard**: All 13 modules (dashboard, orders, products, inventory, movements, categories, suppliers, POs, images, reports, users, audit, settings)
- **Inventory management**: Stock tracking with ledger, adjustments, movements, low stock alerts, untrack, POs/receipts
- **Product catalogue**: Full CRUD, images, categories, SKUs, status lifecycle
- **DB-backed commerce**: Cart, wishlist, addresses, orders, checkout (COD + Razorpay structure)
- **Order tracking**: Order history, detail, tracking with events
- **Security**: Helmet, CSRF, RBAC, production secret validation, webhook raw body
- **Tests**: Comprehensive test suite (catalogue assets pass)

### Partially Implemented
- **Payments**: Razorpay code exists but needs verification (webhook, confirm, reconciliation)
- **Search**: Text index exists on Product, unclear if fully exposed via API params
- **Reports/Analytics**: Basic CSV exports and dashboard exist
- **Pagination**: Some endpoints support it, consistency unclear
- **Rate limiting**: Dependency present, not visibly applied
- **Audit logging**: Model exists, coverage extent unclear

### UI-only / Mocked
- **Contact form**: UI exists (`contact.html`) but no backend endpoint to process enquiries (writes return 503 in static/DB modes if not implemented)
- **Some dashboard metrics**: Need to verify if all computed server-side vs client-side

### Not Implemented (not found)
- **Email notifications**: No mailer visible
- **Full CRM for leads/enquiries**: Only user management exists
- **Advanced analytics**: Basic reporting only
- **Automated backups**: No backup scripts

## 5. Known Bugs & Technical Debt

### Verified Concerns
1. **Admin.js monolith (2022 LOC)** - Maintainability issue, not a bug
2. **Rate limiting missing** - Security concern (dependency unused)
3. **Payment verification needed** - Functional correctness concern
4. **Image upload validation** - Needs hardening beyond MIME type
5. **Transaction safety for stock** - Race condition risk, tests exist but implementation unclear
6. **Large root directory clutter** - Legacy HTML files confuse structure

### Potential Issues to Watch
- **admin.js string HTML building**: XSS risk if escaping missed; `AV.esc()` exists but coverage varies
- **Concurrent inventory operations**: Need to verify atomic operations/transactions
- **CSP allows unsafe-inline**: Necessary for current inline styles/scripts but less secure
- **Static mode writes silently fail with 503**: By design but UI needs to handle gracefully (api.js has `AV.needsDatabase()` helper)

### Non-issues (by design)
- No build step - intentional for static serving
- `labradorite-pendant` has no photos - intentional per catalogue comments/tests
- Static mode is read-only - intentional degradation
- Root has legacy HTML - not served by app

## 6. Environment & Integration Assumptions

### Required for full functionality
- **MongoDB**: `DATABASE_URL` or `MONGODB_URI` (default `mongodb://127.0.0.1:27017/astrovetro`)
- **Node.js**: ES modules supported
- **JWT secret**: `JWT_SECRET` required in production (min 32 chars)
- **First admin**: Created via `scripts/create-admin.mjs` (no seeded password)

### Optional integrations
- **Razorpay**: `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` for live payments; `RAZORPAY_WEBHOOK_SECRET` for webhooks. Half-config fails validation in prod.
- **API proxy**: `API_TARGET` to proxy to external backend
- **Testing**: `AV_DISABLE_API=1` disables all API calls

### Environment variables (from env.js)
```js
NODE_ENV, PORT, FRONTEND_URL, DATABASE_URL/MONGODB_URI,
JWT_SECRET, JWT_EXPIRES_IN (default 7d), COOKIE_NAME,
RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET
```

### Deployment assumptions
- Vercel serverless compatible (server.js checks for VERCEL/AWS_LAMBDA)
- `public/` served as static files
- Cookie auth requires `secure: true` in production (httpOnly, sameSite 'lax')
- HSTS set at edge on Vercel

## 7. Decisions That Should Not Be Changed Without Justification

### Architectural (critical)
1. **Hybrid API mode system** (server.js) - Graceful degradation is intentional; don't break fallback logic
2. **JWT in httpOnly cookies with CSRF protection** (auth.js) - Security model; changing to localStorage has XSS implications
3. **Server-side price calculation** - Orders must read prices from DB/cart server-side, never trust client
4. **Inventory as untracked when stock=null** - Allows selling without inventory counts; core business rule
5. **Order price snapshots** - Prevents price changes affecting existing orders
6. **Raw body for webhook before JSON parser** (commerceApi.js:139) - Required for signature verification; order is critical
7. **Admin routes under single `requireAdmin` middleware** (admin.js:17) - Security; don't move protection
8. **Static catalogue as fallback** - Prevents site going down on DB failure

### Data Model
9. **Product schema mirrors catalogue structure** - Maintains compatibility between static and DB modes
10. **Category as slug references, managed separately** - Decoupled design
11. **StockMovement/StockReceipt ledger** - Audit trail for inventory; don't bypass
12. **toPublic() excludes operational fields** - Security (costPrice, SKU, internal data not exposed)

### Security
13. **Production secret validation** - Don't weaken assertProductionSecrets()
14. **Ownership checks server-side** - Never trust client-supplied user IDs
15. **tokenVersion revocation** - Required for logout/password change security

## 8. Recommended Next Implementation Steps

### Immediate (P0)
1. **Apply rate limiting** to auth endpoints and consider global limiting. Use express-rate-limit with appropriate store for production.
2. **Verify payment flow end-to-end** in Razorpay sandbox - test session creation, webhook processing, confirm, idempotency, failure cases
3. **Test full checkout flow** - COD and Razorpay paths, inventory decrements, order creation, edge cases
4. **Harden image uploads** - Magic byte validation, filename sanitization, path traversal prevention

### Short-term (P1)
5. **Implement contact/enquiry endpoint** if lead capture needed, or document as out of scope
6. **Add search to product listing** using text index
7. **Review and harden inventory transactions** for concurrency (use sessions/atomic ops)
8. **Complete image verification** per IMAGE-MAPPING.md

### Medium-term (P2)
9. **Modularize admin.js** - Split into modules to improve maintainability
10. **Add linting** (ESLint) and fix any issues
11. **Improve admin DOM rendering** - Reduce string concatenation, improve performance
12. **Pagination** for all large lists
13. **Accessibility audit** and improvements

### Guidelines for changes
- **Read before changing**: Understand the full context of files you're modifying
- **Follow existing patterns**: Use ApiError, asyncHandler, envelope format, existing middleware
- **Test changes**: Run relevant tests; add tests if changing critical flows
- **Security first**: Never expose secrets, always validate server-side, maintain authz checks
- **Preserve degradation**: Don't break static/DB fallback behavior
- **Maintain compatibility**: Product shape must stay compatible between static and DB modes

## Quick Reference

- **Start server**: `npm start` (or `npm run dev`)
- **Run tests**: `npm test` (needs MongoDB for full suite)
- **Create admin**: `node scripts/create-admin.mjs email@example.com`
- **Test catalogue assets**: `node --test tests/catalogue-assets.test.mjs` (passes)
- **API modes**: Check startup logs to see which mode is active
- **Debug auth**: Check httpOnly cookie `av_token`, verify with `/api/auth/me` (requires auth)

This codebase is well-structured for a boutique e-commerce site with good separation of concerns, security awareness, and graceful degradation. Main areas needing attention are payment verification, rate limiting, and maintainability of the large admin UI.
