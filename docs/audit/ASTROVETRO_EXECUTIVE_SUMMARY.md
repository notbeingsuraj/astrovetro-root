# ASTROVETRO — Executive Summary

## Product Overview

**Astrovetro** is a bespoke, editorial-style e-commerce storefront for crystal jewellery and spiritual/ritual products. The brand identity emphasizes "crystals, rituals, celestial living" with a refined, mineral-inspired aesthetic. The digital experience is designed as an intentional retail experience rather than a generic template, featuring a split-screen gateway (Crystals | Rituals), product-led storytelling, and considered interactions.

*Note:* Some business objectives inferred from copy/structure are labeled as inferences; the repository is primarily a software project with product data present.

## Business Model & Customers (evidence-based)

- **Offering**: Physical products (jewellery with stones/metals) sold via the storefront. Product catalogue contains items like rings, bracelets, pendants, earrings, chains, carvings etc. (see `src/data/catalogue.js`).
- **Target**: Customers interested in crystals/rituals/spiritual goods — inferred from naming/intentions ("Calm", "Protection", "Intuition", etc.) rather than explicit marketing copy beyond README.
- **Commerce model**: Retail e-commerce with potential for admin-managed catalogue, inventory, orders. Payment integration groundwork exists (Razorpay). Cart/checkout/order functionality implemented in the DB-backed commerce API; in static/no-DB mode these writes return 503 with `DATABASE_NOT_CONFIGURED` (by design).

## Current Product Offering & Website Experience

**Frontend pages** (in `public/`): `index.html` (gateway/home), `home.html`, `shop.html`, `product.html`, `cart.html`, `checkout.html`, `account.html`, `orders.html`, `order.html`, `tracking.html`, `wishlist.html`, `admin.html`, `about.html`, `journal.html`, `readings.html`, `booking.html`, `contact.html`, `article.html`, `legal.html`, `404.html`. Routes are handled by `server.js` (special handling for orders/tracking with validation, redirects for legacy paths).

**Key UX elements:**
- Split-screen gateway (`home.html`/index behavior) leading to Crystals/Shop and Rituals content
- Product listing with filtering by category/intentions
- Product detail pages with image galleries
- Shopping cart, wishlist (DB-backed)
- Customer account with addresses, orders
- Admin desk with 13 modules
- Image assets stored locally under `public/assets/img/products/{slug}/` with parallel alts; one product (`labradorite-pendant`) intentionally has no photos

## User Journeys

1. **Discovery**: Land on gateway (`/`) → navigate to Crystals/Shop → browse catalogue (from static provider or DB)
2. **Product exploration**: View product details, see images/pricing/intentions
3. **Purchase (DB-connected)**: Add to cart/wishlist, proceed to checkout, place order (COD or Razorpay session), receive confirmation; order history/tracking available
4. **Purchase (no DB)**: Browsing works; cart/checkout/orders/auth writes return 503 `DATABASE_NOT_CONFIGURED`
5. **Admin**: Sign in as admin → `/admin.html` with modules for dashboard, orders, products, inventory, movements, categories, suppliers, purchase orders, image library, reports, users, audit log, settings

## Administrative Workflows

Rich admin system (`src/routes/admin.js`, controllers under `src/controllers/admin*`, frontend `public/assets/admin.js` ~2000 lines):
- **Dashboard/Overview**: Metrics via admin controller
- **Orders**: List/detail, update status, attach shipment, add tracking events
- **Products**: CRUD, archive/restore, image management
- **Inventory**: Table view, stock adjustments, untrack products, movements ledger
- **Categories/Suppliers/Purchase Orders**: Full management flows
- **Image Library**: Upload/delete images
- **Reports**: CSV exports (products, inventory, movements, orders) with CSV injection safety considerations (tested)
- **Admin Users**: List users, change roles
- **Audit Log/Settings**: System views

All admin routes protected by `requireAdmin` middleware (JWT cookie auth + role check). Inventory operations go through inventory service with ledger tracking.

## Technology Stack & Architecture

**Frontend**: Vanilla HTML5/CSS3/JavaScript (no framework). Client code in `public/assets/` (api.js, store.js, customer.js, admin.js). Styling in CSS files.

**Backend**: Node.js + Express (ES modules). Server in `server.js` with flexible API mounting:
- If `API_TARGET` set → proxy to external backend
- Else if `AV_DISABLE_API=1` → all /api return 503 (testing)
- Else if no `DATABASE_URL` → mount `staticApi.js` (catalogue reads only, writes return 503)
- Else → attempt DB connect; if fails fallback to `staticApi.js`, if succeeds mount `commerceApi.js` with full routes

**Database**: MongoDB with Mongoose models (User, Product, Cart, Wishlist, Address, Order, StockMovement, StockReceipt, PurchaseOrder, Supplier, Category, AuditLog, Shipment). Product schema mirrors catalogue structure and has inventory fields (stock, sku, reorder thresholds), status (draft/active/archived), toPublic/toAdmin serialization.

**Auth**: JWT in httpOnly cookie (`av_token`), CSRF protection via `requireSameOrigin` (checks Sec-Fetch-Site/Origin/Referer), role-based access, tokenVersion for revocation.

**Integrations**: Razorpay (payments groundwork), Sharp (image processing in deps), bcryptjs for passwords, helmet for security headers, express-rate-limit present.

**Deployment**: Vercel config present (`vercel.json` routes to server.js), serverless-aware (doesn't listen if Vercel/Lambda env vars detected).

## Development & Deployment State

- **Local dev**: `npm start` runs `server.js` on port 5173. With local MongoDB and env vars, full commerce mode possible. First admin created via `scripts/create-admin.mjs`. 
- **Tests**: `npm test` runs `node --test tests/` with self-booting servers on dedicated ports against isolated `astrovetro_test` DB (dropped in teardown). Tests cover authz, admin flows, catalogue assets, CSV safety, infrastructure, storefront pages. Catalogue asset tests all pass.
- **Migrations/scripts**: `migrate:catalogue`, `migrate:users`, `smoke:admin`, `review:images` scripts exist.
- **Static hosting mode**: Works without DB for browsing catalogue.
- **Production**: `env.assertProductionSecrets()` enforces JWT secret requirements and Razorpay key pairing in production; Vercel deployment supported.

## Strongest Implemented Capabilities

1. **Robust architecture with graceful degradation** - Smart fallback between proxy/static/DB modes; DB failures fall back to static catalogue rather than crashing
2. **Comprehensive admin system** - Full CRUD for products/inventory/categories/suppliers/POs, orders management, reporting, audit log, image library
3. **Inventory management with ledger** - Stock tracking with StockMovement/StockReceipt models, atomic operations, low stock detection, untrack support, movements history
4. **Security-conscious auth** - httpOnly cookies, CSRF protection, role checks, token revocation via tokenVersion, same-origin checks
5. **Well-structured API design** - Consistent envelope `{success, data, meta}`, proper error handling, idempotency for checkout
6. **Test coverage for critical areas** - Authz, admin flows, inventory concurrency, CSV injection safety, catalogue asset integrity
7. **Thoughtful UX details** - Accessibility considerations (aria-live toasts), idempotency keys, proper 404 handling, order/tracking route validation

## Biggest Limitations & Unresolved Dependencies

1. **Payment flow incomplete/needs verification** - Razorpay integration code exists (controllers/routes), but "Verify payment processing and order reconciliation" is unchecked in README roadmap
2. **Cart/checkout/order management marked incomplete** - README says "[ ] Connect cart, checkout, and order management" though code exists in commerceApi; may need verification/testing in full flow
3. **Environment/configuration** - Needs MongoDB for full functionality; Razorpay credentials for live payments; production secrets must be set
4. **Some products unverified** - 4 of 12 products await human photo verification per README; `labradorite-pendant` intentionally has no photos
5. **Static mode limitations** - No accounts/orders/cart/wishlist in static mode (503 by design)
6. **Image review pending** - Image mapping done by CLIP but needs human verification

## Overall Maturity Assessment

**Maturity Level: Beta/MVP-leaning Beta**

- **Core infrastructure**: Solid - auth, routing, admin system, inventory ledger are well-implemented
- **Catalogue/browsing**: Production-ready in terms of structure
- **E-commerce transactions**: Implemented but needs verification (payment reconciliation, edge cases)
- **Testing**: Good coverage of critical paths
- **Production readiness**: Blocked by needing proper env configuration, DB setup, payment verification, and possibly completing cart/checkout verification. Not ready for real customers without verification of payment flows and end-to-end testing.

## Non-Technical Explanation (for a founder)

Astrovetro is an elegant online store for crystal jewellery and ritual items. It looks polished with a unique, gallery-like feel. Behind the scenes, it has a powerful admin system to manage products, inventory, orders, and suppliers. You can browse the shop without a database, but to take real orders and payments, it needs to be connected to a database and payment provider. The core building blocks are there, but payment processing and full order flow need verification before going live with real customers.

## Technical Summary (for an engineer)

Express app serving static files from `public/` with API routes mounted dynamically based on configuration. Two API modes: static (read-only catalogue from `src/data/catalogue.js`) and commerce (full MongoDB-backed API via Mongoose). Rich domain model with inventory ledger (StockMovement/StockReceipt), purchase orders, categories, suppliers. Admin dashboard is a large vanilla JS SPA consuming REST APIs. Auth uses JWT httpOnly cookies with CSRF protection via origin checks. Comprehensive test suite with isolated test DBs. Deployment-ready for Vercel with serverless handling. Main gaps are payment flow verification and ensuring production configuration is complete.
