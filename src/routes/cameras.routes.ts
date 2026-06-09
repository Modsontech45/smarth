import { Router } from 'express';
import { getCameras, createCamera, updateCamera, deleteCamera } from '../controllers/cameras.controller';
import { verifyJWT }    from '../middleware/auth.middleware';
import { requireRole }  from '../middleware/role.middleware';

const router = Router();
router.use(verifyJWT);

router.get('/',     getCameras);
router.post('/',    requireRole('ADMIN', 'USER'), createCamera);
router.put('/:id',  requireRole('ADMIN', 'USER'), updateCamera);
router.delete('/:id', requireRole('ADMIN', 'USER'), deleteCamera);

export default router;
