import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { pool } from './pool';

const SALT_ROUNDS = 10;
const rnd32 = () => crypto.randomBytes(32).toString('hex');

async function seed() {
  console.log('🌱 Seeding database…');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ── Wipe existing data (reverse dependency order) ─────────────────
    await client.query('DELETE FROM actuator_state_history');
    await client.query('DELETE FROM actuator_states');
    await client.query('DELETE FROM sensor_readings');
    await client.query('DELETE FROM alerts');
    await client.query('DELETE FROM automations');
    await client.query('DELETE FROM invitations');
    await client.query('DELETE FROM user_zone_restrictions').catch(() => {});
    await client.query('DELETE FROM devices');
    await client.query('DELETE FROM users');

    for (const seq of ['users', 'devices', 'sensor_readings', 'alerts',
                        'actuator_states', 'actuator_state_history', 'invitations']) {
      await client.query(`SELECT setval('${seq}_id_seq', 1, false)`);
    }

    // Ensure UNIQUE constraint exists on actuator_states.device_id (needed for ON CONFLICT)
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'actuator_states_device_id_key'
        ) THEN
          ALTER TABLE actuator_states
            ADD CONSTRAINT actuator_states_device_id_key UNIQUE (device_id);
        END IF;
      END $$;
    `);

    // ── Users ─────────────────────────────────────────────────────────
    const [adminHash, userHash, guestHash] = await Promise.all([
      bcrypt.hash('admin123', SALT_ROUNDS),
      bcrypt.hash('user123',  SALT_ROUNDS),
      bcrypt.hash('guest123', SALT_ROUNDS),
    ]);

    const adminRes = await client.query<{ id: number }>(
      `INSERT INTO users (name, email, password, role, api_key, email_verified)
       VALUES ($1, $2, $3, 'ADMIN', $4, true) RETURNING id`,
      ['Admin SmartHome', 'admin@smarthome.io', adminHash, rnd32()]
    );
    const adminId = adminRes.rows[0].id;

    await client.query(
      `INSERT INTO users (name, email, password, role, api_key, email_verified)
       VALUES ($1, $2, $3, 'USER', $4, true)`,
      ['Marie Dupont', 'user@smarthome.io', userHash, rnd32()]
    );
    await client.query(
      `INSERT INTO users (name, email, password, role, api_key, email_verified)
       VALUES ($1, $2, $3, 'GUEST', $4, true)`,
      ['Jean Martin', 'guest@smarthome.io', guestHash, rnd32()]
    );

    // ── INPUT Devices (sensors) ───────────────────────────────────────
    const sensor1Res = await client.query<{ id: number }>(
      `INSERT INTO devices
         (owner_id, name, type, zone, description, device_key, status,
          signal_type, data_type, unit, min_value, max_value, gpio_pin)
       VALUES ($1, 'Capteur Principal', 'INPUT', 'Salon',
               'Capteur DHT22 + MQ-2 + PIR + LDR', $2, 'ONLINE',
               'dht22', 'float', '°C', -40, 80, 4)
       RETURNING id`,
      [adminId, rnd32()]
    );
    const sensor1Id = sensor1Res.rows[0].id;

    await client.query(
      `INSERT INTO devices
         (owner_id, name, type, zone, description, device_key, status,
          signal_type, data_type, unit, min_value, max_value, gpio_pin)
       VALUES ($1, 'Capteur Cuisine', 'INPUT', 'Cuisine',
               'Capteur MQ-2 gaz cuisine', $2, 'ONLINE',
               'analog', 'float', 'ppm', 0, 5000, 34)`,
      [adminId, rnd32()]
    );

    // ── OUTPUT Devices (actuators) ────────────────────────────────────
    const outputDevices = [
      { name: 'Lumière Salon',     zone: 'Salon',     desc: 'Éclairage principal salon',  pin: 16 },
      { name: 'Lumière Ch. 1',     zone: 'Chambre 1', desc: 'Éclairage chambre 1',         pin: 17 },
      { name: 'Lumière Ch. 2',     zone: 'Chambre 2', desc: 'Éclairage chambre 2',         pin: 18 },
      { name: 'Lumière Cuisine',   zone: 'Cuisine',   desc: 'Éclairage cuisine',           pin: 19 },
      { name: 'Lumière Extérieur', zone: 'Extérieur', desc: 'Éclairage extérieur jardin',  pin: 21 },
      { name: 'Ventilateur',       zone: 'Salon',     desc: 'Ventilateur plafond salon',   pin: 22 },
      { name: 'Alarme',            zone: 'Général',   desc: 'Sirène alarme générale',      pin: 23 },
    ];

    for (const d of outputDevices) {
      await client.query(
        `INSERT INTO devices
           (owner_id, name, type, zone, description, device_key, status,
            signal_type, data_type, unit, min_value, max_value, gpio_pin)
         VALUES ($1, $2, 'OUTPUT', $3, $4, $5, 'ONLINE',
                 'digital', 'boolean', 'boolean', 0, 1, $6)`,
        [adminId, d.name, d.zone, d.desc, rnd32(), d.pin]
      );
    }

    // ── Actuator states ───────────────────────────────────────────────
    const outputRes = await client.query<{ id: number; name: string; zone: string }>(
      `SELECT id, name, zone FROM devices WHERE owner_id = $1 AND type = 'OUTPUT' ORDER BY id`,
      [adminId]
    );

    const initiallyOn = new Set(['Lumière Ch. 1', 'Lumière Extérieur']);

    for (const d of outputRes.rows) {
      const isOn = initiallyOn.has(d.name);
      await client.query(
        `INSERT INTO actuator_states (device_id, state)
         VALUES ($1, $2)
         ON CONFLICT (device_id) DO UPDATE SET state = $2`,
        [d.id, isOn]
      );
      await client.query(
        `INSERT INTO actuator_state_history (device_id, state, changed_by, changed_at)
         VALUES ($1, false, 'manual', NOW() - INTERVAL '12 hours'),
                ($1, $2,   'manual', NOW() - INTERVAL '2 hours')`,
        [d.id, isOn]
      );
    }

    // ── Sensor readings (96 entries, last 48 h every 30 min) ─────────
    const now = Date.now();
    for (let i = 0; i < 96; i++) {
      const ts        = new Date(now - (95 - i) * 30 * 60 * 1000);
      const hour      = ts.getHours();
      const daytime   = hour >= 7 && hour < 21;
      const wave      = Math.sin((i / 95) * Math.PI * 4);
      const jitter    = () => (Math.random() - 0.5) * 2;
      const gasPeak   = Math.random() > 0.93;

      const temp   = +(21 + wave * 7 + jitter() * 1.5 + (daytime ? 3 : 0)).toFixed(2);
      const hum    = +(58 - wave * 12 + jitter() * 3).toFixed(2);
      const gas    = +(90 + Math.random() * 100 + (gasPeak ? 350 : 0)).toFixed(2);
      const aq     = +(70 + jitter() * 15).toFixed(2);
      const motion = daytime && Math.random() > 0.65;
      const lux    = +(daytime ? 200 + Math.random() * 750 : 2 + Math.random() * 20).toFixed(2);

      await client.query(
        `INSERT INTO sensor_readings
           (device_id, temperature, humidity, gas_ppm, air_quality, motion, light_lux, water_leak, recorded_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,false,$8)`,
        [sensor1Id, temp, hum, gas, aq, motion, lux, ts.toISOString()]
      );
    }

    // ── Alerts ────────────────────────────────────────────────────────
    // Build a map of zone → device_id from the output devices
    const zoneDeviceId: Record<string, number> = {};
    for (const d of outputRes.rows) {
      zoneDeviceId[d.zone] = d.id; // last device in zone wins (fine for our zones)
    }

    type AlertType = 'GAS_LEAK' | 'HIGH_TEMP' | 'INTRUSION' | 'FIRE' | 'WATER_LEAK' | 'POWER_CUT';
    type Severity  = 'CRITICAL' | 'WARNING' | 'INFO';

    const alertRows: {
      type: AlertType; sev: Severity; zone: string; msg: string;
      resolved: boolean; minsAgo: number;
    }[] = [
      {
        type: 'GAS_LEAK',  sev: 'CRITICAL', zone: 'Cuisine',
        msg: 'Fuite de gaz détectée — concentration critique',
        resolved: false, minsAgo: 10,
      },
      {
        type: 'HIGH_TEMP', sev: 'WARNING', zone: 'Salon',
        msg: 'Température élevée : 38 °C détectée',
        resolved: false, minsAgo: 35,
      },
      {
        type: 'INTRUSION', sev: 'CRITICAL', zone: 'Extérieur',
        msg: "Mouvement suspect détecté à l'extérieur",
        resolved: true, minsAgo: 90,
      },
      {
        type: 'FIRE', sev: 'CRITICAL', zone: 'Salon',
        msg: 'Alerte incendie — fumée détectée',
        resolved: true, minsAgo: 180,
      },
    ];

    for (const a of alertRows) {
      const devId = zoneDeviceId[a.zone] ?? null;
      await client.query(
        `INSERT INTO alerts (device_id, type, zone, severity, message, resolved, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW() - ($7 * INTERVAL '1 minute'))`,
        [devId, a.type, a.zone, a.sev, a.msg, a.resolved, a.minsAgo]
      );
    }

    // ── System config ─────────────────────────────────────────────────
    await client.query(`
      INSERT INTO system_config (key, value, description) VALUES
        ('temp_max',        '35',   'Maximum temperature threshold (°C)'),
        ('gas_ppm_max',     '400',  'Maximum gas concentration (ppm)'),
        ('light_threshold', '100',  'Light level to trigger automatic lighting (lux)'),
        ('sensor_interval', '300',  'ESP32 sensor read interval (seconds)'),
        ('auto_mode',       'true', 'Enable intelligent automation rules'),
        ('zones',           '["Salon","Cuisine","Chambre 1","Chambre 2","Extérieur","Garage","Bureau"]',
                            'Admin-managed zone list (JSON array)')
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `);

    await client.query('COMMIT');

    console.log('✅ Seed complete!\n');
    console.log('  Demo accounts:');
    console.log('  admin@smarthome.io  /  admin123  (ADMIN)');
    console.log('  user@smarthome.io   /  user123   (USER)');
    console.log('  guest@smarthome.io  /  guest123  (GUEST)');
    console.log('\n  Seeded:');
    console.log('  • 3 users');
    console.log('  • 9 devices (2 sensors + 7 actuators)');
    console.log('  • 96 sensor readings (48 h × every 30 min)');
    console.log('  • 4 alerts (2 active, 2 resolved)');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Seed failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
