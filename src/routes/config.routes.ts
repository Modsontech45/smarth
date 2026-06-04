import { Router } from 'express';
import { getConfig, updateConfig } from '../controllers/config.controller';
import { verifyJWT } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/role.middleware';

const router = Router();
router.use(verifyJWT);

/**
 * @swagger
 * tags:
 *   name: Configuration
 *   description: Paramètres système (seuils d'alerte, intervalles)
 */

/**
 * @swagger
 * /api/config:
 *   get:
 *     summary: Obtenir toute la configuration système
 *     tags: [Configuration]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Toutes les clés de configuration
 */
router.get('/', getConfig);

/**
 * @swagger
 * /api/config/{key}:
 *   put:
 *     summary: Mettre à jour une valeur de configuration (ADMIN)
 *     tags: [Configuration]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema: { type: string }
 *         description: "Clés disponibles : temp_max, gas_ppm_max, light_threshold, sensor_interval, auto_mode"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [value]
 *             properties:
 *               value: { type: string, example: "40" }
 *     responses:
 *       200:
 *         description: Configuration mise à jour
 *       404:
 *         description: Clé introuvable
 */
router.put('/:key', requireRole('ADMIN'), updateConfig);

export default router;
