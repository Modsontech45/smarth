import { Response } from 'express';
import crypto from 'crypto';
import { pool } from '../db/pool';
import { AuthenticatedRequest } from '../types';

const VALID_SIGNAL_TYPES = ['digital', 'analog', 'pwm', 'dht22', 'i2c', 'uart'];
const VALID_DATA_TYPES   = ['boolean', 'float', 'integer', 'percentage'];

// Colonnes retournées dans toutes les réponses
const DEVICE_FIELDS = `
  id, name, type, status, zone, description,
  signal_type, data_type, unit, min_value, max_value, gpio_pin,
  created_at, updated_at
`;

function validateConfig(signal_type?: string, data_type?: string, res?: Response): boolean {
  if (signal_type && !VALID_SIGNAL_TYPES.includes(signal_type.toLowerCase())) {
    res?.status(400).json({
      error: `signal_type invalide. Valeurs acceptées : ${VALID_SIGNAL_TYPES.join(', ')}`,
    });
    return false;
  }
  if (data_type && !VALID_DATA_TYPES.includes(data_type.toLowerCase())) {
    res?.status(400).json({
      error: `data_type invalide. Valeurs acceptées : ${VALID_DATA_TYPES.join(', ')}`,
    });
    return false;
  }
  return true;
}

// ─── GET /api/devices ────────────────────────────────────────
export const getDevices = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { type, status, zone, signal_type } = req.query;

  let query = `SELECT ${DEVICE_FIELDS} FROM devices WHERE owner_id = $1`;
  const params: (string | number)[] = [req.user!.userId];

  if (type) {
    params.push(String(type).toUpperCase());
    query += ` AND type = $${params.length}`;
  }
  if (status) {
    params.push(String(status).toUpperCase());
    query += ` AND status = $${params.length}`;
  }
  if (zone) {
    params.push(String(zone));
    query += ` AND zone = $${params.length}`;
  }
  if (signal_type) {
    params.push(String(signal_type).toLowerCase());
    query += ` AND signal_type = $${params.length}`;
  }

  query += ' ORDER BY created_at DESC';

  const result = await pool.query(query, params);
  res.json({ devices: result.rows });
};

// ─── GET /api/devices/:id ────────────────────────────────────
export const getDeviceById = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await pool.query(
    `SELECT ${DEVICE_FIELDS} FROM devices WHERE id = $1 AND owner_id = $2`,
    [req.params.id, req.user!.userId]
  );

  if ((result.rowCount ?? 0) === 0) {
    res.status(404).json({ error: 'Appareil introuvable' });
    return;
  }

  res.json({ device: result.rows[0] });
};

// ─── POST /api/devices ───────────────────────────────────────
export const createDevice = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const {
    name, type, zone, description,
    signal_type = 'digital',
    data_type   = 'boolean',
    unit,
    min_value,
    max_value,
    gpio_pin,
  } = req.body;

  if (!name || !type) {
    res.status(400).json({ error: 'Le nom et le type sont obligatoires' });
    return;
  }
  if (!['INPUT', 'OUTPUT'].includes(String(type).toUpperCase())) {
    res.status(400).json({ error: 'Le type doit être INPUT ou OUTPUT' });
    return;
  }
  if (!validateConfig(signal_type, data_type, res)) return;

  // Déduire les valeurs par défaut selon le signal_type si non fourni
  const defaults = getDefaults(signal_type.toLowerCase(), String(type).toUpperCase());

  const deviceKey = crypto.randomBytes(Number(process.env.DEVICE_TOKEN_BYTES) || 32).toString('hex');

  const result = await pool.query(
    `INSERT INTO devices
       (owner_id, name, type, zone, description, device_key,
        signal_type, data_type, unit, min_value, max_value, gpio_pin)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING ${DEVICE_FIELDS}, device_key`,
    [
      req.user!.userId,
      name,
      type.toUpperCase(),
      zone        || 'main',
      description || null,
      deviceKey,
      signal_type.toLowerCase(),
      data_type.toLowerCase(),
      unit       ?? defaults.unit,
      min_value  ?? defaults.min_value,
      max_value  ?? defaults.max_value,
      gpio_pin   ?? null,
    ]
  );

  const device = result.rows[0];

  res.status(201).json({
    message: 'Appareil ajouté avec succès',
    device,
  });
};

// ─── PUT /api/devices/:id ────────────────────────────────────
export const updateDevice = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const {
    name, zone, description,
    signal_type, data_type, unit, min_value, max_value, gpio_pin,
  } = req.body;

  const existing = await pool.query(
    'SELECT id FROM devices WHERE id = $1 AND owner_id = $2',
    [req.params.id, req.user!.userId]
  );
  if ((existing.rowCount ?? 0) === 0) {
    res.status(404).json({ error: 'Appareil introuvable' });
    return;
  }
  if (!validateConfig(signal_type, data_type, res)) return;

  const result = await pool.query(
    `UPDATE devices SET
       name        = COALESCE($1,  name),
       zone        = COALESCE($2,  zone),
       description = COALESCE($3,  description),
       signal_type = COALESCE($4,  signal_type),
       data_type   = COALESCE($5,  data_type),
       unit        = COALESCE($6,  unit),
       min_value   = COALESCE($7,  min_value),
       max_value   = COALESCE($8,  max_value),
       gpio_pin    = COALESCE($9,  gpio_pin),
       updated_at  = NOW()
     WHERE id = $10 AND owner_id = $11
     RETURNING ${DEVICE_FIELDS}`,
    [
      name        || null,
      zone        || null,
      description || null,
      signal_type ? signal_type.toLowerCase() : null,
      data_type   ? data_type.toLowerCase()   : null,
      unit        ?? null,
      min_value   ?? null,
      max_value   ?? null,
      gpio_pin    ?? null,
      req.params.id,
      req.user!.userId,
    ]
  );

  res.json({ message: 'Appareil mis à jour', device: result.rows[0] });
};

// ─── DELETE /api/devices/:id ─────────────────────────────────
export const deleteDevice = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await pool.query(
    'DELETE FROM devices WHERE id = $1 AND owner_id = $2 RETURNING id, name',
    [req.params.id, req.user!.userId]
  );

  if ((result.rowCount ?? 0) === 0) {
    res.status(404).json({ error: 'Appareil introuvable' });
    return;
  }

  res.json({ message: `Appareil "${result.rows[0].name}" supprimé avec succès` });
};

// ─── PATCH /api/devices/:id/status ──────────────────────────
export const updateDeviceStatus = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { status } = req.body;

  if (!status || !['ONLINE', 'OFFLINE'].includes(String(status).toUpperCase())) {
    res.status(400).json({ error: 'Le statut doit être ONLINE ou OFFLINE' });
    return;
  }

  const result = await pool.query(
    `UPDATE devices SET status = $1, updated_at = NOW()
     WHERE id = $2 AND owner_id = $3
     RETURNING id, name, status, updated_at`,
    [status.toUpperCase(), req.params.id, req.user!.userId]
  );

  if ((result.rowCount ?? 0) === 0) {
    res.status(404).json({ error: 'Appareil introuvable' });
    return;
  }

  res.json({ message: 'Statut mis à jour', device: result.rows[0] });
};

// ─── GET /api/devices/signal-types ──────────────────────────
export const getSignalTypes = (_req: AuthenticatedRequest, res: Response): void => {
  res.json({
    signal_types: [
      { value: 'digital',   label: 'Digital (HIGH/LOW)',       data_types: ['boolean'],              example_units: ['boolean'],        typical_use: 'Relais, buzzer, PIR, fuite d\'eau' },
      { value: 'analog',    label: 'Analogique (ADC 0–4095)', data_types: ['float', 'integer'],     example_units: ['ppm', 'lux', '%'], typical_use: 'MQ-2 gaz, LDR lumière, capteur eau' },
      { value: 'pwm',       label: 'PWM (0–255)',              data_types: ['integer', 'percentage'], example_units: ['%', 'pwm'],       typical_use: 'Variateur lumière, vitesse ventilateur' },
      { value: 'dht22',     label: 'DHT22 (Temp + Humidité)', data_types: ['float'],               example_units: ['°C', '%'],         typical_use: 'Capteur DHT22 température/humidité' },
      { value: 'i2c',       label: 'I2C',                     data_types: ['float', 'integer'],     example_units: ['Pa', 'lux', 'ppm'], typical_use: 'BMP280 pression, capteurs I2C' },
      { value: 'uart',      label: 'UART/Serial',              data_types: ['float', 'integer'],     example_units: ['ppm', 'µg/m³'],   typical_use: 'MHZ19 CO2, PMS5003 particules' },
    ],
    data_types: [
      { value: 'boolean',    label: 'Booléen (true/false)',   range: '0 ou 1' },
      { value: 'float',      label: 'Décimal',                range: 'ex. -40.0 à 80.0' },
      { value: 'integer',    label: 'Entier',                 range: 'ex. 0 à 4095' },
      { value: 'percentage', label: 'Pourcentage',            range: '0 à 100' },
    ],
  });
};

// ─── Valeurs par défaut selon le signal_type ────────────────
function getDefaults(signal_type: string, device_type: string) {
  const defaults: Record<string, { unit: string; min_value: number; max_value: number }> = {
    digital:  { unit: 'boolean', min_value: 0,     max_value: 1    },
    analog:   { unit: device_type === 'INPUT' ? 'ppm' : '%', min_value: 0, max_value: 4095 },
    pwm:      { unit: '%',       min_value: 0,     max_value: 255  },
    dht22:    { unit: '°C',      min_value: -40,   max_value: 80   },
    i2c:      { unit: 'Pa',      min_value: 0,     max_value: 1100 },
    uart:     { unit: 'ppm',     min_value: 0,     max_value: 5000 },
  };
  return defaults[signal_type] ?? defaults['digital'];
}
