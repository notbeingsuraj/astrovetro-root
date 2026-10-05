/* Cart routes. Every one requires a session, because the cart is a server-side
   document keyed to a user — there is no anonymous cart to fall back to, and no
   user id is accepted from the client. */
import { Router } from 'express';
import * as ctrl from '../controllers/cartController.js';
import { requireAuth } from '../middleware/auth.js';
import { writeLimiter } from '../middleware/validate.js';

const router = Router();
router.use(requireAuth);

router.get('/', ctrl.getCart);
router.post('/items', writeLimiter, ctrl.addItem);
router.patch('/items/:productId', writeLimiter, ctrl.updateItem);
router.delete('/items/:productId', writeLimiter, ctrl.removeItem);
router.delete('/', ctrl.clearCart);

export default router;
