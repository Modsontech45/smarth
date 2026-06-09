import { pool } from '../src/db/pool';

async function main() {
  const now = Date.now();
  for (let i = 0; i < 5; i++) {
    const ts   = new Date(now - (4 - i) * 30 * 60 * 1000);
    const wave = Math.sin((i / 4) * Math.PI);
    const temp = +(21 + wave * 4 + (Math.random() - 0.5) * 2).toFixed(2);
    const hum  = +(55 + wave * 8 + (Math.random() - 0.5) * 4).toFixed(2);
    await pool.query(
      `INSERT INTO sensor_readings
         (device_id, temperature, humidity, air_quality, recorded_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [13, temp, hum, 75, ts.toISOString()]
    );
    console.log(`  reading ${i + 1}: temp=${temp}°C  hum=${hum}%  at ${ts.toISOString()}`);
  }
  await pool.query("UPDATE devices SET status='ONLINE' WHERE id=13");
  const check = await pool.query('SELECT COUNT(*) FROM sensor_readings WHERE device_id=13');
  console.log(`\nTotal readings for device 13: ${check.rows[0].count}`);
  console.log('Device 13 set ONLINE');
  pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
