import { Response } from 'express';
import crypto from 'crypto';
import { pool } from '../db/pool';
import { AuthenticatedRequest } from '../types';
import { PLAN_LIMITS, PlanTier } from '../plans';

const VALID_SIGNAL_TYPES = ['digital', 'analog', 'pwm', 'dht22', 'i2c', 'uart'];
const VALID_DATA_TYPES   = ['boolean', 'float', 'integer', 'percentage'];

// Colonnes retournées dans toutes les réponses
const DEVICE_FIELDS = `
  id, name, type, status, zone, description,
  signal_type, data_type, unit, min_value, max_value, gpio_pin,
  device_key, created_at, updated_at
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

  // Enforce plan device limit
  const planRow = await pool.query<{ plan: PlanTier; count: string }>(
    `SELECT u.plan, COUNT(d.id)::text AS count
     FROM users u LEFT JOIN devices d ON d.owner_id = u.id
     WHERE u.id = $1 GROUP BY u.plan`,
    [req.user!.userId],
  );
  const userPlan = (planRow.rows[0]?.plan ?? 'FREE') as PlanTier;
  const deviceCount = parseInt(planRow.rows[0]?.count ?? '0');
  const limit = PLAN_LIMITS[userPlan].devices;
  if (limit !== -1 && deviceCount >= limit) {
    res.status(403).json({
      error: `Limite atteinte : votre plan ${userPlan} autorise ${limit} appareils maximum.`,
      code: 'PLAN_LIMIT_DEVICES',
    });
    return;
  }

  const defaults  = getDefaults(signal_type.toLowerCase(), String(type).toUpperCase());
  const deviceKey = crypto.randomBytes(Number(process.env.DEVICE_TOKEN_BYTES) || 32).toString('hex');
  const resolvedUnit = unit ?? defaults.unit;

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
      resolvedUnit,
      min_value  ?? defaults.min_value,
      max_value  ?? defaults.max_value,
      gpio_pin   ?? null,
    ]
  );

  const device = result.rows[0];

  res.status(201).json({ message: 'Appareil ajouté avec succès', device });

  // Fire-and-forget: seed default data after responding
  seedDeviceData(device.id, type.toUpperCase(), signal_type.toLowerCase(), resolvedUnit, name)
    .catch(err => console.error('seedDeviceData error:', err));
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

// ─── Auto-seed default data after device creation ────────────
async function seedDeviceData(
  deviceId: number,
  deviceType: string,
  signalType: string,
  unit: string,
  name: string,
): Promise<void> {
  const u = (unit  ?? '').toLowerCase();
  const n = (name  ?? '').toLowerCase();
  const jit = (range: number) => (Math.random() - 0.5) * 2 * range;

  if (deviceType === 'OUTPUT') {
    // Ensure an actuator_state row exists so the device appears in the actuators list
    await pool.query(
      `INSERT INTO actuator_states (device_id, state)
       VALUES ($1, false)
       ON CONFLICT (device_id) DO NOTHING`,
      [deviceId],
    );
    return;
  }

  // INPUT — insert 5 sample readings (t-2h … t, every 30 min)
  const now = Date.now();
  for (let i = 0; i < 5; i++) {
    const ts      = new Date(now - (4 - i) * 30 * 60 * 1000);
    const hour    = ts.getHours();
    const daytime = hour >= 7 && hour < 21;
    const wave    = Math.sin((i / 4) * Math.PI);

    let temperature: number | null = null;
    let humidity:    number | null = null;
    let gas_ppm:     number | null = null;
    let air_quality: number | null = null;
    let motion:      boolean | null = null;
    let light_lux:   number | null = null;
    let water_leak:  boolean | null = null;

    if (signalType === 'dht22' || signalType === 'dht11') {
      temperature = +(21 + wave * 4 + jit(1)).toFixed(2);
      humidity    = +(55 + wave * 8 + jit(2)).toFixed(2);
      air_quality = +(75 + jit(5)).toFixed(2);

    } else if (u.includes('ppm') || signalType === 'uart' ||
               n.includes('gaz') || n.includes('gas') || n.includes('fumée') || n.includes('co2')) {
      gas_ppm     = +(120 + wave * 50 + jit(20)).toFixed(2);
      air_quality = +(80 - (gas_ppm / 100)).toFixed(2);

    } else if (u.includes('lux') || n.includes('lum') || n.includes('light') || n.includes('luminosité')) {
      light_lux   = +(daytime ? 300 + wave * 200 + jit(50) : 5 + jit(2)).toFixed(2);

    } else if (n.includes('pir') || n.includes('mouvement') || n.includes('motion') || n.includes('présence')) {
      motion      = false;

    } else if (n.includes('fuite') || n.includes('water') || n.includes('eau') || n.includes('inond')) {
      water_leak  = false;

    } else if (u.includes('°c') || u === 'c' || u.includes('celsius') || u.includes('temp') ||
               n.includes('temp') || n.includes('therm')) {
      temperature = +(22 + wave * 3 + jit(1)).toFixed(2);
      air_quality = +(75 + jit(5)).toFixed(2);

    } else if (u === '%' || u.includes('humid')) {
      humidity    = +(58 + wave * 8 + jit(2)).toFixed(2);

    } else {
      // Generic analog / i2c / pwm
      air_quality = +(75 + wave * 10 + jit(5)).toFixed(2);
    }

    await pool.query(
      `INSERT INTO sensor_readings
         (device_id, temperature, humidity, gas_ppm, air_quality,
          motion, light_lux, water_leak, recorded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [deviceId, temperature, humidity, gas_ppm, air_quality,
       motion, light_lux, water_leak, ts.toISOString()],
    );
  }

  // Mark ONLINE since it now has data
  await pool.query("UPDATE devices SET status = 'ONLINE' WHERE id = $1", [deviceId]);
}

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
