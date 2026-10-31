/* Admin routes. requireAdmin is mounted with router.use, so every route below
   is covered by it and a new route cannot accidentally be left unguarded. */
import { Router } from 'express';
import express from 'express';
import * as ctrl from '../controllers/adminController.js';
import * as products from '../controllers/adminProductController.js';
import * as inventory from '../controllers/adminInventoryController.js';
import * as categories from '../controllers/adminCategoryController.js';
import * as suppliers from '../controllers/adminSupplierController.js';
import * as purchaseOrders from '../controllers/adminPurchaseOrderController.js';
import * as images from '../controllers/adminImageController.js';
import * as collections from '../controllers/adminCollectionController.js';
import * as rituals from '../controllers/adminRitualController.js';
import * as blog from '../controllers/adminBlogController.js';
import * as content from '../controllers/adminContentController.js';
import * as reports from '../controllers/adminReportController.js';
import * as system from '../controllers/adminSystemController.js';
import { requireAdmin } from '../middleware/auth.js';

const router = Router();
router.use(requireAdmin);

/* ── Overview ──────────────────────────────────────────────────────────── */
router.get('/dashboard', ctrl.dashboard);
router.get('/inventory/dashboard', inventory.inventoryDashboard);
router.get('/audit', system.listAudit);
router.get('/settings', system.getSettings);

/* ── Orders (pre-existing) ─────────────────────────────────────────────── */
router.get('/orders', ctrl.listAllOrders);
router.get('/orders/:orderId', ctrl.getOrderDetail);
router.patch('/orders/:orderId/status', ctrl.updateOrderStatus);
router.post('/orders/:orderId/shipment', ctrl.attachShipment);
router.post('/orders/:orderId/tracking-events', ctrl.addTrackingEvent);

/* ── Products ──────────────────────────────────────────────────────────── */
router.get('/products', products.listProductsAdmin);
router.post('/products', products.createProduct);
router.get('/products/:productId', products.getProductAdmin);
router.patch('/products/:productId', products.updateProduct);
router.delete('/products/:productId', products.deleteProduct);
router.post('/products/:productId/archive', products.archiveProduct);
router.post('/products/:productId/restore', products.restoreProduct);

/* Legacy endpoint kept for compatibility. It now routes every write through
   the inventory service, so the ledger is recorded even for old clients. */
router.patch('/products/:productId/inventory', ctrl.updateInventory);

/* Product images: order decides which is primary (index 0). */
router.put('/products/:productId/images', images.setProductImages);
router.post('/products/:productId/images', images.addProductImages);
router.delete('/products/:productId/images/:index', images.removeProductImage);

/* ── Inventory ─────────────────────────────────────────────────────────── */
router.get('/inventory/table', inventory.inventoryTable);
router.get('/inventory/movements', inventory.listMovements);
router.post('/inventory/adjust/:productId', inventory.adjustProductStock);
router.post('/inventory/untrack/:productId', inventory.untrackProduct);

/* ── Categories ────────────────────────────────────────────────────────── */
router.get('/categories', categories.listCategories);
router.post('/categories', categories.createCategory);
router.patch('/categories/:slug', categories.updateCategory);
router.post('/categories/:slug/archive', categories.archiveCategory);
router.post('/categories/:slug/restore', categories.restoreCategory);

/* ── Collections ───────────────────────────────────────────────────────── */
router.get('/collections/options', collections.collectionOptions);
router.get('/collections', collections.listCollections);
router.post('/collections', collections.createCollection);
router.get('/collections/:collectionId', collections.getCollection);
router.patch('/collections/:collectionId', collections.updateCollection);
router.put('/collections/:collectionId/products', collections.setCollectionProducts);
router.post('/collections/:collectionId/archive', collections.archiveCollection);
router.post('/collections/:collectionId/restore', collections.restoreCollection);
router.delete('/collections/:collectionId', collections.deleteCollection);

/* ── Rituals ───────────────────────────────────────────────────────────── */
router.get('/rituals', rituals.listRituals);
router.post('/rituals', rituals.createRitual);
router.get('/rituals/:ritualId', rituals.getRitual);
router.patch('/rituals/:ritualId', rituals.updateRitual);
router.put('/rituals/:ritualId/images', rituals.setRitualImages);
router.post('/rituals/:ritualId/archive', rituals.archiveRitual);
router.post('/rituals/:ritualId/restore', rituals.restoreRitual);
router.delete('/rituals/:ritualId', rituals.deleteRitual);

/* ── Journal ───────────────────────────────────────────────────────────── */
router.get('/blog', blog.listBlogPosts);
router.post('/blog', blog.createBlogPost);
router.get('/blog/:postId', blog.getBlogPost);
router.patch('/blog/:postId', blog.updateBlogPost);
router.post('/blog/:postId/archive', blog.archiveBlogPost);
router.post('/blog/:postId/restore', blog.restoreBlogPost);
router.delete('/blog/:postId', blog.deleteBlogPost);

/* ── Website content ───────────────────────────────────────────────────── */
router.get('/content', content.listContent);
/* Explicit homepage routes so the admin bundle's literal call is matched by
   the route table check, and so the path reads as what it edits. */
router.get('/content/homepage', (req, res, next) => {
  req.params.key = 'homepage';
  return content.getContent(req, res, next);
});
router.put('/content/homepage', (req, res, next) => {
  req.params.key = 'homepage';
  return content.updateContent(req, res, next);
});
router.get('/content/:key', content.getContent);
router.put('/content/:key', content.updateContent);

/* ── Suppliers ─────────────────────────────────────────────────────────── */
router.get('/suppliers', suppliers.listSuppliers);
router.post('/suppliers', suppliers.createSupplier);
router.get('/suppliers/:supplierId', suppliers.getSupplier);
router.patch('/suppliers/:supplierId', suppliers.updateSupplier);
router.post('/suppliers/:supplierId/archive', suppliers.archiveSupplier);
router.post('/suppliers/:supplierId/restore', suppliers.restoreSupplier);

/* ── Purchase orders ───────────────────────────────────────────────────── */
router.get('/purchase-orders', purchaseOrders.listPurchaseOrders);
router.post('/purchase-orders', purchaseOrders.createPurchaseOrder);
router.get('/purchase-orders/:poId', purchaseOrders.getPurchaseOrder);
router.patch('/purchase-orders/:poId', purchaseOrders.updatePurchaseOrder);
router.post('/purchase-orders/:poId/send', purchaseOrders.sendPurchaseOrder);
router.post('/purchase-orders/:poId/cancel', purchaseOrders.cancelPurchaseOrder);
router.post('/purchase-orders/:poId/receive', purchaseOrders.receiveAgainstPurchaseOrder);
router.get('/purchase-orders/:poId/receipts', purchaseOrders.listReceipts);

/* ── Image library ─────────────────────────────────────────────────────── */
/* The upload route reads raw bytes; express.json() above only consumes
   application/json bodies, so the image stream is still intact here. */
router.post(
  '/images/upload',
  express.raw({ type: 'image/*', limit: '12mb' }),
  images.uploadImage
);
router.get('/images/library', images.listLibrary);
router.delete('/images/file', images.deleteLibraryFile);

/* ── Reports (CSV) ─────────────────────────────────────────────────────── */
router.get('/reports/products.csv', reports.exportProducts);
router.get('/reports/inventory.csv', reports.exportInventory);
router.get('/reports/movements.csv', reports.exportMovements);
router.get('/reports/orders.csv', reports.exportOrders);

/* ── Accounts ──────────────────────────────────────────────────────────── */
router.get('/users', system.listUsers);
router.patch('/users/:userId/role', system.setUserRole);

export default router;
