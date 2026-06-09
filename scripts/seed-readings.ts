/**
 * seed-readings.ts
 * Adds example devices + realistic sensor readings for every INPUT device
 * owned by a given user. Uses bulk INSERT for speed against remote Neon DB.
 * Safe to re-run: devices are skipped if they already exist.
 *
 * Usage:  npx ts-node scripts/seed-readings.ts [email]
 *         defaults to tandemodson41@gmail.com
 */

import crypto from 'crypto';
import { Pool } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const rnd32 = () => crypto.randomBytes(32).toString('hex');
const jit   = (n: number) => (Math.random() - 0.5) * 2 * n;

const SAMPLE_DEVICES = [
  { name: 'Capteur Gaz Cuisine',   type: 'INPUT',  zone: 'Cuisine',   signal_type: 'analog',  data_type: 'float',   unit: 'ppm',     min_value: 0,   max_value: 5000, gpio_pin: 34 },
  { name: 'Capteur Lumière Salon', type: 'INPUT',  zone: 'Salon',     signal_type: 'analog',  data_type: 'float',   unit: 'lux',     min_value: 0,   max_value: 1000, gpio_pin: 35 },
  { name: 'Détecteur Mouvement',   type: 'INPUT',  zone: 'Chambre 1', signal_type: 'digital', data_type: 'boolean', unit: '',        min_value: 0,   max_value: 1,    gpio_pin: 14 },
  { name: 'Capteur Fuite Eau',     type: 'INPUT',  zone: 'Cuisine',   signal_type: 'digital', data_type: 'boolean', unit: '',        min_value: 0,   max_value: 1,    gpio_pin: 27 },
  { name: 'Capteur Chambre 1',     type: 'INPUT',  zone: 'Chambre 1', signal_type: 'dht22',   data_type: 'float',   unit: '°C',     min_value: -10, max_value: 60,   gpio_pin: 5  },
  { name: 'Capteur Extérieur',     type: 'INPUT',  zone: 'Extérieur', signal_type: 'dht22',   data_type: 'float',   unit: '°C',     min_value: -20, max_value: 60,   gpio_pin: 18 },
  { name: 'Lumière Salon',         type: 'OUTPUT', zone: 'Salon',     signal_type: 'digital', data_type: 'boolean', unit: 'boolean', min_value: 0,  max_value: 1,    gpio_pin: 16 },
  { name: 'Lumière Cuisine',       type: 'OUTPUT', zone: 'Cuisine',   signal_type: 'digital', data_type: 'boolean', unit: 'boolean', min_value: 0,  max_value: 1,    gpio_pin: 17 },
  { name: 'Lumière Chambre 1',     type: 'OUTPUT', zone: 'Chambre 1', signal_type: 'digital', data_type: 'boolean', unit: 'boolean', min_value: 0,  max_value: 1,    gpio_pin: 19 },
  { name: 'Ventilateur Salon',     type: 'OUTPUT', zone: 'Salon',     signal_type: 'digital', data_type: 'boolean', unit: 'boolean', min_value: 0,  max_value: 1,    gpio_pin: 21 },
  { name: 'Alarme Générale',       type: 'OUTPUT', zone: 'Général',   signal_type: 'digital', data_type: 'boolean', unit: 'boolean', min_value: 0,  max_value: 1,    gpio_pin: 23 },
];

function buildReading(device: { name: string; signal_type: string; unit: string }, i: number, ts: Date) {
  const hour    = ts.getHours();
  const daytime = hour >= 7 && hour < 21;
  const wave    = Math.sin((i / 95) * Math.PI * 4);
  const st = device.signal_type.toLowerCase();
  const u  = device.unit.toLowerCase();
  const n  = device.name.toLowerCase();

  let temp: number | null = null, hum: number | null = null, gas: number | null = null;
  let aq: number | null = null, motion: boolean | null = null;
  let lux: number | null = null, leak: boolean | null = null;

  if (st === 'dht22' || st === 'dht11') {
    const base = n.includes('extérieur') ? 14 : 21;
    const dayOff = n.includes('extérieur') ? -3 : n.includes('chambre') ? 1 : 3;
    temp = +(base + wave * 7 + jit(1.5) + (daytime ? dayOff : 0)).toFixed(2);
    hum  = +(60 - wave * 12 + jit(3) + (n.includes('extérieur') ? 10 : 0)).toFixed(2);
    aq   = +(72 + jit(8)).toFixed(2);
  } else if (u.includes('ppm')) {
    const spike = Math.random() > 0.93;
    gas = +(90 + Math.random() * 80 + (spike ? 370 : 0) + (daytime ? 20 : 0)).toFixed(2);
    aq  = +(80 - gas / 50).toFixed(2);
  } else if (u.includes('lux')) {
    lux = +(daytime ? 180 + Math.random() * 700 + wave * 150 : 1 + Math.random() * 12).toFixed(2);
  } else if (st === 'digital' && (n.includes('mouvement') || n.includes('motion') || n.includes('pir'))) {
    motion = daytime && Math.random() > 0.65;
  } else if (st === 'digital' && (n.includes('fuite') || n.includes('eau') || n.includes('water'))) {
    leak = Math.random() > 0.97;
  } else {
    aq = +(68 + wave * 12 + jit(5)).toFixed(2);
  }

  return { temp, hum, gas, aq, motion, lux, leak };
}

async function main() {
  const targetEmail = process.argv[2] ?? 'tandemodson41@gmail.com';
  const client = await pool.connect();

  try {
    const uRes = await client.query<{ id: number; name: string }>(
      'SELECT id, name FROM users WHERE email = $1', [targetEmail]
    );
    if (!uRes.rowCount) throw new Error(`User not found: ${targetEmail}`);
    const user = uRes.rows[0];
    console.log(`\nSeeding for: ${user.name} (id=${user.id})\n`);

    // Ensure UNIQUE constraint on actuator_states
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'actuator_states_device_id_key')
        THEN ALTER TABLE actuator_states ADD CONSTRAINT actuator_states_device_id_key UNIQUE (device_id);
        END IF;
      END $$;
    `);

    // Add sample devices (skip existing)
    let newDevices = 0;
    for (const d of SAMPLE_DEVICES) {
      const exists = await client.query(
        'SELECT id FROM devices WHERE owner_id = $1 AND name = $2', [user.id, d.name]
      );
      if ((exists.rowCount ?? 0) > 0) continue;
      await client.query(
        `INSERT INTO devices (owner_id, name, type, zone, device_key, status,
           signal_type, data_type, unit, min_value, max_value, gpio_pin)
         VALUES ($1,$2,$3,$4,$5,'ONLINE',$6,$7,$8,$9,$10,$11)`,
        [user.id, d.name, d.type, d.zone, rnd32(),
         d.signal_type, d.data_type, d.unit, d.min_value, d.max_value, d.gpio_pin]
      );
      newDevices++;
    }
    console.log(`  + ${newDevices} new device(s) created`);

    // Actuator states
    const outputRes = await client.query<{ id: number; name: string }>(
      `SELECT id, name FROM devices WHERE owner_id = $1 AND type = 'OUTPUT' ORDER BY id`, [user.id]
    );
    const initiallyOn = new Set(['Lumière Chambre 1', 'Lumière Extérieur']);
    for (const d of outputRes.rows) {
      await client.query(
        `INSERT INTO actuator_states (device_id, state) VALUES ($1,$2)
         ON CONFLICT (device_id) DO UPDATE SET state = $2`,
        [d.id, initiallyOn.has(d.name)]
      );
    }
    console.log(`  ✓ ${outputRes.rowCount} actuator state(s) set`);

    // Bulk-insert readings for each INPUT device
    const inputRes = await client.query<{ id: number; name: string; signal_type: string; unit: string }>(
      `SELECT id, name, signal_type, unit FROM devices WHERE owner_id = $1 AND type = 'INPUT' ORDER BY id`,
      [user.id]
    );
    console.log(`\n  Inserting 96 readings for each of ${inputRes.rowCount} INPUT device(s):\n`);

    const now = Date.now();
    const INTERVALS = 96; // 48 h × every 30 min

    for (const device of inputRes.rows) {
      // Build all rows as one VALUES list
      const values: (number | boolean | string | null)[] = [];
      const placeholders: string[] = [];
      let p = 1;

      for (let i = 0; i < INTERVALS; i++) {
        const ts = new Date(now - (INTERVALS - 1 - i) * 30 * 60 * 1000);
        const r  = buildReading(device, i, ts);
        placeholders.push(`($${p},$${p+1},$${p+2},$${p+3},$${p+4},$${p+5},$${p+6},$${p+7},$${p+8})`);
        values.push(device.id, r.temp, r.hum, r.gas, r.aq, r.motion, r.lux, r.leak, ts.toISOString());
        p += 9;
      }

      await client.query(
        `INSERT INTO sensor_readings
           (device_id, temperature, humidity, gas_ppm, air_quality, motion, light_lux, water_leak, recorded_at)
         VALUES ${placeholders.join(',')}`,
        values
      );

      await client.query(`UPDATE devices SET status = 'ONLINE' WHERE id = $1`, [device.id]);
      console.log(`    ✓ ${device.name.padEnd(28)} ${INTERVALS} readings  (${device.signal_type}${device.unit ? ', ' + device.unit : ''})`);
    }

    // Sample alerts (only if none exist yet)
    const alertCount = await client.query(
      'SELECT COUNT(*) FROM alerts WHERE device_id IN (SELECT id FROM devices WHERE owner_id = $1)', [user.id]
    );
    if (parseInt(alertCount.rows[0].count) === 0 && inputRes.rowCount && inputRes.rowCount > 0) {
      const firstInput = inputRes.rows[0];
      await client.query(`
        INSERT INTO alerts (device_id, type, zone, severity, message, resolved, created_at) VALUES
        ($1,'HIGH_TEMP','Salon',    'WARNING',  'Température élevée : 38 °C',            false, NOW() - INTERVAL '20 minutes'),
        ($1,'GAS_LEAK', 'Cuisine',  'CRITICAL', 'Concentration gaz anormale en cuisine', false, NOW() - INTERVAL '5 minutes'),
        ($1,'INTRUSION','Extérieur','CRITICAL', 'Mouvement détecté de nuit',             true,  NOW() - INTERVAL '3 hours')
      `, [firstInput.id]);
      console.log('\n  ✓ 3 sample alerts inserted');
    }

    console.log('\n✅ Done! Refresh the dashboard to see all devices.\n');
  } catch (err: any) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
