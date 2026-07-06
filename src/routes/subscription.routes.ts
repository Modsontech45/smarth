import { Router } from 'express';
import { verifyJWT as authenticate } from '../middleware/auth.middleware';
import { getSubscription, updatePlan } from '../controllers/subscription.controller';

const router = Router();

router.get('/',      authenticate, getSubscription);
router.put('/plan',  authenticate, updatePlan);

export default router;
