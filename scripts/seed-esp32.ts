/**
 * seed-esp32.ts
 * Creates one user account + all ESP32 devices using the exact keys from config.h.
 * Run once against the production (Neon) database:
 *   npx ts-node scripts/seed-esp32.ts
 *
 * Safe to re-run: every INSERT uses ON CONFLICT DO NOTHING.
 */

import { Pool } from 'pg';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ── Values must match config.h exactly ────────────────────────────────────────
const USER = {
  name:    'Admin SmartHome',
  email:   'tandemodson55@gmail.com',
  password: 'SmartHome2025!',          // change after first login
  role:    'ADMIN' as const,
  api_key: '1d46fbc53367cc975d7f8870db9bd87a15a11b17c96b0b59e7025ff753bb8d93',
};

const SENSORS: { name: string; device_key: string; signal_type: string; unit: string; zone: string; gpio_pin: number }[] = [
  { name: 'Capteur DHT22',       device_key: 'a3e0995f6b3b4cee325546cf91a9e4f611f8bb34d5f193b4df3170937c1a54b8', signal_type: 'dht22',   unit: '°C/%',    zone: 'Salon',   gpio_pin: 4  },
  { name: 'Capteur Gaz MQ-2',    device_key: '3f3c275bab29ade1dc5f490c7c71dd421d058ee38978c7e19da1c5edb166b010', signal_type: 'analog',  unit: 'ppm',     zone: 'Cuisine', gpio_pin: 34 },
  { name: 'Capteur Luminosité',  device_key: '16f1057cf7ca7b366a8602960856b07ef0bc912b51f8c64170d7b42d5eca55b1', signal_type: 'analog',  unit: 'lux',     zone: 'Salon',   gpio_pin: 35 },
  { name: 'Capteur PIR',         device_key: '1fe424be81eb3669b51b22a50d819ae329ddf267a4d49c6de9b1318eaaebb99f', signal_type: 'digital', unit: 'boolean', zone: 'Entrée',  gpio_pin: 14 },
  { name: "Capteur Fuite d'eau", device_key: '7c4bfecb2b600a6a2c0bfdaf5063c98e95b4db867f8b5e98890397b267d5054e', signal_type: 'digital', unit: 'boolean', zone: 'Cuisine', gpio_pin: 27 },
];

const RELAYS: { name: string; device_key: string; zone: string; gpio_pin: number }[] = [
  { name: 'Lumiere salon',   device_key: '1710a140a02fe88a985c563c53f0189af5a989121c4dfcfc296d1247688b8df9', zone: 'Salon',   gpio_pin: 26 },
  { name: 'Lumiere garage',  device_key: 'ae1585b01b8fe3acc1aa5f559d69bbe8a920fc26f94c569f17ba1bdcc461e109',  zone: 'Garage',  gpio_pin: 25 },
  { name: 'Lumiere cuisine', device_key: '9a0b255dd04ea9e3d4bad1df02acd6bb068812e249a284e9e4ce8e54f5ad766f', zone: 'Cuisine', gpio_pin: 23 },
  { name: 'Lumiere chambre', device_key: '294eacaa5c2d46479dece8a463dead507a52e4b81cf820d0f12cc2fe053f8249', zone: 'Chambre', gpio_pin: 22 },
];

async function seed() {
  const client = await pool.connect();
  try {
    // ── 1. User ────────────────────────────────────────────────────────────────
    const hashed = await bcrypt.hash(USER.password, 12);
    const { rows: userRows } = await client.query<{ id: number }>(
      `INSERT INTO users (name, email, password, role, api_key, email_verified)
       VALUES ($1, $2, $3, $4, $5, TRUE)
       ON CONFLICT (api_key) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [USER.name, USER.email, hashed, USER.role, USER.api_key],
    );
    const userId = userRows[0].id;
    console.log(`✓  User  id=${userId}  ${USER.email}`);

    // ── 2. Sensor devices (INPUT) ──────────────────────────────────────────────
    for (const s of SENSORS) {
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO devices (owner_id, name, device_key, type, zone, signal_type, unit, gpio_pin)
         VALUES ($1, $2, $3, 'INPUT', $4, $5, $6, $7)
         ON CONFLICT (device_key) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [userId, s.name, s.device_key, s.zone, s.signal_type, s.unit, s.gpio_pin],
      );
      console.log(`✓  Sensor  id=${rows[0].id}  ${s.name}`);
    }

    // ── 3. Relay devices (OUTPUT) + actuator_states ───────────────────────────
    for (const r of RELAYS) {
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO devices (owner_id, name, device_key, type, zone, signal_type, unit, gpio_pin)
         VALUES ($1, $2, $3, 'OUTPUT', $4, 'digital', 'boolean', $5)
         ON CONFLICT (device_key) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [userId, r.name, r.device_key, r.zone, r.gpio_pin],
      );
      const devId = rows[0].id;
      await client.query(
        `INSERT INTO actuator_states (device_id, state)
         SELECT $1, FALSE WHERE NOT EXISTS (SELECT 1 FROM actuator_states WHERE device_id = $1)`,
        [devId],
      );
      console.log(`✓  Relay   id=${devId}  ${r.name}`);
    }

    console.log('\n✅  Seed complete. ESP32 keys are now registered in the production database.');
    console.log(`    Login: ${USER.email}  /  ${USER.password}`);
    console.log('    Change the password immediately after first login.');
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
