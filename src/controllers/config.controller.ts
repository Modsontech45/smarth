import { Response } from 'express';
import { pool } from '../db/pool';
import { AuthenticatedRequest } from '../types';

// ─── GET /api/config ─────────────────────────────────────────
export const getConfig = async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  const result = await pool.query(
    'SELECT key, value, description, updated_at FROM system_config ORDER BY key'
  );
  res.json({ config: result.rows });
};

// ─── PUT /api/config/:key ────────────────────────────────────
export const updateConfig = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { key } = req.params;
  const { value } = req.body;

  if (value === undefined || value === null) {
    res.status(400).json({ error: 'La valeur est obligatoire' });
    return;
  }

  const { description } = req.body;

  const result = await pool.query(
    `INSERT INTO system_config (key, value, description)
     VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_at = NOW()
     RETURNING key, value, description, updated_at`,
    [key, String(value), description ?? null]
  );

  res.json({ message: 'Configuration mise à jour', config: result.rows[0] });
};
