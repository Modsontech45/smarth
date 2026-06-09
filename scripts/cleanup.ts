import { pool } from '../src/db/pool';

async function main() {
  // List all devices for user 10
  const all = await pool.query('SELECT id, name, type FROM devices WHERE owner_id=10 ORDER BY id');
  console.log('All devices:');
  all.rows.forEach((d: any) => console.log(' ', d.id, d.type, d.name));

  // Keep only id=13 (the real "Temperature" device created by user)
  // Delete all others + their readings via CASCADE
  const del = await pool.query(
    'DELETE FROM devices WHERE owner_id=10 AND id != 13 RETURNING id, name'
  );
  console.log('\nDeleted devices:');
  del.rows.forEach((d: any) => console.log(' ', d.id, d.name));

  // Delete the seeded readings for the real device too
  const delR = await pool.query('DELETE FROM sensor_readings WHERE device_id=13 RETURNING id');
  console.log(`\nDeleted ${delR.rowCount} readings from device 13`);

  // Reset device status to OFFLINE (no real ESP32 sending data)
  await pool.query("UPDATE devices SET status='OFFLINE' WHERE id=13");
  console.log('Reset device 13 status to OFFLINE');

  await pool.end();
  console.log('\nDone.');
}

main().catch(e => { console.error(e); process.exit(1); });
