import { Router } from 'express';
import { getEnergyStats } from '../controllers/energy.controller';
import { verifyJWT } from '../middleware/auth.middleware';

const router = Router();
router.use(verifyJWT);

/**
 * @swagger
 * /api/energy:
 *   get:
 *     summary: Consommation énergétique par période
 *     tags: [Énergie]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: period
 *         schema: { type: string, enum: [day, week, month, year], default: day }
 *       - in: query
 *         name: device_id
 *         schema: { type: integer }
 *         description: Filtrer sur un actionneur spécifique (optionnel)
 *     responses:
 *       200:
 *         description: Consommation par période et par appareil
 */
router.get('/', getEnergyStats);

export default router;
