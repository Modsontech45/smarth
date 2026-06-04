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
  const sqlPath = path.join(__dirname, '../src/db/migrations/002_invitations.sql');
  const sql     = fs.readFileSync(sqlPath, 'utf8');

  const client = await pool.connect();
  try {
    console.log('Connexion à Neon PostgreSQL...');
    await client.query(sql);
    console.log('Migration 002 exécutée — table invitations créée.');
  } catch (err: any) {
    if (err.code === '42P07') {
      console.log('Table invitations déjà existante — ignorée.');
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
