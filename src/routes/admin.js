/* Admin routes. requireAdmin is mounted with router.use, so every route below
   is covered by it and a new route cannot accidentally be left unguarded. */
import { Router } from 'express';
import * as ctrl from '../controllers/adminController.js';
import { requireAdmin } from '../middleware/auth.js';

const router = Router();
router.use(requireAdmin);

router.get('/dashboard', ctrl.dashboard);

router.get('/orders', ctrl.listAllOrders);
router.get('/orders/:orderId', ctrl.getOrderDetail);
router.patch('/orders/:orderId/status', ctrl.updateOrderStatus);
router.post('/orders/:orderId/shipment', ctrl.attachShipment);
router.post('/orders/:orderId/tracking-events', ctrl.addTrackingEvent);

router.patch('/products/:productId/inventory', ctrl.updateInventory);

export default router;
