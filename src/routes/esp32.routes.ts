import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../db/pool';
import { verifyDeviceKeys } from '../middleware/device.middleware';
import {
  getEsp32Config,
  postReadings,
  getCommands,
  postState,
  postEnergy,
  postAlert,
  postHeartbeat,
} from '../controllers/esp32.controller';

const router = Router();

// Account-level auth — validates only x-api-key, no device required
const verifyApiKey = async (req: Request, res: Response, next: NextFunction) => {
  const apiKey = req.headers['x-api-key'] as string;
  if (!apiKey) {
    res.status(401).json({ error: 'x-api-key header required' });
    return;
  }
  const { rows, rowCount } = await pool.query(
    'SELECT id FROM users WHERE api_key = $1',
    [apiKey],
  );
  if (!rowCount) {
    res.status(401).json({ error: 'api_key invalide' });
    return;
  }
  (req as any).userId = rows[0].id;
  next();
};

/**
 * @swagger
 * /api/esp32/config:
 *   get:
 *     summary: Fetch runtime thresholds and settings for the ESP32
 *     security: [{ apiKey: [] }]
 *     responses:
 *       200:
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 temp_warn:       { type: number }
 *                 temp_crit:       { type: number }
 *                 gas_warn:        { type: number }
 *                 gas_crit:        { type: number }
 *                 sensor_interval: { type: number }
 */
router.get('/config', verifyApiKey, getEsp32Config);

/**
 * @swagger
 * /api/esp32/readings:
 *   post:
 *     summary: Submit sensor readings from an ESP32
 *     security: [{ deviceKeys: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               temperature: { type: number }
 *               humidity:    { type: number }
 *               gas_ppm:     { type: number }
 *               air_quality: { type: number }
 *               motion:      { type: boolean }
 *               light_lux:   { type: number }
 *               water_leak:  { type: boolean }
 *     responses:
 *       200: { description: Accepted }
 */
router.post('/readings', verifyDeviceKeys as any, postReadings);

/**
 * @swagger
 * /api/esp32/commands:
 *   get:
 *     summary: Poll pending actuator commands for all output devices
 *     security: [{ apiKey: [] }]
 *     responses:
 *       200:
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 commands:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       device_key: { type: string }
 *                       state:      { type: boolean }
 *                       name:       { type: string }
 */
router.get('/commands', verifyApiKey, getCommands);

/**
 * @swagger
 * /api/esp32/state:
 *   post:
 *     summary: Report relay state change from physical switch
 *     security: [{ deviceKeys: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [state]
 *             properties:
 *               state: { type: boolean }
 *     responses:
 *       200: { description: Accepted }
 */
router.post('/state', verifyDeviceKeys as any, postState);

/**
 * @swagger
 * /api/esp32/energy:
 *   post:
 *     summary: Submit per-appliance energy reading
 *     security: [{ deviceKeys: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               power_w:   { type: number }
 *               current_a: { type: number }
 *               voltage_v: { type: number }
 *               energy_wh: { type: number }
 *     responses:
 *       200: { description: Accepted }
 */
router.post('/energy', verifyDeviceKeys as any, postEnergy);

/**
 * @swagger
 * /api/esp32/alert:
 *   post:
 *     summary: Create an alert from the ESP32 (threshold crossed, leak detected, etc.)
 *     security: [{ deviceKeys: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [type, severity]
 *             properties:
 *               type:     { type: string, enum: [FIRE, GAS_LEAK, INTRUSION, WATER_LEAK, HIGH_TEMP, POWER_CUT] }
 *               severity: { type: string, enum: [INFO, WARNING, CRITICAL] }
 *               message:  { type: string }
 *     responses:
 *       200: { description: Accepted }
 */
router.post('/alert', verifyDeviceKeys as any, postAlert);

/**
 * @swagger
 * /api/esp32/heartbeat:
 *   post:
 *     summary: Mark multiple device keys as ONLINE
 *     security: [{ apiKey: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [device_keys]
 *             properties:
 *               device_keys:
 *                 type: array
 *                 items: { type: string }
 *     responses:
 *       200: { description: Accepted }
 */
router.post('/heartbeat', verifyApiKey, postHeartbeat);

export default router;
