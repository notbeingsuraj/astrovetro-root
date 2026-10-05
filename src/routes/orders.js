/* Order history and detail. Read-only from the customer's side — there is no
   route here that creates or edits an order. Placing an order goes through
   /api/checkout, which is where the money and the stock are handled. */
import { Router } from 'express';
import * as ctrl from '../controllers/orderController.js';
import * as tracking from '../controllers/trackingController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/', ctrl.listOrders);

/* Tracking is declared BEFORE /:orderId. Express matches in registration order,
   and `/:orderId` would otherwise swallow `/AV-1048/tracking` and look for an
   order with that literal id. Sharing this router also means the order detail
   and the tracking page resolve ownership through one code path. */
router.get('/:orderId/tracking', tracking.getTracking);

router.get('/:orderId', ctrl.getOrder);

export default router;
