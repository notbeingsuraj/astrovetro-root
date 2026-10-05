/* Wishlist routes. Same rule as the cart: the list belongs to the signed-in
   account and the product is identified by its real id. */
import { Router } from 'express';
import * as ctrl from '../controllers/wishlistController.js';
import { requireAuth } from '../middleware/auth.js';
import { writeLimiter } from '../middleware/validate.js';

const router = Router();
router.use(requireAuth);

router.get('/', ctrl.getWishlist);
router.post('/:productId', writeLimiter, ctrl.addToWishlist);
router.delete('/:productId', writeLimiter, ctrl.removeFromWishlist);
router.post('/:productId/move-to-cart', writeLimiter, ctrl.moveToCart);

export default router;
