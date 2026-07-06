import { pool, dbIsOnline } from './db/pool';
import { emitToUser } from './socket';
import { sendToESP32 } from './esp32-ws';
import https from 'https';

function sensorFieldFromUnit(unit: string | null): string {
  if (!unit) return 'temperature';
  const u = unit.toLowerCase();
  if (u.includes('°c') || u === 'celsius') return 'temperature';
  if (u === '%')                            return 'humidity';
  if (u === 'ppm')                          return 'gas_ppm';
  if (u === 'lux')                          return 'light_lux';
  return 'temperature';
}

function evaluateCondition(value: number, condition: string, threshold: number): boolean {
  switch (condition) {
    case 'GT':  return value >  threshold;
    case 'LT':  return value <  threshold;
    case 'EQ':  return Math.abs(value - threshold) < 0.001;
    case 'GTE': return value >= threshold;
    case 'LTE': return value <= threshold;
    default:    return false;
  }
}

async function fireAutomation(
  automationId: number,
  actionDeviceId: number,
  actionState: boolean,
  deviceKey: string,
  deviceName: string,
  deviceZone: string,
  ownerId: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO actuator_states (device_id, state, triggered_by, updated_at)
     VALUES ($1, $2, 'automation', NOW())
     ON CONFLICT (device_id)
     DO UPDATE SET state = $2, triggered_by = 'automation', updated_at = NOW()`,
    [actionDeviceId, actionState],
  );

  await pool.query(
    `INSERT INTO actuator_state_history (device_id, state, changed_by, changed_at)
     VALUES ($1, $2, 'automation', NOW())`,
    [actionDeviceId, actionState],
  );

  await pool.query(
    `UPDATE automations SET last_triggered_at = NOW() WHERE id = $1`,
    [automationId],
  );

  emitToUser(ownerId, 'actuator:update', {
    id:          actionDeviceId,
    name:        deviceName,
    zone:        deviceZone,
    state:       actionState,
    triggeredBy: 'automation',
    updated_at:  new Date().toISOString(),
  });

  sendToESP32(ownerId, 'actuator:command', { deviceKey, state: actionState });

  console.log(`[Automation] → device #${actionDeviceId} (${deviceName}) ${actionState ? 'ON' : 'OFF'}`);
}

async function evaluateTimeBased(): Promise<void> {
  if (!dbIsOnline()) return;
  const now  = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  try {
    const { rows } = await pool.query<{
      id: number; owner_id: number;
      action_device_id: number; action_state: boolean;
      device_key: string; device_name: string; device_zone: string;
    }>(
      `SELECT a.id, a.owner_id, a.action_device_id, a.action_state,
              d.device_key, d.name AS device_name, d.zone AS device_zone
       FROM automations a
       JOIN devices d ON d.id = a.action_device_id
       WHERE a.enabled = true
         AND a.trigger_type = 'TIME_BASED'
         AND to_char(a.trigger_time, 'HH24:MI') = $1
         AND (a.last_triggered_at IS NULL
              OR a.last_triggered_at < NOW() - INTERVAL '23 hours')`,
      [hhmm],
    );

    for (const row of rows) {
      await fireAutomation(
        row.id, row.action_device_id, row.action_state,
        row.device_key, row.device_name, row.device_zone, row.owner_id,
      );
    }
  } catch (err) {
    console.error('[Automation] TIME_BASED error:', err);
  }
}

async function evaluateSensorThreshold(): Promise<void> {
  if (!dbIsOnline()) return;
  try {
    const { rows } = await pool.query<{
      id: number; owner_id: number;
      action_device_id: number; action_state: boolean;
      trigger_condition: string; trigger_value: number;
      trigger_unit: string | null;
      device_key: string; device_name: string; device_zone: string;
      latest_reading: Record<string, number | boolean | null> | null;
    }>(
      `SELECT
         a.id, a.owner_id, a.action_device_id, a.action_state,
         a.trigger_condition, a.trigger_value,
         td.unit AS trigger_unit,
         ad.device_key, ad.name AS device_name, ad.zone AS device_zone,
         (
           SELECT row_to_json(sub)
           FROM (
             SELECT sr.temperature, sr.humidity, sr.gas_ppm,
                    sr.air_quality, sr.motion, sr.light_lux, sr.water_leak
             FROM sensor_readings sr
             WHERE sr.device_id = a.trigger_device_id
             ORDER BY sr.recorded_at DESC
             LIMIT 1
           ) sub
         ) AS latest_reading
       FROM automations a
       JOIN devices td ON td.id = a.trigger_device_id
       JOIN devices ad ON ad.id = a.action_device_id
       WHERE a.enabled = true
         AND a.trigger_type = 'SENSOR_THRESHOLD'
         AND a.trigger_device_id IS NOT NULL
         AND a.trigger_value IS NOT NULL
         AND a.trigger_condition IS NOT NULL
         AND (a.last_triggered_at IS NULL
              OR a.last_triggered_at < NOW() - INTERVAL '5 minutes')`,
    );

    for (const row of rows) {
      if (!row.latest_reading) continue;
      const field  = sensorFieldFromUnit(row.trigger_unit);
      const rawVal = row.latest_reading[field];
      if (rawVal == null || typeof rawVal !== 'number') continue;

      if (evaluateCondition(rawVal, row.trigger_condition, row.trigger_value)) {
        await fireAutomation(
          row.id, row.action_device_id, row.action_state,
          row.device_key, row.device_name, row.device_zone, row.owner_id,
        );
      }
    }
  } catch (err) {
    console.error('[Automation] SENSOR_THRESHOLD error:', err);
  }
}

export function startScheduler(): void {
  // Offline detection — every 30 s
  setInterval(async () => {
    if (!dbIsOnline()) return;
    try {
      const { rows } = await pool.query<{ id: number; owner_id: number }>(
        `UPDATE devices SET status = 'OFFLINE'
         WHERE last_seen < NOW() - INTERVAL '90 seconds' AND status = 'ONLINE'
         RETURNING id, owner_id`,
      );
      for (const d of rows) {
        emitToUser(d.owner_id, 'device:status', { deviceId: d.id, status: 'OFFLINE' });
      }
      if (rows.length > 0) console.log(`[Scheduler] ${rows.length} device(s) OFFLINE`);
    } catch (err) {
      console.error('[Scheduler] Offline detection error:', err);
    }
  }, 30_000);

  // TIME_BASED automations — fire once per minute, aligned to the clock
  const msToNextMinute =
    (60 - new Date().getSeconds()) * 1000 - new Date().getMilliseconds();
  setTimeout(() => {
    evaluateTimeBased();
    setInterval(evaluateTimeBased, 60_000);
  }, msToNextMinute);

  // SENSOR_THRESHOLD automations — every 2 minutes
  setInterval(evaluateSensorThreshold, 2 * 60_000);
  evaluateSensorThreshold(); // run immediately on start

  // Self-ping — keeps Render free tier awake
  const selfUrl = process.env.RENDER_EXTERNAL_URL ?? process.env.BACKEND_URL;
  if (selfUrl) {
    setInterval(() => {
      https.get(`${selfUrl}/health`, res => res.resume()).on('error', () => {});
    }, 10 * 60 * 1000);
    console.log('[Scheduler] Keep-alive ping started (10 min)');
  }

  console.log('[Scheduler] Started — offline detection (30 s), TIME_BASED (1 min, clock-aligned), SENSOR_THRESHOLD (2 min)');
}
