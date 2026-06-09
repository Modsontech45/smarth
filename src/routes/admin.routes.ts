import { Router } from 'express';
import {
  listUsers, updateUserRole, setUserRestrictions, deleteUser,
} from '../controllers/admin.controller';
import { verifyJWT }    from '../middleware/auth.middleware';
import { requireRole }  from '../middleware/role.middleware';

const router = Router();
router.use(verifyJWT);
router.use(requireRole('ADMIN'));

router.get('/users',                         listUsers);
router.put('/users/:id/role',                updateUserRole);
router.put('/users/:id/restrictions',        setUserRestrictions);
router.delete('/users/:id',                  deleteUser);

export default router;
