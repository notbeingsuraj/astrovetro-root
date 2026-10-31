# Astrovetro Studio — implementation and handover

Status: implemented and tested locally. The existing storefront, checkout,
payments, cart, wishlist, orders and inventory ledger were not replaced.

This document describes what was added, why it is shaped this way, what is
deferred, how to run it, and what is still an operational or security
limitation.

---

## 1. What the Studio is

`/admin.html` is a single-page editorial desk for the existing Astrovetro
Express/Mongo application. It is visually separate from the storefront but uses
the same server, database, authentication, media library and inventory service.

The Studio covers:

| Section | What it does |
|:--|:--|
| Overview | Existing dashboard metrics |
| Orders | Existing order list/detail, status transitions and shipment tracking |
| Products | Full create/edit, draft/published/archived, SEO, tags, type, images, delete guard |
| Categories | Taxonomy CRUD, description/image/SEO, archive/restore |
| Collections | Merchandising shelves, membership, archive, delete with reassignment |
| Rituals | Structured content, materials, steps, images, related products/collections, SEO, lifecycle |
| Inventory | Existing atomic ledger; no second stock source |
| Stock Movements | Existing ledger view |
| Suppliers / Purchase Orders | Existing inventory purchasing flow |
| Media Library | Upload, preview, search/filter, reuse, unused detection, guarded deletion |
| Blog | Journal drafts and publishing; public `/journal` and `/article` stay compatible |
| Website Content | Structured homepage copy and contact details |
| Reports, Admin Users, Audit Log, Settings | Existing operational sections |

Only sections with real routes and real views are listed. There are no dead
sidebar buttons.

---

## 2. Original architecture (before this work)

- `server.js` serves the static storefront from `public/` and mounts the API.
- Express with MongoDB/Mongoose, but the database is optional. Without
  `DATABASE_URL`, the storefront reads `src/data/catalogue.js` through
  `src/providers/staticProvider.js`.
- `src/providers/dbProvider.js` is the database-backed equivalent. Both
  providers share the same response contracts.
- Authentication is a signed JWT in an httpOnly, SameSite=Lax cookie
  (`av_token`). `requireAdmin` protects every admin route. State-changing
  cookie requests are checked by `requireSameOrigin`.
- Inventory is authoritative through `src/services/inventoryService.js`, which
  writes an append-only movement ledger and updates `Product.stock` atomically.
- Orders own their status machine; payment state is changed only by trusted
  server-side Razorpay verification/webhook code.
- Images live under `public/assets/img/`; the existing upload controller checks
  magic bytes, generates WebP derivatives with `sharp`, and refuses to delete a
  referenced file.
- The admin desk already existed for products, categories, inventory,
  suppliers, purchase orders, orders, media, reports, users, audit and settings.

The Studio extends that application. It does not add a second backend, a second
inventory model, or a second order/payment system.

---

## 3. What changed

### 3.1 Backend

- New models: `Collection`, `Ritual`, `BlogPost`, `SiteContent`.
- New controllers:
  - `adminCollectionController`
  - `adminRitualController`
  - `adminBlogController`
  - `adminContentController`
- Extended `Product` with `productType`, `currency`, `seoTitle`,
  `seoDescription`, `publishedAt`, `previousSlugs`; serialisers updated.
- Extended `Category` with `description`, `image`, `seoTitle`,
  `seoDescription`; public/admin serialisers added.
- Extended `adminProductController` with the new fields, previous-slug
  handling, collection-aware admin detail, collection filtering, and guarded
  permanent deletion.
- Extended `adminImageController` so the library and deletion checks also see
  ritual and journal references.
- Added public routes for collections, rituals and homepage content to both
  API providers.
- Extended `dbProvider` with DB-backed collections, rituals, journal posts,
  homepage content, collection filtering and previous-slug resolution.
  `staticProvider` returns honest empty editorial shapes when no database is
  configured.
- Added boot seeding for categories, homepage content and starter journal posts
  (mirroring the existing static articles). Collections and rituals are not
  seeded: there is no real content to invent.
- `/rituals` and `/rituals/:slug` are served by `server.js`.
  `/collections/:slug` redirects to the existing shop filter so stock, search
  and sorting behave identically.
- Product and article pages apply editable SEO fields; the homepage binds the
  editable content document.

### 3.2 Studio UI

`public/assets/admin.js` gained Collections, Rituals, Blog and Website Content
views, plus the new product/category fields. The sidebar shell and scoped
styling are in `public/admin.html`.

The collection delete flow now handles the server’s `409` by opening a
reassignment dialog: choose another collection, move the products, then delete.
If there is no other collection, the UI tells the editor to archive instead.

### 3.3 Storefront

- `public/rituals.html` and `public/ritual.html` render rituals as escaped
  plain text.
- `public/home.html` reads `/api/content/homepage`.
- `public/shop.html` accepts `?collection=<slug>`.
- `public/product.html` and `public/article.html` use SEO title/description.
- Existing journal pages keep working because blog field names mirror the
  static article shape.

### 3.4 Tests

- Added `tests/studio.test.mjs` (8 integration tests).
- Extended `tests/admin-ui.test.mjs` cover for the new views/routes.
- Made `tests/api-public.test.mjs` self-contained: it now seeds a disposable
  database instead of depending on a developer’s local data.
- Added `imageAlts` to seeded products, matching the catalogue.

---

## 4. Feature status

### Implemented

- Dedicated Studio shell with only implemented sections.
- Product CRUD with draft/published/archived lifecycle; `active` is displayed
  as “Published”.
- Server-enforced public visibility: only `active` products, rituals and posts
  resolve publicly; old slugs keep working.
- SKU uniqueness and slug uniqueness; sale price validation via schema.
- Product images: upload, assign, reorder, primary-by-order, replace, remove.
- SEO fields for products, categories, collections, rituals and posts.
- Product hard delete refused when an order references the product; otherwise
  join rows are pulled from collections, carts, wishlists and rituals.
- Categories and collections kept separate. Collection membership lives only
  in `Collection.products`.
- Collection deletion refused while in use; server supports
  `?reassignTo=<collectionId>`, and the Studio UI exposes that choice.
- Rituals stored as structure (arrays/steps), not HTML. Materials, steps,
  duration, preparation, related products/collections, images, tags, SEO.
- Ritual copy refuses medical and guaranteed-outcome claims at the controller
  boundary.
- Journal drafts are private; publishing sets `publishedAt` once; archiving
  hides the post, and archived posts do not fall back to a static copy.
- Website content is a fixed schema: plain text, validated internal/https
  links, no arbitrary HTML, JavaScript or unknown keys.
- Media library covers products, rituals and posts; referenced files cannot be
  deleted.
- Inventory remains ledger-only; product edits never write stock.
- Orders/payments untouched; no admin control can invent a payment state.
- Audit lines recorded for Studio mutations.
- Existing storefront pages and checkout remain in place.

### Deferred / intentionally not built

- Rich-text/HTML editing. Deliberately refused: these fields are plain text.
- Scheduled publishing, editorial revisions/version history, multi-language.
- Image cropping/focal points, automatic alt-text generation, CDN delivery.
- Bulk product actions, CSV import, product variants.
- Blog comments, RSS, tag archives.
- Fine-grained admin roles (the existing single `admin` role is retained).
- MFA and external identity providers.
- Automated database/media backups.
- Live payment testing. Razorpay keys are not part of this work.
- A second stock system, second order system or new checkout. None was added.

---

## 5. Data model changes

Existing collections/tables are MongoDB collections.

### Extended `Product`

| Field | Purpose |
|:--|:--|
| `productType` | `crystal \| jewellery \| tarot \| object \| other` |
| `currency` | `INR` today |
| `seoTitle`, `seoDescription` | Public search/social copy |
| `publishedAt` | Set once when first published |
| `previousSlugs` | Old slugs still resolve publicly |

`status` remains `draft | active | archived`; the UI calls `active` “Published”.

### Extended `Category`

| Field | Purpose |
|:--|:--|
| `description` | Category copy |
| `image` | Local media-library path |
| `seoTitle`, `seoDescription` | Search/social copy |

### New `Collection`

`slug`, `name`, `description`, `image`, `products[]` (ObjectIds), `sortOrder`,
`active`, `featured`, `seoTitle`, `seoDescription`, timestamps.

Membership is stored only here. Product documents do not keep a duplicate list.

### New `Ritual`

`title`, `slug`, `previousSlugs`, `intro`, `description`, `purpose`,
`preparation`, `duration`, `materials[]`, `steps[{title, body}]`, `images[]`,
`imageAlts[]`, `relatedProducts[]`, `relatedCollections[]` (slugs),
`linkedProduct`, `tags[]`, `featured`, `status`, `publishedAt`, SEO fields,
timestamps.

### New `BlogPost`

`title`, `slug`, `previousSlugs`, `excerpt`, `content` (plain text),
`image`, `imageAlt`, `author`, `category`, `tags[]`, `featured`, `status`,
`publishedAt`, SEO fields, timestamps.

### New `SiteContent`

One document per placement key (currently `homepage`) with fixed
`homepage` and `contact` subdocuments. Unknown keys and HTML are not accepted.

---

## 6. API surface added

All admin routes are under `requireAdmin`.

### Admin

| Method | Path |
|:--|:--|
| GET/POST | `/api/admin/collections` |
| GET/PATCH/DELETE | `/api/admin/collections/:id` |
| PUT | `/api/admin/collections/:id/products` |
| POST | `/api/admin/collections/:id/archive` / `restore` |
| GET/POST | `/api/admin/rituals` |
| GET/PATCH/DELETE | `/api/admin/rituals/:id` |
| PUT | `/api/admin/rituals/:id/images` |
| POST | `/api/admin/rituals/:id/archive` / `restore` |
| GET/POST | `/api/admin/blog` |
| GET/PATCH/DELETE | `/api/admin/blog/:id` |
| POST | `/api/admin/blog/:id/archive` / `restore` |
| GET/PUT | `/api/admin/content/homepage` |
| GET/PUT | `/api/admin/content/:key` |
| DELETE | `/api/admin/products/:id` |

### Public

| Method | Path |
|:--|:--|
| GET | `/api/collections` |
| GET | `/api/collections/:slug` |
| GET | `/api/rituals` |
| GET | `/api/rituals/:slug` |
| GET | `/api/content/homepage` |
| GET | `/api/products?collection=<slug>` |

Public reads only return `active` documents and only active related products.
Draft and archived content is private.

---

## 7. Security decisions

- **Server-side authorization.** Every admin route is behind `router.use(requireAdmin)`.
  The UI is not the authority; hiding a button is cosmetic.
- **No browser-supplied roles.** The role comes from the authenticated user
  record/JWT, never from the request body.
- **CSRF.** Cookie-authenticated writes must carry a same-origin
  `Sec-Fetch-Site` or `Origin`/`Referer`; cookie requests with none are refused.
- **Session cookie.** httpOnly, SameSite=Lax, `Secure` in production, seven-day
  expiry. Password hashing remains bcrypt.
- **Input validation.** Zod schemas bound every Studio input; regex search
  terms are escaped; ObjectIds are validated before use. No raw query object is
  passed to MongoDB.
- **Content safety.** Rituals, posts and site content refuse `<` and `>` at the
  controller boundary. Public pages render text with escaping. There is no
  stored HTML path.
- **Links.** Editable CTA links accept only an internal absolute path (`/...`,
  not `//...`) or an `https://` URL.
- **Images.** Uploads require JPEG/PNG/WebP magic bytes, are capped at 12 MB,
  and are re-encoded as WebP derivatives. Stored paths must resolve inside
  `public/assets/img`.
- **Deletion.** A referenced image cannot be deleted. A product referenced by
  an order cannot be hard-deleted. A populated collection cannot be deleted
  without explicit reassignment.
- **Publishing.** Public providers gate on `status === 'active'` and old slugs
  remain readable. Drafts are private.
- **Payments.** Untouched. Payment state still changes only through trusted
  server verification/webhook code; the Studio does not offer a “mark as paid”
  control.
- **Audit.** Studio mutations call the existing audit service.

### Unresolved security / operational issues

These are known and should be addressed before a high-traffic or
multi-instance production launch:

1. **Single admin role.** There is no least-privilege separation between an
   editor who writes blog posts and an admin who changes users or stock.
2. **No MFA.** A stolen admin password is enough to sign in. Auth rate limiting
   slows guessing but does not stop credential stuffing with valid credentials.
3. **In-memory rate limits.** `express-rate-limit` state is per process. Multiple
   instances each have their own bucket; use a shared store (Redis) for strict
   global limits.
4. **Proxy IP handling.** No `trust proxy` setting is configured in
   `server.js`. Behind a reverse proxy, limits may key on the proxy address
   unless the host is configured correctly.
5. **Media on local disk.** Images are written to `public/assets/img/`. This is
   not durable on ephemeral/serverless filesystems and is not shared between
   instances. Use a persistent volume or object storage before horizontal
   scaling. Deletion is permanent; backups are the operator’s responsibility.
6. **No malware scanning.** Magic-byte validation and re-encoding reduce the
   risk, but originals are preserved. If untrusted editors are added, scan
   uploads or strip originals.
7. **Audit log integrity.** The audit trail lives in MongoDB and is append-only
   from the application, but a database administrator can alter it. Export to an
   external log sink if that threat matters.
8. **Claim screening is a denylist.** It catches obvious “cures/treats/
   guarantees” language; it is not a legal or medical review. Editorial review
   is still required.
9. **No backups.** Database and media backups are deployment concerns and are
   not automated here.
10. **Storefront static fallback.** With no database, editorial APIs return
    empty data and writes are refused. This is honest, not a degraded CMS.

---

## 8. Setup

### Requirements

- Node.js 22+ (the suite runs on Node 26 locally)
- MongoDB 6+ (local `mongod` or Atlas free tier)
- npm

### Local

```bash
cd Astrovetro-production
npm install

# Local MongoDB (example)
mongod --dbpath /tmp/av-mongo-data --logpath /tmp/av-mongo-log/mongod.log --fork

cp .env.example .env
# Edit .env: set DATABASE_URL/MONGODB_URI and a JWT_SECRET.

npm start
```

First boot on an empty database seeds:

- the 12-product catalogue (with image alt text),
- categories,
- homepage content defaults,
- the starter journal posts.

Collections and rituals start empty by design.

### Create the first admin

No admin password is seeded or committed.

```bash
node scripts/create-admin.mjs you@example.com
# or, non-interactively:
AV_ADMIN_PASSWORD='a-long-unique-password' node scripts/create-admin.mjs you@example.com
```

Then open `http://localhost:5173/admin.html` and sign in.

### Production

1. Use a Node host with a **writable persistent disk** for `public/assets/img/`
   plus MongoDB. Do not deploy uploads to an ephemeral serverless filesystem.
2. Set `NODE_ENV=production`, `DATABASE_URL`, a 32+ character `JWT_SECRET`,
   `FRONTEND_URL`, `TRUST_PROXY`, and optionally Razorpay keys.
3. Terminate TLS at the host/proxy. The session cookie is `Secure` in
   production.
4. Run `node scripts/create-admin.mjs` once against the production database.
5. Start with `npm start` (or your process manager equivalent).
6. Configure database and media backups.
7. **Required:** Set `TRUST_PROXY` to match your reverse proxy topology so
   rate limits and `req.ip` see the real client address (see `.env.example`).
8. **Optional:** Set `STORAGE_ADAPTER` to use external object storage (e.g., `s3`,
   `r2`, `supabase`). Defaults to `local` which uses the persistent disk.

No paid service is required for the Studio itself. MongoDB Atlas free tier,
local MongoDB, or any existing Mongo instance is sufficient within its limits.

---

## 9. Tests

Run the full suite:

```bash
npm test
```

Latest result:

```text
tests 55
suites 3
pass 55
fail 0
```

The Studio suite alone:

```bash
node --test tests/studio.test.mjs
```

It covers:

- anonymous access refused for every Studio collection;
- product SEO fields survive publishing and partial PATCHes;
- draft products do not resolve publicly;
- category copy survives a partial edit;
- collection cover-image rejection, membership filtering, and delete refusal;
- collection reassignment moves products before deletion;
- rituals refuse HTML and medical/guaranteed-outcome claims;
- draft rituals are private; published rituals expose structure and related products;
- draft posts are private; published posts expose content; archived posts hide;
- homepage content edits, unsafe-link rejection, and partial saves.

Live smoke against a running, seeded dev server:

```bash
AV_ADMIN_EMAIL=you@example.com AV_ADMIN_PASSWORD='…' npm run smoke:admin
```

The smoke exercises the existing admin routes, the new Studio list/content
routes, public editorial APIs and the storefront pages. It creates and archives
one throwaway product and records ledger movements; those are real dev-data
writes by design.

`npm test` uses disposable `astrovetro_*_test` databases and drops them in
teardown. It never touches the developer database.

---

## 10. Media storage constraints

- Accepted uploads: JPEG, PNG, WebP. Maximum 12 MB.
- Derivatives: `-large.webp` (max 1600 px) and `-thumb.webp` (max 480 px).
- The uploaded original is preserved alongside the derivatives.
- Files live under `public/assets/img/library/`; product/legacy images live
  under `public/assets/img/products/<slug>/`.
- The database stores public paths only.
- Deleting a derivative set refuses if any product, ritual or post still uses
  any sibling.
- Local disk is not replicated. For multiple app instances or serverless
  hosting, move media to object storage and keep the same path contract, or
  serve media through a CDN backed by durable storage.

---

## 11. Free-tier constraints

- **MongoDB Atlas free tier:** limited storage, RAM and connections. The audit
  log and inventory movements grow forever; prune/export them or plan a paid
  tier before they approach the cap.
- **Serverless hosts (e.g. Vercel):** the filesystem is ephemeral/read-only.
  Uploaded images will not survive a deploy or be shared across instances.
  This project’s image model assumes a persistent disk.
- **`sharp`:** image processing needs memory and CPU. The 12 MB cap and
  single-size derivatives keep this modest, but very small instances can still
  time out on large uploads.
- **Razorpay:** payment processing is not free (per-transaction fees). It is
  optional; without keys checkout refuses rather than faking a payment.
- No paid CMS, theme, plugin, search service, email service or analytics was
  added.

---

## 12. Files

### Added

- `src/models/Collection.js`
- `src/models/Ritual.js`
- `src/models/BlogPost.js`
- `src/models/SiteContent.js`
- `src/controllers/adminCollectionController.js`
- `src/controllers/adminRitualController.js`
- `src/controllers/adminBlogController.js`
- `src/controllers/adminContentController.js`
- `src/data/siteContent.js`
- `src/utils/content.js`
- `src/utils/media.js`
- `public/rituals.html`
- `public/ritual.html`
- `tests/studio.test.mjs`
- `docs/STUDIO.md`
- `.env.example`

### Modified (principal)

- `server.js`
- `src/routes/admin.js`
- `src/api/commerceApi.js`
- `src/api/staticApi.js`
- `src/providers/dbProvider.js`
- `src/providers/staticProvider.js`
- `src/controllers/adminProductController.js`
- `src/controllers/adminCategoryController.js`
- `src/controllers/adminImageController.js`
- `src/models/Product.js`
- `src/models/Category.js`
- `src/db/seed.js`
- `public/assets/admin.js`
- `public/admin.html`
- `public/home.html`
- `public/shop.html`
- `public/product.html`
- `public/article.html`
- `scripts/smoke-admin.mjs`
- `tests/admin-ui.test.mjs` (if present in the working tree)
- `tests/api-public.test.mjs`

---

## 13. Known trade-offs

- **Plain text instead of a rich-text editor.** This is the central safety
  trade-off. Editors get structure (paragraphs, steps, lists), not arbitrary
  markup.
- **Collections store membership, products do not.** One authoritative list;
  the cost is a join when showing a product’s collections.
- **Product deletion is deliberately narrow.** Order history must remain
  readable, so a sold product can be archived but not deleted.
- **Rituals and collections are not seeded.** Empty states are real; the Studio
  is where the first ones are created.
- **`active` is the stored published state.** The UI label is “Published” to
  match editorial language without changing the existing enum or APIs.
