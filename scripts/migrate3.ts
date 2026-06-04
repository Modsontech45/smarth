import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function migrate(): Promise<void> {
  const sqlPath = path.join(__dirname, '../src/db/migrations/003_analytics.sql');
  const sql     = fs.readFileSync(sqlPath, 'utf8');
  const client  = await pool.connect();
  try {
    console.log('Connexion à Neon PostgreSQL...');
    await client.query(sql);
    console.log('Migration 003 exécutée — table actuator_state_history + index créés.');
  } catch (err: any) {
    if (err.code === '42P07' || err.code === '42710') {
      console.log('Déjà existant — ignoré.');
    } else {
      console.error('Erreur :', err.message);
      process.exit(1);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
