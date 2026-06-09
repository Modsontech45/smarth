import { Router } from 'express';
import {
  getAutomations,
  getAutomationById,
  createAutomation,
  updateAutomation,
  deleteAutomation,
  toggleAutomation,
} from '../controllers/automations.controller';
import { verifyJWT }    from '../middleware/auth.middleware';
import { requireRole }  from '../middleware/role.middleware';

const router = Router();
router.use(verifyJWT);

router.get('/',          getAutomations);
router.get('/:id',       getAutomationById);
router.post('/',         requireRole('ADMIN', 'USER'), createAutomation);
router.put('/:id',       requireRole('ADMIN', 'USER'), updateAutomation);
router.delete('/:id',    requireRole('ADMIN', 'USER'), deleteAutomation);
router.patch('/:id/toggle', requireRole('ADMIN', 'USER'), toggleAutomation);

export default router;
