import { Router } from 'express';
import { getActuators, sendCommand } from '../controllers/actuators.controller';
import { getActuatorStats } from '../controllers/actuators.stats.controller';
import { verifyJWT } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/role.middleware';

const router = Router();
router.use(verifyJWT);

/**
 * @swagger
 * tags:
 *   name: Actionneurs
 *   description: États et commandes des actionneurs
 */

/**
 * @swagger
 * /api/actuators:
 *   get:
 *     summary: État de tous les actionneurs
 *     tags: [Actionneurs]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Liste des actionneurs avec leur état
 */
router.get('/', getActuators);

/**
 * @swagger
 * /api/actuators/command:
 *   post:
 *     summary: Envoyer une commande à un actionneur
 *     tags: [Actionneurs]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [device_id, state]
 *             properties:
 *               device_id: { type: integer, example: 2 }
 *               state:     { type: boolean, example: true }
 *     responses:
 *       200:
 *         description: Commande envoyée
 *       404:
 *         description: Actionneur introuvable
 */
router.post('/command', requireRole('ADMIN', 'USER'), sendCommand);

/**
 * @swagger
 * /api/actuators/stats:
 *   get:
 *     summary: Durée ON/OFF par période
 *     tags: [Actionneurs]
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
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 30, maximum: 100 }
 *     responses:
 *       200:
 *         description: Durées ON/OFF et nombre de basculements par période
 *       400:
 *         description: Période invalide
 */
router.get('/stats', getActuatorStats);

export default router;
