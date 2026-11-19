# Graph Report - Astrovetro-production  (2026-11-19)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 823 nodes · 2178 edges · 36 communities (34 shown, 2 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 36 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `9d20658b`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- ApiError
- server.mjs
- assets/admin.js
- mongoose
- package.json
- adminProductController.js
- storage.js
- customer.js
- .badRequest
- ApiError.js
- inventoryService.js
- .notFound
- adminController.js
- adminCollectionController.js
- adminRitualController.js
- store.js
- generate-image-review.mjs
- wishlistController.js
- cartService.js
- server.js
- staticApi.js
- adminBlogController.js
- orderController.js
- smoke-production.mjs
- dbProvider.js
- connect.js
- adminImageController.js
- razorpay.js
- seed.js
- scripts
- rateLimitStore.js
- adminContentController.js
- storage-b2.test.mjs
- vercel.json

## God Nodes (most connected - your core abstractions)
1. `recordAudit()` - 54 edges
2. `ApiError` - 40 edges
3. `mongoose` - 34 edges
4. `zod` - 24 edges
5. `asyncHandler()` - 22 edges
6. `fail()` - 19 edges
7. `dialog()` - 17 edges
8. `label()` - 17 edges
9. `products()` - 17 edges
10. `Product` - 17 edges

## Surprising Connections (you probably didn't know these)
- `main()` --calls--> `defaultSku()`  [EXTRACTED]
  scripts/migrate-catalogue.mjs → src/models/Product.js
- `apiPlan` --calls--> `dbReady()`  [EXTRACTED]
  server.js → src/db/connect.js
- `apiPlan` --calls--> `seedIfEmpty()`  [EXTRACTED]
  server.js → src/db/seed.js
- `insufficientStock()` --calls--> `ApiError`  [EXTRACTED]
  src/services/inventoryService.js → src/utils/ApiError.js
- `skuFromSlug()` --calls--> `defaultSku()`  [EXTRACTED]
  src/controllers/adminProductController.js → src/models/Product.js

## Import Cycles
- None detected.

## Communities (36 total, 2 thin omitted)

### Community 0 - "ApiError"
Cohesion: 0.06
Nodes (56): express, zod, addressSchema, createAddress, deleteAddress, findOwned(), listAddresses, makeDefault() (+48 more)

### Community 1 - "server.mjs"
Cohesion: 0.06
Nodes (34): __dirname, outDir, ROOT, timestamp, adapter, backupLocal(), backupS3(), __dirname (+26 more)

### Community 2 - "assets/admin.js"
Cohesion: 0.11
Nodes (65): adjustDialog(), archiveProduct(), assignDialog(), audit(), blog(), blogForm(), categories(), categoriesView() (+57 more)

### Community 3 - "mongoose"
Cohesion: 0.06
Nodes (44): dotenv@^18.0.5, dotenv, mongoose, email, [emailArg, ...flags], main(), promptPassword(), reset (+36 more)

### Community 4 - "package.json"
Cohesion: 0.08
Nodes (34): dependencies, @aws-sdk/s3-request-presigner@^3.450.0, bcryptjs@^3.0.3, cookie-parser@^1.4.7, cors@^2.8.6, express@^4.21.2, express-rate-limit@^8.7.0, file-type@^19.0.0 (+26 more)

### Community 5 - "adminProductController.js"
Cohesion: 0.10
Nodes (22): archiveCategory, categorySchema, createCategory, listCategories, restoreCategory, slugify(), archiveProduct, createProduct (+14 more)

### Community 6 - "storage.js"
Cohesion: 0.09
Nodes (12): adapters, checkStorageHealth(), getB2Client(), getS3Client(), IMG_ROOT, LIBRARY_DIR, localAdapter, MAGIC (+4 more)

### Community 7 - "customer.js"
Cohesion: 0.10
Nodes (12): bagTotals(), clearBusy(), error(), loading(), loadRazorpay(), onSubmit(), payWithRazorpay(), say() (+4 more)

### Community 8 - ".badRequest"
Cohesion: 0.11
Nodes (20): addProductImages, assertFilesExist(), removeProductImage, setProductImages, buildLines(), createPurchaseOrder, createSchema, getPurchaseOrder (+12 more)

### Community 9 - "ApiError.js"
Cohesion: 0.11
Nodes (19): changePassword, changePasswordSchema, deleteAccount, emailInUse(), getAccountSummary, updateProfile, updateProfileSchema, findOwnedOrder() (+11 more)

### Community 10 - "inventoryService.js"
Cohesion: 0.15
Nodes (20): updateInventory, adjustProductStock, untrackProduct, defaultSku(), lineSchema, PO_STATUS, PurchaseOrder, purchaseOrderSchema (+12 more)

### Community 11 - ".notFound"
Cohesion: 0.20
Nodes (20): deleteBlogPost, updateCategory, deleteCollection, updateOrderStatus, deleteLibraryFile, deleteProduct, updateProduct, cancelPurchaseOrder (+12 more)

### Community 12 - "adminController.js"
Cohesion: 0.11
Nodes (17): addTrackingEvent, attachShipment, dashboard, eventSchema, getOrderDetail, inventorySchema, listAllOrders, listSchema (+9 more)

### Community 13 - "adminCollectionController.js"
Cohesion: 0.16
Nodes (19): archiveCollection, bodySchema, collectionOptions, createCollection, getCollection, listCollections, listSchema, resolveProducts() (+11 more)

### Community 14 - "adminRitualController.js"
Cohesion: 0.19
Nodes (20): archiveRitual, assertNoHealthClaims(), bodySchema, createRitual, enrich(), getRitual, listRituals, listSchema (+12 more)

### Community 15 - "store.js"
Cohesion: 0.22
Nodes (18): add(), addToCartLocal(), clear(), footerHTML(), headerHTML(), hydrate(), load(), localCartView() (+10 more)

### Community 16 - "generate-image-review.mjs"
Cohesion: 0.13
Nodes (18): bySlug, catalogue, esc(), flagged, LIBRARY_DIR, libraryCells, libraryFiles, manifest (+10 more)

### Community 17 - "wishlistController.js"
Cohesion: 0.17
Nodes (16): addToWishlist, getOrCreateWishlist(), getWishlist, moveSchema, moveToCart, paramProductId(), productIdSchema, readWishlist() (+8 more)

### Community 18 - "cartService.js"
Cohesion: 0.17
Nodes (14): addLine(), clearCart(), getOrCreateCart(), readCart(), removeLine(), setLineQuantity(), cartPayload(), CURRENCY (+6 more)

### Community 19 - "server.js"
Cohesion: 0.13
Nodes (12): apiPlan, app, __dirname, isServerless, PORT, PUBLIC_DIR, validTrustProxyValues, router (+4 more)

### Community 20 - "staticApi.js"
Cohesion: 0.15
Nodes (11): mode, provider, router, getDbStatus(), isDbConnected(), dbProvider, getDataProvider(), mongoProvider (+3 more)

### Community 21 - "adminBlogController.js"
Cohesion: 0.21
Nodes (15): adminShape(), archiveBlogPost, bodySchema, createBlogPost, getBlogPost, listBlogPosts, listSchema, restoreBlogPost (+7 more)

### Community 22 - "orderController.js"
Cohesion: 0.25
Nodes (16): buildOrder(), checkoutCod, checkoutSchema, checkoutSession, commitInventory(), confirmPayment, findByIdempotency(), getOrder (+8 more)

### Community 23 - "smoke-production.mjs"
Cohesion: 0.39
Nodes (15): checkAdminAuth(), checkApiStatus(), checkAuthEndpoints(), checkCapabilities(), checkCorsAndSecurity(), checkHealth(), checkImageProxy(), checkRateLimiting() (+7 more)

### Community 24 - "dbProvider.js"
Cohesion: 0.22
Nodes (7): CONTACT_DEFAULTS, HOMEPAGE_DEFAULTS, Product, contactSchema, homepageSchema, SiteContent, siteContentSchema

### Community 25 - "connect.js"
Cohesion: 0.30
Nodes (11): drained, attemptConnection(), backoffWithJitter(), connectDB(), dbReady(), disconnectDB(), ensureConnected(), getConnectionState() (+3 more)

### Community 26 - "adminImageController.js"
Cohesion: 0.21
Nodes (10): sharp@^0.35.5, sharp, addImagesSchema, imagesPatchSchema, listLibrary, uploadImage, Ritual, ritualSchema (+2 more)

### Community 27 - "razorpay.js"
Cohesion: 0.21
Nodes (4): createProviderOrder(), fetchPayment(), fetchProviderOrder(), razorpay()

### Community 28 - "seed.js"
Cohesion: 0.32
Nodes (9): isConnected(), COPYABLE, seedCatalogue(), seedCategories(), seedIfEmpty(), seedJournal(), seedSiteContent(), BlogPost (+1 more)

### Community 29 - "scripts"
Cohesion: 0.18
Nodes (11): scripts, backup:db, backup:media, build, dev, migrate:catalogue, migrate:users, review:images (+3 more)

### Community 30 - "rateLimitStore.js"
Cohesion: 0.27
Nodes (6): createAuthLimiter(), createCheckoutLimiter(), createRateLimiter(), createRateLimitStore(), createSignupLimiter(), createWriteLimiter()

### Community 31 - "adminContentController.js"
Cohesion: 0.25
Nodes (10): assertKey(), bodySchema, contactSchema, ensure(), getContent, homepageSchema, KEYS, listContent (+2 more)

### Community 32 - "storage-b2.test.mjs"
Cohesion: 0.33
Nodes (5): @aws-sdk/client-s3@^3.450.0, @aws-sdk/client-s3, b2Adapter, mockS3, validPng

### Community 33 - "vercel.json"
Cohesion: 0.50
Nodes (3): builds, routes, $schema

## Knowledge Gaps
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `mongoose` connect `mongoose` to `ApiError`, `server.mjs`, `package.json`, `adminProductController.js`, `.badRequest`, `ApiError.js`, `inventoryService.js`, `adminController.js`, `wishlistController.js`, `server.js`, `dbProvider.js`, `connect.js`, `adminImageController.js`, `seed.js`?**
  _High betweenness centrality (0.105) - this node is a cross-community bridge._
- **Should `ApiError` be split into smaller, more focused modules?**
  _Cohesion score 0.056049213943950786 - nodes in this community are weakly interconnected._
- **Why does `ApiError` connect `ApiError` to `mongoose`, `adminProductController.js`, `storage.js`, `.badRequest`, `ApiError.js`, `inventoryService.js`, `.notFound`, `adminController.js`, `adminCollectionController.js`, `adminRitualController.js`, `wishlistController.js`, `cartService.js`, `adminBlogController.js`, `orderController.js`, `adminImageController.js`, `razorpay.js`, `adminContentController.js`?**
  _High betweenness centrality (0.079) - this node is a cross-community bridge._
- **Should `server.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.061971830985915494 - nodes in this community are weakly interconnected._
- **Why does `zod` connect `ApiError` to `mongoose`, `package.json`, `adminProductController.js`, `.badRequest`, `ApiError.js`, `.notFound`, `adminController.js`, `adminCollectionController.js`, `adminRitualController.js`, `wishlistController.js`, `adminBlogController.js`, `orderController.js`, `adminImageController.js`, `adminContentController.js`?**
  _High betweenness centrality (0.055) - this node is a cross-community bridge._
- **Should `assets/admin.js` be split into smaller, more focused modules?**
  _Cohesion score 0.10675990675990676 - nodes in this community are weakly interconnected._
- **Should `mongoose` be split into smaller, more focused modules?**
  _Cohesion score 0.05658381808566896 - nodes in this community are weakly interconnected._