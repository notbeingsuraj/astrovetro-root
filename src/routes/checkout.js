/* Checkout. Three separate steps rather than one, because they fail for
   different reasons and the customer needs to be told which:

     POST /session   validate the bag, price it, create the provider order
     POST /cod       place a cash-on-delivery order directly
     POST /confirm   verify a card/UPI payment and settle the order

   The webhook is deliberately NOT in this file: it must not require
   authentication, because Razorpay calls it server-to-server with no session. */
import { Router } from 'express';
import * as ctrl from '../controllers/orderController.js';
import { requireAuth } from '../middleware/auth.js';
import { checkoutLimiter } from '../middleware/validate.js';

const router = Router();
router.use(requireAuth);

router.post('/session', checkoutLimiter, ctrl.checkoutSession);
router.post('/cod', checkoutLimiter, ctrl.checkoutCod);
router.post('/confirm', checkoutLimiter, ctrl.confirmPayment);

export default router;
