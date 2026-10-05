/* Auth routes. Public to reach, guarded where it matters: /me needs a session,
   the credential endpoints are rate limited because they are the only ones
   worth attacking by guessing. */
import { Router } from 'express';
import * as ctrl from '../controllers/authController.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import { validate, authLimiter, signupLimiter } from '../middleware/validate.js';

const router = Router();

router.post('/register', signupLimiter, ctrl.register);
router.post('/login', authLimiter, ctrl.login);
router.post('/logout', optionalAuth, ctrl.logout);
router.get('/me', requireAuth, ctrl.me);

export default router;
