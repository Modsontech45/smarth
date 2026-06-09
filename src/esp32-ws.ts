/**
 * Plain WebSocket server for ESP32 devices.
 * Browsers use Socket.IO (/socket.io).
 * ESP32s connect here (/esp32/ws) using the WebSocketsClient Arduino library.
 *
 * Protocol — every message is JSON: { "event": "<name>", "data": { ... } }
 *
 * Handshake (ESP32 → server, first message after connect):
 *   { "event": "auth", "data": { "apiKey": "..." } }
 *   Server replies: { "event": "connected", "data": { "userId": 1 } }
 *
 * Events ESP32 sends:
 *   sensor:reading  — temperature, humidity, etc.
 *   relay:state     — physical switch pressed
 *   energy:reading  — ACS712 power reading
 *   alert           — threshold crossed
 *   heartbeat       — keep devices ONLINE
 *
 * Events server sends to ESP32:
 *   actuator:command  — { deviceKey, state }  (sent when dashboard toggles a relay)
 *   config:update     — { temp_warn, temp_crit, gas_warn, gas_crit }
 *   connected         — auth ACK
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HttpServer } from 'http';
import { pool } from './db/pool';
import { emitToUser } from './socket';

// userId → active ESP32 WebSocket connection
const clients = new Map<number, WebSocket>();

export function initESP32WebSocket(httpServer: HttpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/esp32/ws' });

  wss.on('connection', (ws) => {
    let userId: number | null = null;

    // Close unauthenticated connections after 5 s
    const authTimer = setTimeout(() => {
      if (userId === null) ws.close(4001, 'auth timeout');
    }, 5000);

    ws.on('message', async (raw) => {
      let msg: { event: string; data: Record<string, unknown> };
      try { msg = JSON.parse(raw.toString()); }
      catch { return; }

      if (userId === null) {
        // ── Auth handshake ────────────────────────────────────────
        if (msg.event !== 'auth') { ws.close(4002, 'send auth first'); return; }

        const apiKey = msg.data?.apiKey as string | undefined;
        if (!apiKey) { ws.close(4003, 'apiKey required'); return; }

        try {
          const { rows, rowCount } = await pool.query(
            'SELECT id FROM users WHERE api_key = $1', [apiKey],
          );
          if (!rowCount) { ws.close(4004, 'invalid apiKey'); return; }

          userId = rows[0].id as number;
          clearTimeout(authTimer);
          clients.set(userId, ws);
          send(ws, 'connected', { userId });
          console.log(`[ESP32 WS] user ${userId} connected`);
        } catch (err) {
          console.error('[ESP32 WS] auth error:', err);
          ws.close(1011, 'server error');
        }
        return;
      }

      // ── Authenticated events ──────────────────────────────────
      switch (msg.event) {
        case 'sensor:reading':  await onSensorReading(userId, msg.data);  break;
        case 'relay:state':     await onRelayState(userId, msg.data);     break;
        case 'energy:reading':  await onEnergyReading(userId, msg.data);  break;
        case 'alert':           await onAlert(userId, msg.data);          break;
        case 'heartbeat':       await onHeartbeat(userId, msg.data);      break;
      }
    });

    ws.on('close', () => {
      if (userId !== null) {
        clients.delete(userId);
        console.log(`[ESP32 WS] user ${userId} disconnected`);
        emitToUser(userId, 'device:offline', {});
      }
    });

    ws.on('error', (err) => console.error('[ESP32 WS]', err.message));
  });

  console.log('[ESP32 WS] listening at ws://…/esp32/ws');
  return wss;
}

// Send a command to the ESP32 belonging to a user. Returns false if not connected.
export function sendToESP32(userId: number, event: string, data: unknown): boolean {
  const ws = clients.get(userId);
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  send(ws, event, data);
  return true;
}

function send(ws: WebSocket, event: string, data: unknown) {
  ws.send(JSON.stringify({ event, data }));
}

// ── Event handlers ────────────────────────────────────────────────

async function onSensorReading(userId: number, data: Record<string, unknown>) {
  const deviceKey = data.deviceKey as string;
  const { temperature, humidity, gas_ppm, air_quality, motion, light_lux, water_leak } = data;

  try {
    const { rows } = await pool.query(
      'SELECT id, name, zone FROM devices WHERE device_key=$1 AND owner_id=$2',
      [deviceKey, userId],
    );
    if (!rows.length) return;
    const d = rows[0];

    await pool.query(
      `INSERT INTO sensor_readings
         (device_id,temperature,humidity,gas_ppm,air_quality,motion,light_lux,water_leak)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [d.id, temperature ?? null, humidity ?? null, gas_ppm ?? null,
       air_quality ?? null, motion ?? null, light_lux ?? null, water_leak ?? null],
    );
    await pool.query(
      `UPDATE devices SET status='ONLINE', last_seen=NOW() WHERE id=$1`, [d.id],
    );

    emitToUser(userId, 'sensor:update', {
      deviceId: d.id, deviceName: d.name, zone: d.zone,
      temperature, humidity, gas_ppm, air_quality, motion, light_lux, water_leak,
      timestamp: new Date().toISOString(),
    });
  } catch (err) { console.error('[ESP32 WS] onSensorReading:', err); }
}

async function onRelayState(userId: number, data: Record<string, unknown>) {
  const deviceKey = data.deviceKey as string;
  const state     = data.state as boolean;

  try {
    const { rows } = await pool.query(
      'SELECT id, name, zone FROM devices WHERE device_key=$1 AND owner_id=$2',
      [deviceKey, userId],
    );
    if (!rows.length) return;
    const d = rows[0];

    await pool.query(
      `INSERT INTO actuator_states (device_id,state,triggered_by,updated_at)
       VALUES ($1,$2,'esp32_switch',NOW())
       ON CONFLICT (device_id)
       DO UPDATE SET state=$2,triggered_by='esp32_switch',updated_at=NOW()`,
      [d.id, state],
    );
    await pool.query(
      `INSERT INTO actuator_state_history (device_id,state,changed_by)
       VALUES ($1,$2,'esp32_switch')`,
      [d.id, state],
    );
    await pool.query(
      `UPDATE devices SET status='ONLINE', last_seen=NOW() WHERE id=$1`, [d.id],
    );

    emitToUser(userId, 'actuator:update', {
      id: d.id, name: d.name, zone: d.zone, state, triggeredBy: 'esp32_switch',
    });
  } catch (err) { console.error('[ESP32 WS] onRelayState:', err); }
}

async function onEnergyReading(userId: number, data: Record<string, unknown>) {
  const { deviceKey, power_w, current_a, voltage_v, energy_wh } = data;

  try {
    const { rows } = await pool.query(
      'SELECT id, name FROM devices WHERE device_key=$1 AND owner_id=$2',
      [deviceKey, userId],
    );
    if (!rows.length) return;
    const d = rows[0];

    await pool.query(
      `INSERT INTO energy_readings (device_id,power_w,current_a,voltage_v,energy_wh)
       VALUES ($1,$2,$3,$4,$5)`,
      [d.id, power_w ?? 0, current_a ?? 0, voltage_v ?? 220, energy_wh ?? 0],
    );
    await pool.query(
      `UPDATE actuator_states
       SET energy_today_wh=COALESCE(energy_today_wh,0)+$2,
           total_energy_wh=COALESCE(total_energy_wh,0)+$2
       WHERE device_id=$1`,
      [d.id, energy_wh ?? 0],
    );

    emitToUser(userId, 'energy:update', {
      id: d.id, name: d.name, power_w, current_a, voltage_v, energy_wh,
      timestamp: new Date().toISOString(),
    });
  } catch (err) { console.error('[ESP32 WS] onEnergyReading:', err); }
}

async function onAlert(userId: number, data: Record<string, unknown>) {
  const { deviceKey, type, severity, message } = data;
  const VALID_TYPES      = ['FIRE','GAS_LEAK','INTRUSION','WATER_LEAK','HIGH_TEMP','POWER_CUT'];
  const VALID_SEVERITIES = ['INFO','WARNING','CRITICAL'];
  if (!VALID_TYPES.includes(type as string) || !VALID_SEVERITIES.includes(severity as string)) return;

  try {
    const { rows } = await pool.query(
      'SELECT id, name, zone FROM devices WHERE device_key=$1 AND owner_id=$2',
      [deviceKey, userId],
    );
    if (!rows.length) return;
    const d = rows[0];

    const { rowCount } = await pool.query(
      'SELECT id FROM alerts WHERE device_id=$1 AND type=$2 AND resolved=false LIMIT 1',
      [d.id, type],
    );
    if ((rowCount ?? 0) > 0) return;

    const { rows: alertRows } = await pool.query(
      `INSERT INTO alerts (device_id,type,zone,severity,message)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [d.id, type, d.zone ?? null, severity, message ?? null],
    );
    emitToUser(userId, 'alert:new', { ...alertRows[0], device_name: d.name });
  } catch (err) { console.error('[ESP32 WS] onAlert:', err); }
}

async function onHeartbeat(userId: number, data: Record<string, unknown>) {
  const device_keys = data.device_keys as string[];
  if (!Array.isArray(device_keys)) return;

  try {
    await pool.query(
      `UPDATE devices SET status='ONLINE', last_seen=NOW()
       WHERE owner_id=$1 AND device_key = ANY($2::text[])`,
      [userId, device_keys],
    );
    emitToUser(userId, 'device:online', { device_keys });
  } catch (err) { console.error('[ESP32 WS] onHeartbeat:', err); }
}
