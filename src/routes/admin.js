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
