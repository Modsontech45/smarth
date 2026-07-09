import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const migrations = [
  { file: '001_init.sql',              desc: 'schema initial (tables principales)' },
  { file: '002_invitations.sql',       desc: 'table invitations' },
  { file: '003_analytics.sql',         desc: 'analytics / statistiques' },
  { file: '004_device_config.sql',     desc: 'colonnes de configuration devices' },
  { file: '005_user_restrictions.sql', desc: 'table user_zone_restrictions' },
  { file: '006_energy_readings.sql',   desc: 'table energy_readings' },
  { file: '007_cameras.sql',           desc: 'table cameras' },
  { file: '008_last_seen.sql',         desc: 'colonne last_seen sur devices' },
  { file: '009_subscriptions.sql',     desc: 'table subscriptions / notifications push' },
];

async function runAll(): Promise<void> {
  const client = await pool.connect();
  try {
    for (const { file, desc } of migrations) {
      const sqlPath = path.join(__dirname, '../src/db/migrations', file);
      const sql     = fs.readFileSync(sqlPath, 'utf8');
      try {
        await client.query(sql);
        console.log(`✓  ${file}  —  ${desc}`);
      } catch (err: any) {
        // 42P07 = table already exists, 42701 = column already exists, 42710 = type already exists
        if (['42P07', '42701', '42710'].includes(err.code)) {
          console.log(`~  ${file}  —  déjà appliquée (ignorée)`);
        } else {
          console.error(`✗  ${file}  —  ERREUR : ${err.message}`);
          process.exit(1);
        }
      }
    }
    console.log('\nToutes les migrations ont été exécutées.');
  } finally {
    client.release();
    await pool.end();
  }
}

runAll();
