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
  const sqlPath = path.join(__dirname, '../src/db/migrations/001_init.sql');
  const sql     = fs.readFileSync(sqlPath, 'utf8');

  const client = await pool.connect();
  try {
    console.log('Connexion à Neon PostgreSQL...');
    await client.query(sql);
    console.log('Migration exécutée avec succès — toutes les tables ont été créées.');
  } catch (err: any) {
    // Ignorer les erreurs "already exists" si on re-joue la migration
    if (err.code === '42P07' || err.code === '42710') {
      console.log('Tables déjà existantes — migration ignorée.');
    } else {
      console.error('Erreur lors de la migration :', err.message);
      process.exit(1);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
