/* Saved addresses. Mounted under /api/me so the ownership story is obvious from
   the path: these are sub-resources of the signed-in account. */
import { Router } from 'express';
import * as ctrl from '../controllers/addressController.js';
import { requireAuth } from '../middleware/auth.js';
import { writeLimiter } from '../middleware/validate.js';

const router = Router();
router.use(requireAuth);

router.get('/', ctrl.listAddresses);
router.post('/', writeLimiter, ctrl.createAddress);
router.patch('/:addressId', writeLimiter, ctrl.updateAddress);
router.post('/:addressId/default', writeLimiter, ctrl.setDefaultAddress);
router.delete('/:addressId', writeLimiter, ctrl.deleteAddress);

export default router;
