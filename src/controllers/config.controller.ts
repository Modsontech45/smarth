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

  const result = await pool.query(
    `UPDATE system_config
     SET value = $1, updated_at = NOW()
     WHERE key = $2
     RETURNING key, value, description, updated_at`,
    [String(value), key]
  );

  if ((result.rowCount ?? 0) === 0) {
    res.status(404).json({ error: `Clé de configuration "${key}" introuvable` });
    return;
  }

  res.json({ message: 'Configuration mise à jour', config: result.rows[0] });
};
