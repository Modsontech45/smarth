import { Router } from 'express';
import {
  getDevices,
  getDeviceById,
  createDevice,
  updateDevice,
  deleteDevice,
  updateDeviceStatus,
  getSignalTypes,
} from '../controllers/devices.controller';
import { verifyJWT } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/role.middleware';

const router = Router();

// Toutes les routes nécessitent un JWT
router.use(verifyJWT);

/**
 * @swagger
 * /api/devices/signal-types:
 *   get:
 *     summary: Lister tous les types de signaux et types de données disponibles
 *     tags: [Appareils]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Référence complète des signal_type et data_type
 */
router.get('/signal-types', getSignalTypes);

/**
 * @swagger
 * tags:
 *   name: Appareils
 *   description: Gestion des appareils (capteurs et actionneurs)
 */

/**
 * @swagger
 * /api/devices:
 *   get:
 *     summary: Lister tous les appareils
 *     tags: [Appareils]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: type
 *         schema: { type: string, enum: [INPUT, OUTPUT] }
 *         description: Filtrer par type
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [ONLINE, OFFLINE] }
 *         description: Filtrer par statut
 *       - in: query
 *         name: zone
 *         schema: { type: string }
 *         description: Filtrer par zone
 *     responses:
 *       200:
 *         description: Liste des appareils
 *       401:
 *         description: Non authentifié
 */
router.get('/', getDevices);

/**
 * @swagger
 * /api/devices/{id}:
 *   get:
 *     summary: Obtenir un appareil par son ID
 *     tags: [Appareils]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Détails de l'appareil
 *       404:
 *         description: Appareil introuvable
 */
router.get('/:id', getDeviceById);

/**
 * @swagger
 * /api/devices:
 *   post:
 *     summary: Ajouter un nouvel appareil (ADMIN)
 *     tags: [Appareils]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, type]
 *             properties:
 *               name:        { type: string, example: "Capteur Gaz Salon" }
 *               type:        { type: string, enum: [INPUT, OUTPUT] }
 *               zone:        { type: string, example: "salon" }
 *               description: { type: string, example: "Capteur MQ-2" }
 *     responses:
 *       201:
 *         description: Appareil créé — device_key retourné une seule fois
 *       400:
 *         description: Données invalides
 *       403:
 *         description: Permissions insuffisantes
 */
router.post('/', requireRole('ADMIN'), createDevice);

/**
 * @swagger
 * /api/devices/{id}:
 *   put:
 *     summary: Modifier un appareil (ADMIN)
 *     tags: [Appareils]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:        { type: string }
 *               zone:        { type: string }
 *               description: { type: string }
 *     responses:
 *       200:
 *         description: Appareil mis à jour
 *       404:
 *         description: Appareil introuvable
 */
router.put('/:id', requireRole('ADMIN'), updateDevice);

/**
 * @swagger
 * /api/devices/{id}:
 *   delete:
 *     summary: Supprimer un appareil (ADMIN)
 *     tags: [Appareils]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Appareil supprimé
 *       404:
 *         description: Appareil introuvable
 */
router.delete('/:id', requireRole('ADMIN'), deleteDevice);

/**
 * @swagger
 * /api/devices/{id}/status:
 *   patch:
 *     summary: Mettre à jour le statut d'un appareil (ADMIN)
 *     tags: [Appareils]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [ONLINE, OFFLINE] }
 *     responses:
 *       200:
 *         description: Statut mis à jour
 *       400:
 *         description: Statut invalide
 *       404:
 *         description: Appareil introuvable
 */
router.patch('/:id/status', requireRole('ADMIN'), updateDeviceStatus);

export default router;
