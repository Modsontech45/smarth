import { Router } from 'express';
import { getAlerts, getAlertById, resolveAlert } from '../controllers/alerts.controller';
import { verifyJWT } from '../middleware/auth.middleware';

const router = Router();
router.use(verifyJWT);

/**
 * @swagger
 * tags:
 *   name: Alertes
 *   description: Gestion des alertes de sécurité
 */

/**
 * @swagger
 * /api/alerts:
 *   get:
 *     summary: Lister toutes les alertes
 *     tags: [Alertes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: resolved
 *         schema: { type: boolean }
 *         description: "Filtrer : true = résolues, false = en cours"
 *       - in: query
 *         name: severity
 *         schema: { type: string, enum: [INFO, WARNING, CRITICAL] }
 *       - in: query
 *         name: type
 *         schema: { type: string, enum: [FIRE, GAS_LEAK, INTRUSION, WATER_LEAK, HIGH_TEMP, POWER_CUT] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Liste des alertes
 */
router.get('/', getAlerts);

/**
 * @swagger
 * /api/alerts/{id}:
 *   get:
 *     summary: Obtenir une alerte par son ID
 *     tags: [Alertes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Détails de l'alerte
 *       404:
 *         description: Alerte introuvable
 */
router.get('/:id', getAlertById);

/**
 * @swagger
 * /api/alerts/{id}/resolve:
 *   patch:
 *     summary: Marquer une alerte comme résolue
 *     tags: [Alertes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Alerte résolue
 *       404:
 *         description: Alerte introuvable ou déjà résolue
 */
router.patch('/:id/resolve', resolveAlert);

export default router;
