import { Router } from 'express';
import { getLatest, getHistory, getByDevice } from '../controllers/sensors.controller';
import { getSensorStats } from '../controllers/sensors.stats.controller';
import { verifyJWT } from '../middleware/auth.middleware';

const router = Router();
router.use(verifyJWT);

/**
 * @swagger
 * tags:
 *   name: Capteurs
 *   description: Relevés des capteurs
 */

/**
 * @swagger
 * /api/sensors/latest:
 *   get:
 *     summary: Dernier relevé de capteur
 *     tags: [Capteurs]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dernier relevé disponible
 *       404:
 *         description: Aucun relevé disponible
 */
router.get('/latest', getLatest);

/**
 * @swagger
 * /api/sensors/history:
 *   get:
 *     summary: Historique paginé des relevés
 *     tags: [Capteurs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *         description: Date de début (ex. 2026-06-01)
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *         description: Date de fin
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 100 }
 *     responses:
 *       200:
 *         description: Liste paginée des relevés
 */
router.get('/history', getHistory);

/**
 * @swagger
 * /api/sensors/device/{device_id}:
 *   get:
 *     summary: Historique d'un capteur spécifique
 *     tags: [Capteurs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: device_id
 *         required: true
 *         schema: { type: integer }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Relevés du capteur
 *       404:
 *         description: Appareil introuvable
 */
router.get('/device/:device_id', getByDevice);

/**
 * @swagger
 * /api/sensors/stats:
 *   get:
 *     summary: Statistiques min/max/moy par période
 *     tags: [Capteurs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: period
 *         schema: { type: string, enum: [day, week, month, year], default: day }
 *         description: Granularité de la période
 *       - in: query
 *         name: device_id
 *         schema: { type: integer }
 *         description: Filtrer sur un capteur spécifique (optionnel)
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 30, maximum: 100 }
 *         description: Nombre de périodes à retourner
 *     responses:
 *       200:
 *         description: Statistiques agrégées par période
 *       400:
 *         description: Période invalide
 */
router.get('/stats', getSensorStats);

export default router;
