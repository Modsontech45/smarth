import { Request, Response } from 'express';
import { pool } from '../db/pool';
import { emitToUser } from '../socket';

// GET /api/esp32/config
export const getEsp32Config = async (req: Request, res: Response) => {
  const { rows } = await pool.query<{ key: string; value: string }>(
    `SELECT key, value FROM system_config
     WHERE key IN ('temp_max','temp_crit','gas_ppm_max','gas_crit','sensor_interval')`,
  );
  const map: Record<string, string> = {};
  rows.forEach(r => { map[r.key] = r.value; });
  res.json({
    temp_warn:       parseFloat(map['temp_max']        ?? '35'),
    temp_crit:       parseFloat(map['temp_crit']       ?? '45'),
    gas_warn:        parseInt  (map['gas_ppm_max']     ?? '800',  10),
    gas_crit:        parseInt  (map['gas_crit']        ?? '1500', 10),
    sensor_interval: parseInt  (map['sensor_interval'] ?? '30',   10),
  });
};

// POST /api/esp32/readings
export const postReadings = async (req: Request, res: Response) => {
  const device = (req as any).device;
  const { temperature, humidity, gas_ppm, air_quality, motion, light_lux, water_leak } = req.body;

  res.json({ ok: true });

  try {
    await pool.query(
      `INSERT INTO sensor_readings
         (device_id, temperature, humidity, gas_ppm, air_quality, motion, light_lux, water_leak)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [device.id, temperature ?? null, humidity ?? null, gas_ppm ?? null,
       air_quality ?? null, motion ?? null, light_lux ?? null, water_leak ?? null],
    );
    await pool.query(
      `UPDATE devices SET status='ONLINE', last_seen=NOW() WHERE id=$1`,
      [device.id],
    );

    // Push sensor update to all browser clients of this user instantly
    emitToUser(device.owner_id, 'sensor:update', {
      deviceId: device.id, deviceName: device.name, zone: device.zone,
      temperature, humidity, gas_ppm, air_quality, motion, light_lux, water_leak,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[ESP32] postReadings error:', err);
  }
};

// GET /api/esp32/commands
export const getCommands = async (req: Request, res: Response) => {
  const userId = (req as any).userId;
  const { rows } = await pool.query<{ device_key: string; state: boolean; name: string }>(
    `SELECT d.device_key, COALESCE(a.state, false) AS state, d.name
     FROM devices d
     LEFT JOIN actuator_states a ON a.device_id = d.id
     WHERE d.owner_id = $1 AND d.type = 'OUTPUT'
     ORDER BY d.id`,
    [userId],
  );
  res.json({ commands: rows });
};

// POST /api/esp32/state  — physical switch pressed on the ESP32
export const postState = async (req: Request, res: Response) => {
  const device = (req as any).device;
  const { state } = req.body as { state: boolean };

  if (typeof state !== 'boolean') {
    return res.status(400).json({ error: 'state must be a boolean' });
  }

  res.json({ ok: true });

  try {
    await pool.query(
      `INSERT INTO actuator_states (device_id, state, triggered_by, updated_at)
       VALUES ($1, $2, 'esp32_switch', NOW())
       ON CONFLICT (device_id)
       DO UPDATE SET state=$2, triggered_by='esp32_switch', updated_at=NOW()`,
      [device.id, state],
    );
    await pool.query(
      `INSERT INTO actuator_state_history (device_id, state, changed_by)
       VALUES ($1, $2, 'esp32_switch')`,
      [device.id, state],
    );
    await pool.query(
      `UPDATE devices SET status='ONLINE', last_seen=NOW() WHERE id=$1`,
      [device.id],
    );

    // Push relay state to browser — switch pressed on the wall
    emitToUser(device.owner_id, 'actuator:update', {
      id: device.id, name: device.name, zone: device.zone,
      state, triggeredBy: 'esp32_switch',
    });
  } catch (err) {
    console.error('[ESP32] postState error:', err);
  }
};

// POST /api/esp32/energy
export const postEnergy = async (req: Request, res: Response) => {
  const device = (req as any).device;
  const { power_w, current_a, voltage_v, energy_wh } = req.body as {
    power_w: number; current_a: number; voltage_v: number; energy_wh: number;
  };

  res.json({ ok: true });

  try {
    await pool.query(
      `INSERT INTO energy_readings (device_id, power_w, current_a, voltage_v, energy_wh)
       VALUES ($1, $2, $3, $4, $5)`,
      [device.id, power_w ?? 0, current_a ?? 0, voltage_v ?? 220, energy_wh ?? 0],
    );
    await pool.query(
      `UPDATE actuator_states
       SET energy_today_wh = COALESCE(energy_today_wh, 0) + $2,
           total_energy_wh = COALESCE(total_energy_wh, 0) + $2
       WHERE device_id = $1`,
      [device.id, energy_wh ?? 0],
    );
    await pool.query(
      `UPDATE devices SET status='ONLINE', last_seen=NOW() WHERE id=$1`,
      [device.id],
    );

    emitToUser(device.owner_id, 'energy:update', {
      id: device.id, name: device.name,
      power_w, current_a, voltage_v, energy_wh,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[ESP32] postEnergy error:', err);
  }
};

// POST /api/esp32/alert
export const postAlert = async (req: Request, res: Response) => {
  const device = (req as any).device;
  const { type, severity, message } = req.body as {
    type: string; severity: string; message?: string;
  };

  const VALID_TYPES      = ['FIRE', 'GAS_LEAK', 'INTRUSION', 'WATER_LEAK', 'HIGH_TEMP', 'POWER_CUT'];
  const VALID_SEVERITIES = ['INFO', 'WARNING', 'CRITICAL'];

  if (!VALID_TYPES.includes(type))
    return res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` });
  if (!VALID_SEVERITIES.includes(severity))
    return res.status(400).json({ error: `severity must be one of: ${VALID_SEVERITIES.join(', ')}` });

  res.json({ ok: true });

  try {
    const { rowCount } = await pool.query(
      `SELECT id FROM alerts WHERE device_id=$1 AND type=$2 AND resolved=false LIMIT 1`,
      [device.id, type],
    );
    if ((rowCount ?? 0) > 0) return;

    const { rows } = await pool.query(
      `INSERT INTO alerts (device_id, type, zone, severity, message)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [device.id, type, device.zone ?? null, severity, message ?? null],
    );

    // Push new alert to browser immediately
    emitToUser(device.owner_id, 'alert:new', {
      ...rows[0],
      device_name: device.name,
    });
  } catch (err) {
    console.error('[ESP32] postAlert error:', err);
  }
};

// POST /api/esp32/heartbeat
export const postHeartbeat = async (req: Request, res: Response) => {
  const userId = (req as any).userId;
  const { device_keys } = req.body as { device_keys: string[] };

  if (!Array.isArray(device_keys) || device_keys.length === 0)
    return res.status(400).json({ error: 'device_keys array required' });

  res.json({ ok: true });

  try {
    await pool.query(
      `UPDATE devices SET status='ONLINE', last_seen=NOW()
       WHERE owner_id=$1 AND device_key = ANY($2::text[])`,
      [userId, device_keys],
    );

    emitToUser(userId, 'device:online', { device_keys });
  } catch (err) {
    console.error('[ESP32] postHeartbeat error:', err);
  }
};
