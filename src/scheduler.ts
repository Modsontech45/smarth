import { pool, dbIsOnline } from './db/pool';
import { emitToUser } from './socket';
import { sendToESP32 } from './esp32-ws';
import https from 'https';

// Tracks pending auto-off timers keyed by automation id.
// Cleared and reset each time the same automation fires again.
const autoOffTimers = new Map<number, ReturnType<typeof setTimeout>>();

// Infer the sensor_readings field when trigger_field is absent (legacy rows).
function sensorFieldFallback(unit: string | null, signalType: string | null, name: string | null): string {
  const u  = (unit       ?? '').toLowerCase();
  const st = (signalType ?? '').toLowerCase();
  const n  = (name       ?? '').toLowerCase();
  if (st === 'digital' || u === 'boolean') {
    if (n.includes('pir') || n.includes('mouvement') || n.includes('motion') || n.includes('presence')) return 'motion';
    if (n.includes('fuite') || n.includes('water') || n.includes('leak') || n.includes('eau')) return 'water_leak';
  }
  if (u.includes('°c'))               return 'temperature';
  if (u === '%')                       return 'humidity';
  if (u.includes('ppm'))               return 'gas_ppm';
  if (u.includes('lux'))               return 'light_lux';
  if (u.includes('air') || u.includes('quality') || u.includes('qualite')) return 'air_quality';
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

async function fireOneDevice(
  deviceId: number,
  deviceKey: string,
  deviceName: string,
  deviceZone: string,
  actionState: boolean,
  ownerId: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO actuator_states (device_id, state, triggered_by, updated_at)
     VALUES ($1, $2, 'automation', NOW())
     ON CONFLICT (device_id)
     DO UPDATE SET state = $2, triggered_by = 'automation', updated_at = NOW()`,
    [deviceId, actionState],
  );
  await pool.query(
    `INSERT INTO actuator_state_history (device_id, state, changed_by, changed_at)
     VALUES ($1, $2, 'automation', NOW())`,
    [deviceId, actionState],
  );
  emitToUser(ownerId, 'actuator:update', {
    id: deviceId, name: deviceName, zone: deviceZone,
    state: actionState, triggeredBy: 'automation',
    updated_at: new Date().toISOString(),
  });
  sendToESP32(ownerId, 'actuator:command', { deviceKey, state: actionState });
}

async function fireAutomation(
  automationId: number,
  actionDeviceId: number,
  actionState: boolean,
  deviceKey: string,
  deviceName: string,
  deviceZone: string,
  ownerId: number,
  durationSeconds = 0,
): Promise<void> {
  await fireOneDevice(actionDeviceId, deviceKey, deviceName, deviceZone, actionState, ownerId);
  await pool.query(`UPDATE automations SET last_triggered_at = NOW() WHERE id = $1`, [automationId]);
  console.log(`[Automation] → device #${actionDeviceId} (${deviceName}) ${actionState ? 'ON' : 'OFF'}`);

  if (actionState && durationSeconds > 0) {
    const prev = autoOffTimers.get(automationId);
    if (prev) clearTimeout(prev);
    const t = setTimeout(async () => {
      autoOffTimers.delete(automationId);
      await fireOneDevice(actionDeviceId, deviceKey, deviceName, deviceZone, false, ownerId);
      console.log(`[Automation] auto-off device #${actionDeviceId} after ${durationSeconds}s`);
    }, durationSeconds * 1000);
    autoOffTimers.set(automationId, t);
  }
}

async function fireAutomationToAll(
  automationId: number,
  actionState: boolean,
  ownerId: number,
  durationSeconds = 0,
): Promise<void> {
  const { rows } = await pool.query<{ id: number; device_key: string; name: string; zone: string }>(
    `SELECT id, device_key, name, zone FROM devices WHERE owner_id=$1 AND type='OUTPUT'`,
    [ownerId],
  );
  for (const d of rows) {
    await fireOneDevice(d.id, d.device_key, d.name, d.zone, actionState, ownerId);
  }
  await pool.query(`UPDATE automations SET last_triggered_at = NOW() WHERE id = $1`, [automationId]);
  console.log(`[Automation] → ALL ${rows.length} device(s) ${actionState ? 'ON' : 'OFF'}`);

  if (actionState && durationSeconds > 0) {
    const prev = autoOffTimers.get(automationId);
    if (prev) clearTimeout(prev);
    const t = setTimeout(async () => {
      autoOffTimers.delete(automationId);
      const { rows: offRows } = await pool.query<{ id: number; device_key: string; name: string; zone: string }>(
        `SELECT id, device_key, name, zone FROM devices WHERE owner_id=$1 AND type='OUTPUT'`,
        [ownerId],
      );
      for (const d of offRows) {
        await fireOneDevice(d.id, d.device_key, d.name, d.zone, false, ownerId);
      }
      console.log(`[Automation] auto-off ALL devices after ${durationSeconds}s`);
    }, durationSeconds * 1000);
    autoOffTimers.set(automationId, t);
  }
}

async function evaluateTimeBased(): Promise<void> {
  if (!dbIsOnline()) return;
  const now  = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  try {
    const { rows } = await pool.query<{
      id: number; owner_id: number;
      action_device_id: number | null; action_state: boolean; action_all_devices: boolean;
      action_duration_seconds: number | null;
      device_key: string | null; device_name: string | null; device_zone: string | null;
    }>(
      `SELECT a.id, a.owner_id, a.action_device_id, a.action_state,
              COALESCE(a.action_all_devices, false) AS action_all_devices,
              a.action_duration_seconds,
              d.device_key, d.name AS device_name, d.zone AS device_zone
       FROM automations a
       LEFT JOIN devices d ON d.id = a.action_device_id
       WHERE a.enabled = true
         AND a.trigger_type = 'TIME_BASED'
         AND to_char(a.trigger_time, 'HH24:MI') = $1
         AND (a.last_triggered_at IS NULL
              OR a.last_triggered_at < NOW() - INTERVAL '23 hours')`,
      [hhmm],
    );

    for (const row of rows) {
      const dur = row.action_duration_seconds ?? 0;
      if (row.action_all_devices) {
        await fireAutomationToAll(row.id, row.action_state, row.owner_id, dur);
      } else if (row.action_device_id && row.device_key) {
        await fireAutomation(
          row.id, row.action_device_id, row.action_state,
          row.device_key, row.device_name!, row.device_zone!, row.owner_id, dur,
        );
      }
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
      action_device_id: number | null; action_state: boolean; action_all_devices: boolean;
      action_duration_seconds: number | null;
      trigger_condition: string; trigger_value: number;
      trigger_field: string | null;
      trigger_unit: string | null; trigger_signal_type: string | null; trigger_device_name: string | null;
      device_key: string | null; device_name: string | null; device_zone: string | null;
      latest_reading: Record<string, number | boolean | null> | null;
    }>(
      `SELECT
         a.id, a.owner_id, a.action_device_id, a.action_state,
         COALESCE(a.action_all_devices, false) AS action_all_devices,
         a.action_duration_seconds,
         a.trigger_condition, a.trigger_value, a.trigger_field,
         td.unit AS trigger_unit, td.signal_type AS trigger_signal_type,
         td.name AS trigger_device_name,
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
       LEFT JOIN devices ad ON ad.id = a.action_device_id
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

      const field = row.trigger_field
        ?? sensorFieldFallback(row.trigger_unit, row.trigger_signal_type, row.trigger_device_name);

      const rawVal = row.latest_reading[field];
      if (rawVal == null) continue;

      const numericVal = typeof rawVal === 'boolean' ? (rawVal ? 1 : 0) : (rawVal as number);
      const dur = row.action_duration_seconds ?? 0;

      if (evaluateCondition(numericVal, row.trigger_condition, row.trigger_value)) {
        if (row.action_all_devices) {
          await fireAutomationToAll(row.id, row.action_state, row.owner_id, dur);
        } else if (row.action_device_id && row.device_key) {
          await fireAutomation(
            row.id, row.action_device_id, row.action_state,
            row.device_key, row.device_name!, row.device_zone!, row.owner_id, dur,
          );
        }
      }
    }
  } catch (err) {
    console.error('[Automation] SENSOR_THRESHOLD error:', err);
  }
}

// Called immediately inside the sensor HTTP handler — evaluates matching automations
// the moment a reading arrives instead of waiting for the 30-second background pass.
export async function evaluateSensorAutomations(
  deviceId: number,
  reading: Record<string, number | boolean | null | undefined>,
): Promise<void> {
  if (!dbIsOnline()) return;
  try {
    const { rows } = await pool.query<{
      id: number; owner_id: number;
      action_device_id: number | null; action_state: boolean; action_all_devices: boolean;
      action_duration_seconds: number | null;
      trigger_condition: string; trigger_value: number;
      trigger_field: string | null;
      trigger_unit: string | null; trigger_signal_type: string | null; trigger_device_name: string | null;
      device_key: string | null; device_name: string | null; device_zone: string | null;
    }>(
      `SELECT
         a.id, a.owner_id, a.action_device_id, a.action_state,
         COALESCE(a.action_all_devices, false) AS action_all_devices,
         a.action_duration_seconds,
         a.trigger_condition, a.trigger_value, a.trigger_field,
         td.unit AS trigger_unit, td.signal_type AS trigger_signal_type,
         td.name AS trigger_device_name,
         ad.device_key, ad.name AS device_name, ad.zone AS device_zone
       FROM automations a
       JOIN devices td ON td.id = a.trigger_device_id
       LEFT JOIN devices ad ON ad.id = a.action_device_id
       WHERE a.enabled = true
         AND a.trigger_type = 'SENSOR_THRESHOLD'
         AND a.trigger_device_id = $1
         AND a.trigger_value IS NOT NULL
         AND a.trigger_condition IS NOT NULL
         AND (a.last_triggered_at IS NULL
              OR a.last_triggered_at < NOW() - INTERVAL '5 minutes')`,
      [deviceId],
    );

    for (const row of rows) {
      const field = row.trigger_field
        ?? sensorFieldFallback(row.trigger_unit, row.trigger_signal_type, row.trigger_device_name);

      const rawVal = reading[field];
      if (rawVal == null) continue;

      const numericVal = typeof rawVal === 'boolean' ? (rawVal ? 1 : 0) : (rawVal as number);
      const dur = row.action_duration_seconds ?? 0;

      if (evaluateCondition(numericVal, row.trigger_condition, row.trigger_value)) {
        if (row.action_all_devices) {
          await fireAutomationToAll(row.id, row.action_state, row.owner_id, dur);
        } else if (row.action_device_id && row.device_key) {
          await fireAutomation(
            row.id, row.action_device_id, row.action_state,
            row.device_key, row.device_name!, row.device_zone!, row.owner_id, dur,
          );
        }
      }
    }
  } catch (err) {
    console.error('[Automation] in-request evaluation error:', err);
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

  // SENSOR_THRESHOLD automations — every 30 s (sensors post every 30 s)
  setInterval(evaluateSensorThreshold, 30_000);
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
